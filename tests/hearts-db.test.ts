import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Caracterización de la separación personal/empresa contra Postgres.
 *
 * El runner normal excluye los archivos `*-db.test.ts`; este test solo corre
 * con `npm run test:db`. Si no hay DATABASE_URL se marca como skip para no
 * romper un `npm test` sin servicios.
 */

function loadEnvironment(): void {
  for (const fileName of [".env"]) {
    const filePath = resolve(process.cwd(), fileName);
    if (existsSync(filePath)) process.loadEnvFile(filePath);
  }
}

loadEnvironment();

const hasDatabase = () => Boolean(process.env.DATABASE_URL);

describe(
  "separación de Hearts contra Postgres",
  { skip: hasDatabase() ? false : "sin DATABASE_URL" },
  () => {
    let db: typeof import("../lib/db.js");
    let hearts: typeof import("../lib/hearts.js");
    let userA = "";
    let userB = "";
    let personalAId = "";
    let personalBId = "";
    let pausedId = "";
    let archivedId = "";
    let companyId = "";
    let chatId = "";

    before(async () => {
      db = await import("../lib/db.js");
      hearts = await import("../lib/hearts.js");
      const { query } = await import("../lib/db-connection.js");

      const users = await query(
        "SELECT id FROM users ORDER BY created_at ASC NULLS LAST, id ASC LIMIT 2",
      );
      assert.ok(
        users.rows.length >= 2,
        "El test requiere al menos dos usuarios existentes.",
      );
      userA = String(users.rows[0].id);
      userB = String(users.rows[1].id);

      personalAId = randomUUID();
      personalBId = randomUUID();
      companyId = randomUUID();

      await db.createHeart(
        personalAId,
        userA,
        "Heart personal A",
        "Analista",
        "Claro",
        "Responde con datos.",
        "No inventes.",
        0.4,
        ["read_files"],
        0,
        false,
        "personal",
      );
      await db.createHeart(
        personalBId,
        userB,
        "Heart personal B",
        "Analista",
        "Claro",
        "Responde con datos.",
        "No inventes.",
        0.4,
        ["read_files"],
        0,
        false,
        "personal",
      );
      await db.createHeart(
        companyId,
        userA,
        "Heart de empresa",
        "Asistente",
        "Formal",
        "Responde como la empresa.",
        "No reveles datos internos.",
        0.3,
        ["read_files", "generate_docs"],
        1,
        false,
        "company",
      );

      pausedId = randomUUID();
      archivedId = randomUUID();
      for (const [id, name, status] of [
        [pausedId, "Heart pausado", "paused"],
        [archivedId, "Heart archivado", "archived"],
      ] as const) {
        await db.createHeart(
          id,
          userA,
          name,
          "Asistente",
          "Formal",
          "Responde como la empresa.",
          "No reveles datos internos.",
          0.3,
          [],
          0,
          false,
          "company",
        );
        await query("UPDATE hearts SET status = $1 WHERE id = $2", [status, id]);
      }

      chatId = randomUUID();
      await db.createChat(chatId, userA, "Chat de prueba", null, personalAId);
    });

    after(async () => {
      if (!db) return;
      if (chatId) await db.deleteChat(chatId).catch(() => undefined);
      for (const id of [personalAId, personalBId, pausedId, archivedId, companyId]) {
        if (id) await db.deleteHeart(id).catch(() => undefined);
      }
    });

    it("un usuario ve sus Hearts personales y todos los de empresa", async () => {
      const visible = await hearts.listHeartsForUser(userA);
      const ids = visible.map((heart) => heart.id);

      assert.ok(ids.includes(personalAId));
      assert.ok(ids.includes(companyId));
      assert.ok(!ids.includes(personalBId));
    });

    it("no permite leer un Heart personal ajeno, pero sí uno de empresa", async () => {
      assert.equal(await hearts.readHeartForUser(personalAId, userB), null);

      const companyForB = await hearts.readHeartForUser(companyId, userB);
      assert.ok(companyForB);
      assert.equal(companyForB.scope, "company");
    });

    it("el fijado es por usuario y no altera el Heart", async () => {
      const pinned = await hearts.setHeartPinnedForUser(companyId, userA, true);
      assert.ok(pinned);
      assert.equal(pinned.is_pinned, true);

      const visible = await hearts.listHeartsForUser(userA);
      assert.equal(
        visible.find((heart) => heart.id === companyId)?.is_pinned,
        true,
      );

      await hearts.setHeartPinnedForUser(companyId, userA, false);
    });

    it("separa los listados administrativos por scope", async () => {
      const company = await db.getCompanyHearts();
      assert.ok(company.some((heart) => heart.id === companyId));

      const personal = await db.getUserHearts();
      assert.ok(personal.some((heart) => heart.id === personalAId));
      assert.ok(personal.some((heart) => heart.id === personalBId));
      assert.ok(!personal.some((heart) => heart.id === companyId));
    });

    it("el chat conserva el vínculo con su Heart", async () => {
      const chat = await db.getChatById(chatId);
      assert.ok(chat);
      assert.equal(chat.heart_id, personalAId);
      assert.equal(chat.heart_name, "Heart personal A");
      assert.equal(chat.agent_key, null);
    });

    it("el resolver usa la fila actual si el Heart no tiene snapshot", async () => {
      const resolver = await import("../lib/heart-resolver.js");
      const definition = await resolver.resolvePublishedHeartDefinition(personalAId);
      assert.ok(definition);
      assert.equal(definition.identity.name, "Heart personal A");
      assert.equal(definition.admin.version, 1);
    });

    it("pausados y archivados no son visibles ni utilizables por usuarios", async () => {
      const visible = await hearts.listHeartsForUser(userB);
      const ids = visible.map((heart) => heart.id);
      assert.ok(!ids.includes(pausedId));
      assert.ok(!ids.includes(archivedId));
      assert.ok(ids.includes(companyId));

      assert.equal(await hearts.readHeartForUser(pausedId, userB), null);
      assert.equal(await hearts.readHeartForUser(archivedId, userB), null);

      // El panel admin sigue viéndolos para poder reactivarlos.
      const company = await db.getCompanyHearts();
      assert.ok(company.some((heart) => heart.id === pausedId));
      assert.ok(company.some((heart) => heart.id === archivedId));
    });
  },
);

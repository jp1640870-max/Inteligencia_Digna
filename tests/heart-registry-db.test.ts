import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Registry, ciclo de vida y versionado contra Postgres (Fase 1).
 *
 * El runner normal excluye `*-db.test.ts`; este archivo corre con
 * `npm run test:db` y requiere la migración 013 aplicada.
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
  "Registry de Hearts contra Postgres",
  { skip: hasDatabase() ? false : "sin DATABASE_URL" },
  () => {
    let registry: typeof import("../lib/heart-registry.js");
    let lifecycle: typeof import("../lib/heart-lifecycle.js");
    let versions: typeof import("../lib/heart-versions.js");
    let dbConnection: typeof import("../lib/db-connection.js");
    let heartsLib: typeof import("../lib/hearts.js");
    let validate: typeof import("../lib/heart-definition.js");
    let resolver: typeof import("../lib/heart-resolver.js");
    let userA = "";
    let userB = "";
    let heartId = "";
    let cascadeId = "";
    const adminActor = { id: "", role: "admin" };
    const userActor = { id: "", role: "user" };

    before(async () => {
      registry = await import("../lib/heart-registry.js");
      lifecycle = await import("../lib/heart-lifecycle.js");
      versions = await import("../lib/heart-versions.js");
      dbConnection = await import("../lib/db-connection.js");
      heartsLib = await import("../lib/hearts.js");
      validate = await import("../lib/heart-definition.js");
      resolver = await import("../lib/heart-resolver.js");

      const users = await dbConnection.query(
        "SELECT id FROM users ORDER BY created_at ASC NULLS LAST, id ASC LIMIT 2",
      );
      assert.ok(users.rows.length >= 2, "El test requiere al menos dos usuarios.");
      userA = String(users.rows[0].id);
      userB = String(users.rows[1].id);
      adminActor.id = userA;
      userActor.id = userB;
    });

    after(async () => {
      if (!dbConnection) return;
      for (const id of [heartId, cascadeId]) {
        if (id) await dbConnection.query("DELETE FROM hearts WHERE id = $1", [id]).catch(() => undefined);
      }
    });

    it("la migración 013 expone columnas y tabla de versiones", async () => {
      const columns = await dbConnection.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'hearts'
            AND column_name IN ('description','model','status','version','published_at')`,
      );
      assert.equal(columns.rows.length, 5);
      const table = await dbConnection.query(
        `SELECT to_regclass('heart_versions') AS nombre`,
      );
      assert.ok(table.rows[0].nombre);
    });

    it("crea un borrador, publica y escribe el snapshot v1", async () => {
      const created = await registry.createHeartDefinition(
        {
          name: "Heart fase 1",
          description: "Definición de prueba",
          role: "Analista",
          tone: "Claro",
          instructions: "Analiza.",
          limitations: "No inventes.",
          temperature: 0.4,
          model: "modelo-local",
          tools: ["read_files"],
          scope: "company",
          status: "draft",
        },
        adminActor,
      );
      if (!created.ok) return assert.fail(created.error);
      heartId = created.value.definition.id;

      assert.equal(created.value.definition.admin.status, "draft");
      assert.equal(created.value.definition.admin.publishedAt, null);
      assert.equal(created.value.definition.admin.version, 1);

      const published = await lifecycle.publishHeartDefinition(heartId, adminActor, "Primera publicación");
      if (!published.ok) return assert.fail(published.error);
      assert.equal(published.value.definition.admin.status, "published");
      assert.equal(published.value.definition.admin.version, 1);
      assert.ok(published.value.definition.admin.publishedAt);

      const snapshots = await versions.listHeartVersions(heartId);
      assert.equal(snapshots.length, 1);
      assert.equal(snapshots[0].version, 1);
      assert.equal(snapshots[0].changeSummary, "Primera publicación");
      assert.equal(snapshots[0].snapshot.admin.status, "published");
    });

    it("editar no cambia versión; republicar crea v2", async () => {
      const edited = await registry.updateHeartDefinition(
        heartId,
        { description: "Descripción editada", is_featured: true },
        adminActor,
      );
      if (!edited.ok) return assert.fail(edited.error);
      assert.equal(edited.value.definition.identity.description, "Descripción editada");
      assert.equal(edited.value.definition.admin.version, 1);
      assert.equal(edited.value.isFeatured, true);

      const republished = await lifecycle.publishHeartDefinition(heartId, adminActor, "Segunda publicación");
      if (!republished.ok) return assert.fail(republished.error);
      assert.equal(republished.value.definition.admin.version, 2);

      const snapshots = await versions.listHeartVersions(heartId);
      assert.equal(snapshots.length, 2);
      assert.deepEqual(
        snapshots.map((snapshot) => snapshot.version).sort(),
        [1, 2],
      );
      assert.ok(
        snapshots.some((snapshot) => snapshot.snapshot.identity.description === "Descripción editada"),
      );
    });

    it("pausa, revoca y archiva con transiciones válidas", async () => {
      const paused = await lifecycle.pauseHeartDefinition(heartId, adminActor);
      if (!paused.ok) return assert.fail(paused.error);
      assert.equal(paused.value.definition.admin.status, "paused");
      assert.equal(paused.value.definition.admin.version, 2);

      const republished = await lifecycle.publishHeartDefinition(heartId, adminActor);
      // paused -> published es válida; la transición inválida se comprueba
      // después, desde revoked.
      assert.equal(republished.ok, true);
      if (!republished.ok) return;

      const revoked = await lifecycle.revokeHeartDefinition(heartId, adminActor);
      if (!revoked.ok) return assert.fail(revoked.error);
      assert.equal(revoked.value.definition.admin.status, "revoked");

      const blocked = await lifecycle.publishHeartDefinition(heartId, adminActor);
      assert.equal(blocked.ok, false);
      if (!blocked.ok) assert.equal(blocked.status, 409);

      const archived = await lifecycle.archiveHeartDefinition(heartId, adminActor);
      if (!archived.ok) return assert.fail(archived.error);
      assert.equal(archived.value.definition.admin.status, "archived");
    });

    it("filtra listados y respeta propiedad", async () => {
      const byStatus = await registry.listHeartDefinitions(adminActor, { status: "archived" });
      if (!byStatus.ok) return assert.fail(byStatus.error);
      assert.ok(byStatus.value.some((record) => record.definition.id === heartId));

      const bySearch = await registry.listHeartDefinitions(adminActor, { search: "fase 1" });
      if (!bySearch.ok) return assert.fail(bySearch.error);
      assert.ok(bySearch.value.some((record) => record.definition.id === heartId));

      const asNonOwner = await registry.getHeartDefinitionRecord(heartId, userActor);
      assert.equal(asNonOwner.ok, false);
      if (!asNonOwner.ok) assert.equal(asNonOwner.status, 403);

      const ownList = await registry.listHeartDefinitions(userActor);
      if (!ownList.ok) return assert.fail(ownList.error);
      assert.ok(ownList.value.every((record) => record.definition.admin.scope === "personal"));
      assert.ok(!ownList.value.some((record) => record.definition.id === heartId));
    });

    it("reactiva un archivado y la nueva publicación no repite versión", async () => {
      const reactivated = await lifecycle.reactivateHeartDefinition(heartId, adminActor);
      if (!reactivated.ok) return assert.fail(reactivated.error);
      assert.equal(reactivated.value.definition.admin.status, "draft");
      assert.equal(reactivated.value.definition.admin.version, 3);

      const republished = await lifecycle.publishHeartDefinition(
        heartId,
        adminActor,
        "Publicación tras reactivación",
      );
      if (!republished.ok) return assert.fail(republished.error);
      assert.equal(republished.value.definition.admin.status, "published");
      assert.equal(republished.value.definition.admin.version, 4);

      const snapshots = await versions.listHeartVersions(heartId);
      assert.deepEqual(
        snapshots.map((snapshot) => snapshot.version).sort(),
        [1, 2, 3, 4],
      );
    });

    it("el runtime resuelve el snapshot publicado y no la edición sin publicar", async () => {
      await dbConnection.query(
        "UPDATE hearts SET description = $1 WHERE id = $2",
        ["Cambio sin publicar", heartId],
      );

      const definition = await resolver.resolvePublishedHeartDefinition(heartId);
      assert.ok(definition);
      assert.equal(definition.identity.description, "Descripción editada");
      assert.equal(definition.admin.version, 4);

      const heart = await heartsLib.readHeartForUser(heartId, userA);
      assert.ok(heart);
      const runtime = await resolver.resolveChatHeartRuntime({
        heart,
        supportAgent: null,
        actor: { id: userA, role: "admin" },
        chatId: "chat-resolver-test",
        defaultModel: "modelo-chat",
        requestedTools: [
          "read_files",
          "generate_docs",
          "web_search",
          "analyze_images",
        ],
      });
      if (!runtime.ok) return assert.fail(runtime.error);
      assert.equal(runtime.runtime.kind, "heart");
      assert.equal(runtime.runtime.model, "modelo-local");
      assert.equal(runtime.runtime.temperature, 0.4);
      assert.deepEqual(runtime.runtime.allowedTools, ["read_files"]);
      assert.equal(
        runtime.runtime.execution?.heart.identity.description,
        "Descripción editada",
      );
    });

    it("el resolver no entrega definición para un Heart pausado", async () => {
      const paused = await lifecycle.pauseHeartDefinition(heartId, adminActor);
      if (!paused.ok) return assert.fail(paused.error);
      assert.equal(await resolver.resolvePublishedHeartDefinition(heartId), null);
    });

    it("siembra Soporte como definición publicada con fallback válido", async () => {
      await heartsLib.ensureOfficialSupportHeart(userA);
      const result = await dbConnection.query(
        `SELECT name, description, status, version, published_at, agent_key
           FROM hearts WHERE agent_key = $1 LIMIT 1`,
        ["soporte-tecnico-oficial"],
      );
      const row = result.rows[0];
      assert.ok(row, "La tarjeta oficial debe existir.");
      assert.equal(row.status, "published");
      assert.ok(Number(row.version) >= 1);
      assert.ok(String(row.description).length > 0);
      assert.ok(row.published_at);

      const definition = await registry.getOfficialSupportDefinition();
      const validated = validate.validateHeartDefinition(definition);
      if (!validated.ok) return assert.fail(validated.error);
      assert.equal(validated.ok, true);

      const fallback = registry.buildFallbackSupportDefinition();
      assert.equal(fallback.admin.status, "published");
      assert.equal(fallback.admin.version, 1);
      assert.equal(fallback.ownerId, "system");
    });

    it("Soporte conserva su runtime y su conjunto oficial de tools", async () => {
      const official = await import("../lib/official-agents.js");
      const supportAgent = official.resolveOfficialAgent("soporte-tecnico-oficial");
      assert.ok(supportAgent);

      const runtime = await resolver.resolveChatHeartRuntime({
        heart: null,
        supportAgent,
        actor: { id: userA, role: "user" },
        chatId: "chat-support-test",
        defaultModel: "modelo-chat",
        requestedTools: ["read_files", "generate_docs", "web_search"],
      });
      if (!runtime.ok) return assert.fail(runtime.error);
      assert.equal(runtime.runtime.kind, "support");
      assert.equal(runtime.runtime.model, "modelo-chat");
      assert.equal(runtime.runtime.temperature, undefined);
      assert.deepEqual(runtime.runtime.allowedTools, ["read_files"]);
      assert.equal(runtime.runtime.definition?.admin.status, "published");
    });

    it("eliminar un Heart borra sus snapshots en cascada", async () => {
      const created = await registry.createHeartDefinition(
        {
          name: "Heart temporal de versión",
          role: "Analista",
          instructions: "Analiza.",
          scope: "company",
          status: "published",
        },
        adminActor,
      );
      if (!created.ok) return assert.fail(created.error);
      cascadeId = created.value.definition.id;

      const beforeDelete = await versions.listHeartVersions(cascadeId);
      assert.equal(beforeDelete.length, 1);

      const deleted = await registry.deleteHeartDefinition(cascadeId, adminActor);
      if (!deleted.ok) return assert.fail(deleted.error);

      const afterDelete = await versions.listHeartVersions(cascadeId);
      assert.equal(afterDelete.length, 0);
      cascadeId = "";
    });
  },
);

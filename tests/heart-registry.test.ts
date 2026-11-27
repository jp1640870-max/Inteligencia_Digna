import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toHeartDefinition } from "../lib/heart-definition.js";
import {
  applyHeartDefinitionPatch,
  buildHeartDefinitionForCreate,
  canManageHeartDefinition,
  isHeartAction,
  parseHeartWriteInput,
  resolveHeartStatusAction,
  toHeartAdminItem,
} from "../lib/heart-registry-rules.js";
import type { HeartRow } from "../types/index.js";

const baseRow: HeartRow = {
  id: "heart-1",
  user_id: "user-1",
  name: "Analista",
  role: "Analista de datos",
  tone: "Técnico",
  instructions: "Analiza y resume.",
  limitations: "No inventes cifras.",
  temperature: 0.4,
  knowledge_files: "[]",
  tools: '["read_files"]',
  agent_memory: "",
  is_public: 0,
  is_preset: 0,
  scope: "personal",
  agent_key: null,
  is_featured: 0,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
};

describe("parseHeartWriteInput", () => {
  it("normaliza los campos escribibles y descarta herramientas desconocidas", () => {
    const result = parseHeartWriteInput({
      name: "  Heart nuevo  ",
      description: "  Descripción  ",
      temperature: 0.3,
      tools: ["read_files", "tool_inventada", "read_files"],
      model: "  llama3.1 ",
      declaredFiles: ["guia.pdf", " guia.pdf ", ""],
      status: "published",
      user_id: "otro",
    });
    if (!result.ok) return assert.fail(result.error);
    assert.equal(result.value.name, "Heart nuevo");
    assert.equal(result.value.description, "Descripción");
    assert.equal(result.value.temperature, 0.3);
    assert.deepEqual(result.value.tools, ["read_files"]);
    assert.equal(result.value.model, "llama3.1");
    assert.deepEqual(result.value.declaredFiles, ["guia.pdf"]);
    assert.equal("status" in result.value, false);
    assert.equal("user_id" in result.value, false);
  });

  it("rechaza textos largos, temperaturas inválidas y arreglos no textuales", () => {
    assert.equal(parseHeartWriteInput({ name: "x".repeat(81) }).ok, false);
    assert.equal(parseHeartWriteInput({ temperature: 2.1 }).ok, false);
    assert.equal(parseHeartWriteInput({ tools: "read_files" }).ok, false);
    assert.equal(parseHeartWriteInput({ declaredFiles: [1] }).ok, false);
    assert.equal(parseHeartWriteInput([]).ok, false);
  });

  it("interpreta modelo vacío como null", () => {
    const result = parseHeartWriteInput({ model: "" });
    if (!result.ok) return assert.fail(result.error);
    assert.equal(result.value.model, null);
  });
});

describe("buildHeartDefinitionForCreate", () => {
  const input = parseHeartWriteInput({
    name: "Nuevo",
    description: "Definición de prueba",
    tools: ["read_files"],
  });
  if (!input.ok) throw new Error(input.error);

  it("crea un borrador sin fecha de publicación", () => {
    const definition = buildHeartDefinitionForCreate({
      input: input.value,
      id: "heart-2",
      ownerId: "user-1",
      scope: "company",
      status: "draft",
      now: "2026-04-01T00:00:00.000Z",
    });
    assert.equal(definition.admin.status, "draft");
    assert.equal(definition.admin.version, 1);
    assert.equal(definition.admin.publishedAt, null);
    assert.equal(definition.admin.scope, "company");
    assert.equal(definition.identity.description, "Definición de prueba");
  });

  it("marca la publicación inicial con fecha y versión 1", () => {
    const definition = buildHeartDefinitionForCreate({
      input: input.value,
      id: "heart-3",
      ownerId: "user-1",
      scope: "company",
      status: "published",
      now: "2026-04-01T00:00:00.000Z",
    });
    assert.equal(definition.admin.status, "published");
    assert.equal(definition.admin.publishedAt, "2026-04-01T00:00:00.000Z");
  });
});

describe("applyHeartDefinitionPatch", () => {
  const current = toHeartDefinition(baseRow);

  it("aplica cambios sin tocar propiedad, estado ni versión", () => {
    const next = applyHeartDefinitionPatch(current, {
      name: "Renombrado",
      temperature: 0.9,
      tools: ["generate_docs"],
      model: "modelo-local",
    });
    assert.equal(next.identity.name, "Renombrado");
    assert.equal(next.model.temperature, 0.9);
    assert.equal(next.model.name, "modelo-local");
    assert.deepEqual(next.capabilities.tools, ["generate_docs"]);
    assert.equal(next.ownerId, current.ownerId);
    assert.equal(next.admin.status, current.admin.status);
    assert.equal(next.admin.version, current.admin.version);
  });

  it("conserva el comportamiento del agente oficial", () => {
    const next = applyHeartDefinitionPatch(
      current,
      {
        name: "Soporte",
        instructions: "Nuevas instrucciones",
        limitations: "Nuevas limitaciones",
        tools: ["web_search"],
        model: "otro-modelo",
      },
      { official: true },
    );
    assert.equal(next.identity.name, "Soporte");
    assert.equal(next.behavior.instructions, current.behavior.instructions);
    assert.equal(next.behavior.limitations, current.behavior.limitations);
    assert.deepEqual(next.capabilities.tools, current.capabilities.tools);
    assert.equal(next.model.name, current.model.name);
  });
});

describe("canManageHeartDefinition", () => {
  const personal = toHeartDefinition(baseRow);
  const company = { ...personal, admin: { ...personal.admin, scope: "company" as const } };

  it("el propietario gestiona su Heart personal", () => {
    assert.equal(canManageHeartDefinition(personal, { id: "user-1", role: "user" }), true);
  });

  it("ningún usuario gestiona un Heart ajeno o de empresa", () => {
    assert.equal(canManageHeartDefinition(personal, { id: "user-2", role: "user" }), false);
    assert.equal(canManageHeartDefinition(company, { id: "user-1", role: "user" }), false);
  });

  it("el perímetro gestiona ambos ámbitos", () => {
    assert.equal(canManageHeartDefinition(personal, { id: "admin-1", role: "admin" }), true);
    assert.equal(canManageHeartDefinition(company, { id: "admin-1", role: "super_admin" }), true);
    assert.equal(canManageHeartDefinition(company, { id: "editor-1", role: "editor" }), false);
  });
});

describe("resolveHeartStatusAction", () => {
  it("publica desde borrador, pausa y republicación", () => {
    assert.equal(resolveHeartStatusAction("draft", "publish"), "published");
    assert.equal(resolveHeartStatusAction("paused", "publish"), "published");
    assert.equal(resolveHeartStatusAction("published", "publish"), "published");
    assert.equal(resolveHeartStatusAction("published", "pause"), "paused");
    assert.equal(resolveHeartStatusAction("paused", "revoke"), "revoked");
    assert.equal(resolveHeartStatusAction("revoked", "archive"), "archived");
  });

  it("rechaza transiciones terminales e inválidas", () => {
    assert.equal(resolveHeartStatusAction("revoked", "publish"), null);
    assert.equal(resolveHeartStatusAction("archived", "pause"), null);
    assert.equal(resolveHeartStatusAction("draft", "revoke"), null);
    assert.equal(resolveHeartStatusAction("archived", "reactivate"), "draft");
    assert.equal(resolveHeartStatusAction("revoked", "reactivate"), null);
    assert.equal(isHeartAction("reiniciar"), false);
    assert.equal(isHeartAction("archive"), true);
    assert.equal(isHeartAction("reactivate"), true);
  });
});

describe("toHeartAdminItem", () => {
  it("aplaña la definición para el panel sin perder estado ni versión", () => {
    const definition = toHeartDefinition({
      ...baseRow,
      description: "Descripción",
      model: null,
      status: "paused",
      version: 4,
      published_at: "2026-05-01T00:00:00.000Z",
    });
    const item = toHeartAdminItem({
      definition,
      agentKey: null,
      isFeatured: true,
      ownerName: "Usuario",
      ownerEmail: "usuario@example.com",
    });
    assert.equal(item.id, "heart-1");
    assert.equal(item.description, "Descripción");
    assert.equal(item.status, "paused");
    assert.equal(item.version, 4);
    assert.equal(item.published_at, "2026-05-01T00:00:00.000Z");
    assert.equal(item.is_featured, true);
    assert.deepEqual(item.tools, ["read_files"]);
    assert.equal(item.user_name, "Usuario");
  });
});

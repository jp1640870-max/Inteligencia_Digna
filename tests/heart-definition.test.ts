import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HEART_DEFINITION_LIMITS,
  canTransitionHeartStatus,
  isHeartStatus,
  isHeartUsable,
  toHeartDefinition,
  validateHeartDefinition,
  validateHeartVersion,
} from "../lib/heart-definition.js";
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
  knowledge_files: '["guia.pdf","guia.pdf","manual.pdf"]',
  tools: '["read_files","generate_docs","tool_inventada","read_files"]',
  agent_memory: "",
  is_public: 0,
  is_preset: 0,
  scope: "personal",
  agent_key: null,
  is_featured: 0,
  is_pinned: 0,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
};

describe("toHeartDefinition", () => {
  it("mapea la fila actual y aplica defaults de Fase 1", () => {
    const definition = toHeartDefinition(baseRow);

    assert.equal(definition.id, "heart-1");
    assert.equal(definition.ownerId, "user-1");
    assert.equal(definition.identity.name, "Analista");
    assert.equal(definition.identity.description, "");
    assert.equal(definition.identity.role, "Analista de datos");
    assert.equal(definition.behavior.tone, "Técnico");
    assert.equal(definition.model.name, null);
    assert.equal(definition.model.temperature, 0.4);
    assert.equal(definition.knowledge.mode, "platform_acl");
    assert.deepEqual(definition.knowledge.declaredFiles, [
      "guia.pdf",
      "manual.pdf",
    ]);
    assert.deepEqual(definition.capabilities.tools, [
      "read_files",
      "generate_docs",
    ]);
    assert.equal(definition.admin.scope, "personal");
    assert.equal(definition.admin.status, "published");
    assert.equal(definition.admin.version, 1);
  });

  it("respeta los campos futuros cuando ya existen en la fila", () => {
    const definition = toHeartDefinition({
      ...baseRow,
      description: "Analiza datos internos.",
      model: "modelo-local",
      status: "paused",
      version: 3,
      published_at: "2026-02-01T00:00:00.000Z",
    });

    assert.equal(definition.identity.description, "Analiza datos internos.");
    assert.equal(definition.model.name, "modelo-local");
    assert.equal(definition.admin.status, "paused");
    assert.equal(definition.admin.version, 3);
    assert.equal(definition.admin.publishedAt, "2026-02-01T00:00:00.000Z");
  });

  it("acepta fechas de publicacion como Date de PostgreSQL", () => {
    const definition = toHeartDefinition({
      ...baseRow,
      published_at: new Date("2026-03-01T00:00:00.000Z"),
    });
    assert.equal(definition.admin.publishedAt, "2026-03-01T00:00:00.000Z");
  });

  it("normaliza valores inválidos a defaults seguros", () => {
    const definition = toHeartDefinition({
      ...baseRow,
      temperature: 9,
      status: "inventado",
      version: 0,
    });

    assert.equal(definition.model.temperature, 0.7);
    assert.equal(definition.admin.status, "published");
    assert.equal(definition.admin.version, HEART_DEFINITION_LIMITS.versionMin);
  });
});

describe("validateHeartDefinition", () => {
  const definition = toHeartDefinition(baseRow);

  it("acepta una definición válida", () => {
    const result = validateHeartDefinition(definition);
    if (!result.ok) return assert.fail(result.error);
    assert.equal(result.value.identity.name, "Analista");
  });

  it("rechaza nombre vacío", () => {
    const result = validateHeartDefinition({
      ...definition,
      identity: { ...definition.identity, name: "   " },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /nombre/i);
  });

  it("rechaza descripción demasiado larga", () => {
    const result = validateHeartDefinition({
      ...definition,
      identity: {
        ...definition.identity,
        description: "a".repeat(HEART_DEFINITION_LIMITS.description + 1),
      },
    });
    assert.equal(result.ok, false);
  });

  it("rechaza temperatura fuera de rango", () => {
    const result = validateHeartDefinition({
      ...definition,
      model: { ...definition.model, temperature: 2.1 },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /temperatura/i);
  });

  it("rechaza herramientas desconocidas y duplicadas", () => {
    const unknown = validateHeartDefinition({
      ...definition,
      capabilities: { tools: ["tool_inventada"] },
    });
    assert.equal(unknown.ok, false);

    const duplicated = validateHeartDefinition({
      ...definition,
      capabilities: { tools: ["read_files", "read_files"] },
    });
    assert.equal(duplicated.ok, false);
    if (duplicated.ok) return;
    assert.match(duplicated.error, /duplicada/i);
  });

  it("rechaza estados y scopes inválidos", () => {
    const invalidStatus = validateHeartDefinition({
      ...definition,
      admin: { ...definition.admin, status: "inventado" },
    });
    assert.equal(invalidStatus.ok, false);

    const invalidScope = validateHeartDefinition({
      ...definition,
      admin: { ...definition.admin, scope: "otro" },
    });
    assert.equal(invalidScope.ok, false);
  });

  it("rechaza versiones menores que 1", () => {
    const result = validateHeartDefinition({
      ...definition,
      admin: { ...definition.admin, version: 0 },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /versión/i);
  });

  it("rechaza un modo de conocimiento no soportado", () => {
    const result = validateHeartDefinition({
      ...definition,
      knowledge: { mode: "otro", declaredFiles: [] },
    });
    assert.equal(result.ok, false);
  });

  it("acepta publishedAt nulo y rechaza texto demasiado largo", () => {
    const withoutDate = validateHeartDefinition({
      ...definition,
      admin: { ...definition.admin, publishedAt: null },
    });
    assert.equal(withoutDate.ok, true);

    const invalid = validateHeartDefinition({
      ...definition,
      admin: { ...definition.admin, publishedAt: "x".repeat(101) },
    });
    assert.equal(invalid.ok, false);
  });
});

describe("ciclo de vida", () => {
  it("reconoce estados válidos", () => {
    assert.equal(isHeartStatus("published"), true);
    assert.equal(isHeartStatus("inventado"), false);
    assert.equal(isHeartStatus(null), false);
  });

  it("solo publica Hearts en estado published", () => {
    assert.equal(isHeartUsable("published"), true);
    assert.equal(isHeartUsable("draft"), false);
    assert.equal(isHeartUsable("paused"), false);
    assert.equal(isHeartUsable("revoked"), false);
    assert.equal(isHeartUsable("archived"), false);
  });

  it("respeta las transiciones definidas", () => {
    assert.equal(canTransitionHeartStatus("draft", "published"), true);
    assert.equal(canTransitionHeartStatus("published", "paused"), true);
    assert.equal(canTransitionHeartStatus("paused", "published"), true);
    assert.equal(canTransitionHeartStatus("published", "revoked"), true);
    assert.equal(canTransitionHeartStatus("revoked", "published"), false);
    assert.equal(canTransitionHeartStatus("archived", "published"), false);
    assert.equal(canTransitionHeartStatus("archived", "draft"), true);
    assert.equal(canTransitionHeartStatus("revoked", "draft"), false);
  });
});

describe("validateHeartVersion", () => {
  const definition = toHeartDefinition(baseRow);
  const version = {
    heartId: definition.id,
    version: definition.admin.version,
    snapshot: definition,
    authorId: "user-1",
    createdAt: "2026-01-02T00:00:00.000Z",
    changeSummary: "Versión inicial",
  };

  it("acepta un snapshot coherente", () => {
    const result = validateHeartVersion(version);
    if (!result.ok) return assert.fail(result.error);
    assert.equal(result.value.heartId, definition.id);
    assert.equal(result.value.version, definition.admin.version);
  });

  it("rechaza una versión que no coincide con el snapshot", () => {
    const result = validateHeartVersion({ ...version, version: 2 });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /no coincide/i);
  });

  it("rechaza un heartId que no coincide con el snapshot", () => {
    const result = validateHeartVersion({ ...version, heartId: "otro-heart" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /no coincide/i);
  });

  it("rechaza un snapshot inválido", () => {
    const result = validateHeartVersion({
      ...version,
      snapshot: { ...definition, identity: { ...definition.identity, name: "" } },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /Snapshot inválido/i);
  });

  it("exige autor y fecha", () => {
    assert.equal(validateHeartVersion({ ...version, authorId: "" }).ok, false);
    assert.equal(validateHeartVersion({ ...version, createdAt: "" }).ok, false);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_HEART_EXECUTION_LIMITS,
  buildHeartExecution,
  resolveAllowedHeartTools,
  resolveHeartModel,
} from "../lib/heart-execution.js";
import { toHeartDefinition } from "../lib/heart-definition.js";
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
  knowledge_files: '["guia.pdf"]',
  tools: '["read_files","generate_docs"]',
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

function buildInput(heart = toHeartDefinition(baseRow)) {
  return {
    executionId: "exec-1",
    actor: { id: "user-1", role: "user" },
    heart,
    chatId: "chat-1",
    defaultModel: "modelo-por-defecto",
    instructions: "Instrucciones efectivas",
    allowedTools: [
      "read_files",
      "generate_docs",
      "web_search",
    ] as const,
    startedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("buildHeartExecution", () => {
  it("usa el modelo por defecto y la temperatura del Heart", () => {
    const result = buildHeartExecution(buildInput());
    if (!result.ok) return assert.fail(result.error);

    assert.equal(result.execution.model, "modelo-por-defecto");
    assert.equal(result.execution.temperature, 0.4);
    assert.equal(result.execution.instructions, "Instrucciones efectivas");
    assert.equal(result.execution.startedAt, "2026-01-01T00:00:00.000Z");
    assert.deepEqual(result.execution.limits, DEFAULT_HEART_EXECUTION_LIMITS);
  });

  it("intersecta las herramientas propuestas con las declaradas", () => {
    const result = buildHeartExecution(buildInput());
    if (!result.ok) return assert.fail(result.error);

    assert.deepEqual(result.execution.allowedTools, [
      "read_files",
      "generate_docs",
    ]);
  });

  it("respeta un modelo explícito del Heart", () => {
    const heart = toHeartDefinition({ ...baseRow, model: "modelo-heart" });
    const result = buildHeartExecution(buildInput(heart));
    if (!result.ok) return assert.fail(result.error);

    assert.equal(result.execution.model, "modelo-heart");
  });

  it("rechaza Hearts que no están publicados", () => {
    const heart = toHeartDefinition({ ...baseRow, status: "paused" });
    const result = buildHeartExecution(buildInput(heart));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /paused/);
  });

  it("rechaza límites inválidos", () => {
    const result = buildHeartExecution({
      ...buildInput(),
      limits: { maxSteps: 0 },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /límites/i);
  });

  it("permite sobrescribir límites válidos", () => {
    const result = buildHeartExecution({
      ...buildInput(),
      limits: { maxSteps: 3, timeoutMs: 5000, maxOutputTokens: 512 },
    });
    if (!result.ok) return assert.fail(result.error);

    assert.deepEqual(result.execution.limits, {
      maxSteps: 3,
      timeoutMs: 5000,
      maxOutputTokens: 512,
    });
  });
});

describe("resolveHeartModel", () => {
  it("cae al modelo por defecto cuando el Heart no declara uno", () => {
    const heart = toHeartDefinition(baseRow);
    assert.equal(resolveHeartModel(heart, "modelo-chat"), "modelo-chat");
  });

  it("usa el modelo del Heart cuando existe", () => {
    const heart = toHeartDefinition({ ...baseRow, model: "modelo-heart" });
    assert.equal(resolveHeartModel(heart, "modelo-chat"), "modelo-heart");
  });

  it("ignora un modelo en blanco", () => {
    const heart = toHeartDefinition({ ...baseRow, model: "   " });
    assert.equal(resolveHeartModel(heart, "modelo-chat"), "modelo-chat");
  });
});

describe("resolveAllowedHeartTools", () => {
  it("conserva el orden, filtra no declaradas y elimina duplicados", () => {
    const heart = toHeartDefinition(baseRow);
    const allowed = resolveAllowedHeartTools(heart, [
      "web_search",
      "read_files",
      "read_files",
      "generate_docs",
    ]);

    assert.deepEqual(allowed, ["read_files", "generate_docs"]);
  });
});

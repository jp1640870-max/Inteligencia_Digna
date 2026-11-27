import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildHeartExecutionFromDefinition,
  resolveChatHeartRuntime,
} from "../lib/heart-resolver.js";
import {
  buildHeartInstructions,
  buildHeartInstructionsFromDefinition,
} from "../lib/prompt-builder.js";
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

describe("buildHeartExecutionFromDefinition", () => {
  it("usa modelo, temperatura, prompt y tools de la definición", () => {
    const definition = toHeartDefinition({
      ...baseRow,
      model: "modelo-heart",
      temperature: 0.6,
      tools: '["read_files","web_search"]',
    });

    const result = buildHeartExecutionFromDefinition({
      definition,
      actor: { id: "user-1", role: "user" },
      chatId: "chat-1",
      defaultModel: "modelo-chat",
      requestedTools: [
        "read_files",
        "generate_docs",
        "web_search",
        "analyze_images",
      ],
      executionId: "exec-1",
    });

    if (!result.ok) return assert.fail(result.error);
    assert.equal(result.execution.model, "modelo-heart");
    assert.equal(result.execution.temperature, 0.6);
    assert.deepEqual(result.execution.allowedTools, ["read_files", "web_search"]);
    assert.match(result.execution.instructions, /Eres el Heart "Analista"/);
    assert.match(result.execution.instructions, /Analiza y resume\./);
  });

  it("cae al modelo del chat cuando la definición no declara uno", () => {
    const result = buildHeartExecutionFromDefinition({
      definition: toHeartDefinition(baseRow),
      actor: { id: "user-1", role: "user" },
      chatId: "chat-1",
      defaultModel: "modelo-chat",
      requestedTools: ["read_files"],
      executionId: "exec-2",
    });

    if (!result.ok) return assert.fail(result.error);
    assert.equal(result.execution.model, "modelo-chat");
  });

  it("rechaza una definición no publicada", () => {
    const result = buildHeartExecutionFromDefinition({
      definition: toHeartDefinition({ ...baseRow, status: "paused" }),
      actor: { id: "user-1", role: "user" },
      chatId: "chat-1",
      defaultModel: "modelo-chat",
      requestedTools: ["read_files"],
      executionId: "exec-3",
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /paused/);
  });
});

describe("buildHeartInstructionsFromDefinition", () => {
  it("produce el mismo texto que el constructor histórico", () => {
    const definition = toHeartDefinition(baseRow);
    const expected = buildHeartInstructions({
      name: definition.identity.name,
      role: definition.identity.role,
      tone: definition.behavior.tone,
      instructions: definition.behavior.instructions,
      limitations: definition.behavior.limitations,
      tools: definition.capabilities.tools,
    });

    assert.equal(buildHeartInstructionsFromDefinition(definition), expected);
  });
});

describe("resolveChatHeartRuntime", () => {
  it("mantiene el chat normal sin ejecución y con todas las ramas", async () => {
    const result = await resolveChatHeartRuntime({
      heart: null,
      supportAgent: null,
      actor: { id: "user-1", role: "user" },
      chatId: "chat-1",
      defaultModel: "modelo-chat",
      requestedTools: ["read_files"],
    });

    if (!result.ok) return assert.fail(result.error);
    assert.equal(result.runtime.kind, "normal");
    assert.equal(result.runtime.definition, null);
    assert.equal(result.runtime.execution, null);
    assert.equal(result.runtime.model, "modelo-chat");
    assert.equal(result.runtime.temperature, undefined);
    assert.equal(result.runtime.allowedTools, null);
  });
});

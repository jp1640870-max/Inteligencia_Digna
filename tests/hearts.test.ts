import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canEditHeart,
  parseHeartTools,
  sanitizeHeartInput,
  toAgent,
} from "../lib/hearts.js";
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

describe("sanitizeHeartInput", () => {
  it("normaliza texto y descarta herramientas desconocidas", () => {
    const result = sanitizeHeartInput({
      name: "  Redactor  ",
      role: "  Contenido ",
      tone: "",
      instructions: "  Escribe claro.  ",
      limitations: "",
      temperature: "0.8",
      tools: ["generate_docs", "tool_inventada", "generate_docs"],
      is_preset: true,
      is_public: true,
      is_featured: true,
      scope: "company",
      agent_key: "soporte-tecnico-oficial",
      user_id: "otro-usuario",
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.value.name, "Redactor");
    assert.equal(result.value.role, "Contenido");
    assert.equal(result.value.instructions, "Escribe claro.");
    assert.equal(result.value.temperature, 0.8);
    assert.deepEqual(result.value.tools, ["generate_docs"]);
    assert.equal("is_preset" in result.value, false);
    assert.equal("is_featured" in result.value, false);
    assert.equal("scope" in result.value, false);
    assert.equal("agent_key" in result.value, false);
    assert.equal("user_id" in result.value, false);
  });

  it("exige un nombre no vacío", () => {
    const result = sanitizeHeartInput({ name: "   " });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /nombre/i);
  });

  it("rechaza temperaturas fuera del rango permitido", () => {
    for (const temperature of [-0.1, 2.1, "caliente"]) {
      const result = sanitizeHeartInput({ name: "Agente", temperature });
      assert.equal(result.ok, false, `temperatura ${temperature}`);
    }
  });

  it("rechaza textos por encima del límite", () => {
    const result = sanitizeHeartInput({ name: "a".repeat(81) });
    assert.equal(result.ok, false);
  });

  it("rechaza entradas que no son objetos", () => {
    assert.equal(sanitizeHeartInput(null).ok, false);
    assert.equal(sanitizeHeartInput("agente").ok, false);
    assert.equal(sanitizeHeartInput([]).ok, false);
  });
});

describe("parseHeartTools", () => {
  it("parsea JSON, deduplica y conserva solo herramientas válidas", () => {
    assert.deepEqual(
      parseHeartTools('["web_search","web_search","read_files","otra"]'),
      ["web_search", "read_files"],
    );
  });

  it("devuelve arreglo vacío ante JSON inválido", () => {
    assert.deepEqual(parseHeartTools("no-json"), []);
    assert.deepEqual(parseHeartTools("{}"), []);
    assert.deepEqual(parseHeartTools(null), []);
  });
});

describe("propiedad y visibilidad", () => {
  it("solo el dueño puede editar su Heart", () => {
    assert.equal(canEditHeart(baseRow, "user-1"), true);
    assert.equal(canEditHeart(baseRow, "user-2"), false);
  });

  it("toAgent marca is_owner según quien consulta y parsea valores", () => {
    const own = toAgent(baseRow, "user-1");
    assert.equal(own.is_owner, true);
    assert.equal(own.is_public, false);
    assert.deepEqual(own.tools, ["read_files", "generate_docs"]);
    assert.deepEqual(own.knowledge_files, ["guia.pdf"]);

    const shared = toAgent(
      { ...baseRow, is_preset: 1, is_public: 1 },
      "user-2",
    );
    assert.equal(shared.is_owner, false);
    assert.equal(shared.is_preset, true);
    assert.equal(shared.is_public, true);
  });

  it("un Heart de empresa no es editable ni propio aunque lo haya creado un admin", () => {
    const company: HeartRow = {
      ...baseRow,
      scope: "company",
      is_preset: 1,
      is_featured: 1,
      agent_key: "soporte-tecnico-oficial",
    };

    assert.equal(canEditHeart(company, "user-1"), false);

    const agent = toAgent(company, "user-1");
    assert.equal(agent.is_owner, false);
    assert.equal(agent.scope, "company");
    assert.equal(agent.is_featured, true);
    assert.equal(agent.agent_key, "soporte-tecnico-oficial");
  });

  it("is_pinned refleja el fijado del usuario que consulta", () => {
    const pinned = toAgent({ ...baseRow, is_pinned: 1 }, "user-1");
    assert.equal(pinned.is_pinned, true);
    assert.equal(pinned.is_featured, false);
  });
});

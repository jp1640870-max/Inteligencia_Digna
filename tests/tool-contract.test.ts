import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HEART_TOOLS } from "../lib/heart-config.js";
import {
  HEART_SELECTABLE_TOOLS,
  HEART_TOOL_CATALOG,
  getToolContract,
  isToolId,
  isToolRisk,
  isToolStatus,
  resolveToolId,
  validateToolContract,
} from "../lib/tool-contract.js";

describe("catálogo de herramientas", () => {
  it("incluye las herramientas de Heart y las de plataforma", () => {
    const ids = HEART_TOOL_CATALOG.map((tool) => tool.id);

    for (const tool of HEART_TOOLS) {
      assert.ok(ids.includes(tool), `Falta ${tool}`);
    }
    assert.ok(ids.includes("kb_search"));
    assert.ok(ids.includes("prepare_escalation"));
  });

  it("mantiene sincronizadas las herramientas seleccionables", () => {
    assert.deepEqual([...HEART_SELECTABLE_TOOLS], [...HEART_TOOLS]);
  });

  it("expone el contrato por ID canónico", () => {
    const tool = getToolContract("read_files");
    assert.ok(tool);
    assert.equal(tool.id, "read_files");
    assert.equal(tool.status, "active");
    assert.equal(getToolContract("nope" as never), undefined);
  });

  it("resuelve los IDs históricos del agente oficial", () => {
    assert.equal(resolveToolId("conversation_files"), "read_files");
    assert.equal(resolveToolId("knowledge_base"), "kb_search");
    assert.equal(resolveToolId("prepare_escalation"), "prepare_escalation");
    assert.equal(resolveToolId("tool_inventada"), null);
  });
});

describe("validateToolContract", () => {
  const base = {
    id: "read_files",
    name: "Leer archivos",
    description: "Lee archivos de la conversación.",
    inputSchema: { type: "object" },
    requiredCapabilities: [],
    risk: "low",
    integration: null,
    version: 1,
    status: "active",
    requiresApproval: false,
  };

  it("acepta un contrato válido", () => {
    const result = validateToolContract(base);
    if (!result.ok) return assert.fail(result.error);
    assert.equal(result.value.id, "read_files");
    assert.equal(result.value.risk, "low");
  });

  it("acepta los contratos del catálogo", () => {
    for (const tool of HEART_TOOL_CATALOG) {
      const result = validateToolContract(tool);
      assert.equal(result.ok, true, `${tool.id}: ${result.ok ? "" : result.error}`);
    }
  });

  it("rechaza IDs desconocidos", () => {
    const result = validateToolContract({ ...base, id: "tool_inventada" });
    assert.equal(result.ok, false);
  });

  it("rechaza nombre o descripción vacíos", () => {
    assert.equal(validateToolContract({ ...base, name: " " }).ok, false);
    assert.equal(validateToolContract({ ...base, description: "" }).ok, false);
  });

  it("rechaza riesgos, estados y versiones inválidos", () => {
    assert.equal(validateToolContract({ ...base, risk: "extremo" }).ok, false);
    assert.equal(validateToolContract({ ...base, status: "beta" }).ok, false);
    assert.equal(validateToolContract({ ...base, version: 0 }).ok, false);
  });

  it("rechaza capacidades desconocidas", () => {
    const result = validateToolContract({
      ...base,
      requiredCapabilities: ["capacidad_inventada"],
    });
    assert.equal(result.ok, false);
  });

  it("rechaza esquemas que no son objetos", () => {
    assert.equal(validateToolContract({ ...base, inputSchema: [] }).ok, false);
    assert.equal(validateToolContract({ ...base, outputSchema: "no" }).ok, false);
  });
});

describe("guardas de tipo", () => {
  it("reconoce IDs canónicos", () => {
    assert.equal(isToolId("read_files"), true);
    assert.equal(isToolId("conversation_files"), false);
    assert.equal(isToolId(null), false);
  });

  it("reconoce riesgos y estados", () => {
    assert.equal(isToolRisk("low"), true);
    assert.equal(isToolRisk("extremo"), false);
    assert.equal(isToolStatus("active"), true);
    assert.equal(isToolStatus("beta"), false);
  });
});

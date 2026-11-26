import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getSupportInstructions,
  resolveOfficialAgent,
  SUPPORT_AGENT,
} from "../lib/official-agents.js";
import {
  buildSupportEscalation,
  categorizeSupportIssue,
  prioritizeSupportIssue,
} from "../lib/support-escalation.js";

describe("agente oficial Soporte Técnico", () => {
  it("tiene identificador estable y configuración oficial publicada", () => {
    assert.equal(SUPPORT_AGENT.id, "soporte-tecnico-oficial");
    assert.equal(SUPPORT_AGENT.name, "Soporte Técnico");
    assert.equal(SUPPORT_AGENT.source, "official");
    assert.equal(SUPPORT_AGENT.status, "published");
    assert.deepEqual(SUPPORT_AGENT.allowedTools, [
      "knowledge_base",
      "conversation_files",
      "prepare_escalation",
    ]);
  });

  it("resuelve solo identificadores conocidos", () => {
    assert.equal(resolveOfficialAgent(SUPPORT_AGENT.id)?.name, "Soporte Técnico");
    assert.equal(resolveOfficialAgent("otro-agente"), null);
    assert.equal(resolveOfficialAgent(null), null);
    assert.equal(resolveOfficialAgent(undefined), null);
  });

  it("refuerza la regla de evidencia cuando no hay contexto recuperado", () => {
    assert.match(SUPPORT_AGENT.instructions, /No encontré evidencia suficiente/);
    assert.match(SUPPORT_AGENT.instructions, /No afirmes que creaste un ticket/);
    assert.match(getSupportInstructions(false), /No se recuperaron documentos relevantes/);
    assert.equal(getSupportInstructions(true), SUPPORT_AGENT.instructions);
  });
});

describe("buildSupportEscalation", () => {
  const messages = [
    {
      role: "user" as const,
      text: "No puedo iniciar sesión en mi cuenta de Windows y es urgente",
    },
    {
      role: "ai" as const,
      text: "Revisa tu contraseña.",
      kbSources: [
        {
          file_id: "kb-1",
          filename: "cambio de contraseña windows.pdf",
          category: "General",
          chunk_index: 0,
          score: 0.91,
        },
      ],
    },
  ];

  it("clasifica categoría y prioridad de forma determinista", () => {
    assert.equal(categorizeSupportIssue("No puedo iniciar sesión"), "acceso_y_credenciales");
    assert.equal(categorizeSupportIssue("La impresora no imprime"), "hardware_y_dispositivos");
    assert.equal(categorizeSupportIssue("¿Cómo está el clima?"), "soporte_general");
    assert.equal(prioritizeSupportIssue("Es urgente, no puedo trabajar"), "alta");
    assert.equal(prioritizeSupportIssue("Da un error"), "media");
    assert.equal(prioritizeSupportIssue("Hola"), "baja");
  });

  it("construye los siete campos sin inventar un ticket", () => {
    const result = buildSupportEscalation({
      user: { name: "Juan", email: "juan@example.com" },
      messages,
    });

    assert.deepEqual(Object.keys(result).sort(), [
      "category",
      "description",
      "escalation_reason",
      "priority",
      "reported_by",
      "summary",
      "troubleshooting_steps",
    ]);
    assert.equal(result.summary, messages[0].text);
    assert.match(result.description, /Usuario: No puedo iniciar sesión/);
    assert.equal(result.category, "acceso_y_credenciales");
    assert.equal(result.priority, "alta");
    assert.equal(result.reported_by, "Juan <juan@example.com>");
    assert.ok(
      result.troubleshooting_steps.some((step) =>
        step.includes("cambio de contraseña windows.pdf"),
      ),
    );
    assert.match(result.escalation_reason, /no permitió confirmar una solución/);
    assert.doesNotMatch(JSON.stringify(result), /ticket[_ -]?id|ticket creado|ServiceDesk/i);
  });

  it("usa el motivo proporcionado y reporta sin nombre", () => {
    const result = buildSupportEscalation({
      user: { email: "user@example.com" },
      messages: [
        { role: "user", text: "La VPN no conecta" },
        { role: "ai", text: "Sin evidencia." },
      ],
      reason: " El usuario requiere revisión del área de red ",
    });

    assert.equal(result.reported_by, "user@example.com");
    assert.equal(result.escalation_reason, "El usuario requiere revisión del área de red");
    assert.equal(result.category, "red_y_conectividad");
    assert.match(result.escalation_reason, /revisión/);
  });
});

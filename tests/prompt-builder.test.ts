import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildHeartInstructions, buildMessages } from "../lib/prompt-builder.js";
import type { HeartTool } from "../lib/heart-config.js";

function expectedToday(): string {
  return new Date().toLocaleDateString("es-MX", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

describe("buildMessages", () => {
  it("incluye la fecha de HOY (no congelada a nivel de módulo)", () => {
    const messages = buildMessages([], "hola");
    assert.equal(messages[0].role, "system");
    assert.match(messages[0].content as string, new RegExp(`Hoy es ${expectedToday()}\\.`));
  });

  it("dos construcciones usan la fecha actual en ambas", () => {
    const a = buildMessages([], "uno");
    const b = buildMessages([], "dos", undefined, "contexto de proyecto");
    for (const m of [a, b]) {
      assert.ok((m[0].content as string).includes(`Hoy es ${expectedToday()}`));
    }
    assert.ok((b[0].content as string).includes("CONTEXTO DEL PROYECTO:"));
  });

  it("agrega el mensaje de usuario al final", () => {
    const messages = buildMessages([{ role: "user", text: "previo" }], "nuevo");
    assert.equal(messages.length, 3);
    assert.equal(messages[2].role, "user");
    assert.equal(messages[2].content, "nuevo");
  });

  it("usa las instrucciones del agente en lugar de las notas genéricas", () => {
    const messages = buildMessages(
      [],
      "hola",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "INSTRUCCIONES DEL AGENTE",
    );
    const system = messages[0].content as string;

    assert.match(system, /INSTRUCCIONES DEL AGENTE/);
    assert.doesNotMatch(system, /NOTA IMPORTANTE/);
    assert.doesNotMatch(system, /TIENES ACCESO A BÚSQUEDA EN INTERNET/);
    assert.doesNotMatch(system, /TIENES ACCESO A UNA BASE DE CONOCIMIENTO/);
  });
});

describe("buildHeartInstructions", () => {
  function heart(tools: HeartTool[]) {
    return {
      name: "Analista",
      role: "Analista de datos",
      tone: "Técnico",
      instructions: "Analiza y resume.",
      limitations: "No inventes cifras.",
      tools,
    };
  }

  it("incluye identidad, comportamiento y límites", () => {
    const instructions = buildHeartInstructions(heart(["read_files"]));

    assert.match(instructions, /Eres el Heart "Analista"/);
    assert.match(instructions, /Rol: Analista de datos/);
    assert.match(instructions, /Tono: Técnico/);
    assert.match(instructions, /INSTRUCCIONES DEL HEART:\nAnaliza y resume\./);
    assert.match(instructions, /LÍMITES DEL HEART:\nNo inventes cifras\./);
  });

  it("solo anuncia las herramientas declaradas", () => {
    const instructions = buildHeartInstructions(heart(["read_files"]));

    assert.match(instructions, /base de conocimiento empresarial/);
    assert.match(instructions, /leer archivos adjuntos/);
    assert.doesNotMatch(instructions, /generar documentos/);
    assert.doesNotMatch(instructions, /buscar en internet/);
    assert.doesNotMatch(instructions, /analizar imágenes/);
    assert.doesNotMatch(instructions, /PUEDE generar y entregar archivos/);
    assert.doesNotMatch(instructions, /TIENES ACCESO A BÚSQUEDA EN INTERNET/);
  });

  it("añade las notas de documentos y web cuando están habilitadas", () => {
    const instructions = buildHeartInstructions(
      heart(["read_files", "generate_docs", "web_search", "analyze_images"]),
    );

    assert.match(instructions, /generar documentos/);
    assert.match(instructions, /buscar en internet/);
    assert.match(instructions, /analizar imágenes/);
    assert.match(instructions, /PUEDE generar y entregar archivos/);
    assert.match(instructions, /TIENES ACCESO A BÚSQUEDA EN INTERNET/);
    assert.match(instructions, /No generes imágenes dentro de un Heart/);
  });
});

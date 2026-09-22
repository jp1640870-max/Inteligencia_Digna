import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMessages } from "../lib/prompt-builder.js";

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
});

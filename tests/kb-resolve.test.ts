import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextAvailableName } from "../lib/kb.js";

describe("nextAvailableName", () => {
  it("devuelve 'base (2).ext' sin colisiones", () => {
    assert.equal(nextAvailableName("informe", ".pdf", () => false), "informe (2).pdf");
  });

  it("avanza a (3) si (2) existe (caso del bucle infinito original)", () => {
    const taken = new Set(["informe (2).pdf"]);
    assert.equal(
      nextAvailableName("informe", ".pdf", (c) => taken.has(c)),
      "informe (3).pdf"
    );
  });

  it("salta varias colisiones consecutivas", () => {
    const taken = new Set(["doc (2).xlsx", "doc (3).xlsx", "doc (4).xlsx"]);
    assert.equal(
      nextAvailableName("doc", ".xlsx", (c) => taken.has(c)),
      "doc (5).xlsx"
    );
  });

  it("soporta archivos sin extensión", () => {
    assert.equal(nextAvailableName("README", "", () => false), "README (2)");
  });

  it("soporta base con puntos (backup.tar + .gz)", () => {
    assert.equal(nextAvailableName("backup.tar", ".gz", () => false), "backup.tar (2).gz");
  });

  it("termina aunque existan huecos (p. ej. solo (3) ocupado)", () => {
    const taken = new Set(["a (3).txt"]);
    // (2) está libre → se usa (2), sin saltar al hueco posterior
    assert.equal(nextAvailableName("a", ".txt", (c) => taken.has(c)), "a (2).txt");
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chunkDocument, cosineSimilarity, formatRagContext } from "../lib/rag.js";

describe("cosineSimilarity", () => {
  it("vectores idénticos dan 1", () => {
    assert.ok(Math.abs(cosineSimilarity([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
  });

  it("vectores ortogonales dan 0", () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9);
  });

  it("relacionados puntúan más que no relacionados", () => {
    const a = [1, 0.1];
    const relacionado = [0.9, 0.2];
    const distinto = [0.1, 1];
    assert.ok(cosineSimilarity(a, relacionado) > cosineSimilarity(a, distinto));
  });
});

describe("chunkDocument", () => {
  it("texto vacío devuelve []", () => {
    assert.deepEqual(chunkDocument(""), []);
  });

  it("texto corto (pero >20 chars) devuelve un solo chunk", () => {
    assert.equal(chunkDocument("hola mundo, esta es una prueba", 100, 10).length, 1);
  });

  it("chunks de menos de 20 caracteres se descartan (filtro anti-ruido)", () => {
    assert.deepEqual(chunkDocument("hola mundo", 100, 10), []);
  });

  it("texto largo se parte en varios chunks no vacíos", () => {
    const chunks = chunkDocument("Un texto de prueba ".repeat(50), 100, 10);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((c) => c.length > 0));
  });
});

describe("formatRagContext", () => {
  it("vacío devuelve cadena vacía", () => {
    assert.equal(formatRagContext([]), "");
  });

  it("formatea documento y relevancia", () => {
    const out = formatRagContext([
      { content: "texto", score: 0.85, documentName: "manual.pdf" },
    ]);
    assert.ok(out.includes("manual.pdf"));
    assert.ok(out.includes("85%"));
    assert.ok(out.includes("texto"));
  });
});

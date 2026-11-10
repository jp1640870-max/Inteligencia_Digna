import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { markdownToDocGenBlocks } from "../lib/markdown-to-blocks.js";

describe("markdownToDocGenBlocks", () => {
  it("usa el primer H1 como título y conserva encabezados", () => {
    const blocks = markdownToDocGenBlocks("# Manual\n\n## Sección\n\nTexto.");
    assert.deepEqual(blocks[0], { type: "title", text: "Manual" });
    assert.deepEqual(blocks[1], { type: "heading", text: "Sección", level: 2 });
    assert.deepEqual(blocks[2], { type: "paragraph", text: "Texto." });
  });

  it("evita duplicar el título cuando se pasa explícitamente", () => {
    const blocks = markdownToDocGenBlocks("# Manual\n\nTexto.", "Manual");
    const titles = blocks.filter((block) => block.type === "title");
    assert.equal(titles.length, 1);
  });

  it("convierte listas y tablas GFM", () => {
    const blocks = markdownToDocGenBlocks(
      "- uno\n- dos\n\n| A | B |\n| - | - |\n| 1 | 2 |",
    );

    const paragraphs = blocks.filter((block) => block.type === "paragraph");
    assert.ok(paragraphs.some((block) => block.text.includes("• uno")));
    assert.ok(paragraphs.some((block) => block.text.includes("• dos")));

    const table = blocks.find((block) => block.type === "table");
    assert.ok(table && table.type === "table");
    assert.deepEqual(table.headers, ["A", "B"]);
    assert.deepEqual(table.rows, [["1", "2"]]);
  });

  it("sanitiza caracteres que pdf-lib no puede codificar", () => {
    const blocks = markdownToDocGenBlocks("Texto con → flecha y 😀 emoji.");
    const paragraph = blocks.find((block) => block.type === "paragraph");
    assert.ok(paragraph && paragraph.type === "paragraph");
    assert.match(paragraph.text, /-> flecha/);
    assert.equal(paragraph.text.includes("😀"), false);
  });

  it("produce al menos un bloque para Markdown vacío", () => {
    const blocks = markdownToDocGenBlocks("");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, "paragraph");
  });
});

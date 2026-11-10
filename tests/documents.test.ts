import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderDocumentArtifacts } from "../lib/documents.js";
import type { DocumentDraft } from "../lib/document-pipeline.js";

function draft(overrides: Partial<DocumentDraft> = {}): DocumentDraft {
  const markdown = [
    "# Manual de prueba",
    "",
    "Este es un párrafo con acentos: año, niño, corazón.",
    "",
    "## Procedimiento",
    "",
    "- Primer paso",
    "- Segundo paso → con flecha",
    "",
    "| Columna | Valor |",
    "| - | - |",
    "| A | 1 |",
  ].join("\n");

  return {
    title: "Manual de prueba",
    filename: "manual-de-prueba.pdf",
    format: "pdf",
    summary: "Un manual breve.",
    markdown,
    version: "1.0",
    generatedAt: new Date("2026-01-02T03:04:05.000Z"),
    maxPages: 10,
    truncated: false,
    continuationUsed: false,
    chars: markdown.length,
    ...overrides,
  };
}

describe("renderDocumentArtifacts", () => {
  it("usa pdf-lib como respaldo y conserva el DOCX fuente", async () => {
    const previous = process.env.DOC_PDF_ENGINE;
    process.env.DOC_PDF_ENGINE = "pdf-lib";
    try {
      const artifacts = await renderDocumentArtifacts(draft());

      assert.equal(artifacts.primaryFormat, "pdf");
      assert.equal(artifacts.engine, "pdf-lib");
      assert.equal(artifacts.mimeType, "application/pdf");
      assert.equal(artifacts.primaryBuffer.subarray(0, 4).toString(), "%PDF");
      assert.ok(artifacts.docxBuffer);
      assert.equal(artifacts.docxBuffer.subarray(0, 2).toString(), "PK");
      assert.ok((artifacts.pageCount ?? 0) >= 1);
    } finally {
      if (previous === undefined) delete process.env.DOC_PDF_ENGINE;
      else process.env.DOC_PDF_ENGINE = previous;
    }
  });

  it("genera solo DOCX cuando el formato pedido es docx", async () => {
    const artifacts = await renderDocumentArtifacts(
      draft({ format: "docx", filename: "manual-de-prueba.docx" }),
    );

    assert.equal(artifacts.primaryFormat, "docx");
    assert.equal(artifacts.engine, "docx");
    assert.equal(artifacts.primaryBuffer.subarray(0, 2).toString(), "PK");
    assert.equal(artifacts.pageCount, null);
  });
});

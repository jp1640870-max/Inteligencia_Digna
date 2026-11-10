import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { PDFDocument } from "pdf-lib";
import {
  convertDocxToPdf,
  isLibreOfficeAvailable,
  resolveLibreOfficeBinary,
} from "../lib/docx-to-pdf.js";
import { buildDocumentDocx } from "../lib/markdown-to-docx.js";

async function buildSampleDocx(): Promise<Buffer> {
  const doc = new Document({
    creator: "Inteligencia Digna",
    title: "Documento de prueba",
    sections: [
      {
        children: [
          new Paragraph({ text: "Manual de prueba", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [
              new TextRun({
                text: "Acentos: áéíóú ñ ¿¡. Símbolos: → ≤ ≥. Esto valida que ya no dependemos de WinAnsi.",
              }),
            ],
            spacing: { after: 200 },
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                tableHeader: true,
                children: ["Columna", "Valor"].map(
                  (text) =>
                    new TableCell({
                      children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })],
                    }),
                ),
              }),
              new TableRow({
                children: ["Fila 1", "Texto con acentos: ñandú"].map(
                  (text) => new TableCell({ children: [new Paragraph(text)] }),
                ),
              }),
            ],
          }),
        ],
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

const unavailableReason = isLibreOfficeAvailable()
  ? false
  : "LibreOffice no está instalado o LIBREOFFICE_BIN no es válido";

describe("docx-to-pdf", { skip: unavailableReason }, () => {
  it("resuelve el binario de LibreOffice", () => {
    assert.ok(resolveLibreOfficeBinary());
  });

  it("convierte un DOCX con acentos, símbolos y tablas en un PDF válido", async () => {
    const pdf = await convertDocxToPdf(await buildSampleDocx(), { timeoutMs: 120_000 });

    assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.ok(pdf.length > 1_000, "el PDF debería tener contenido");

    const parsed = await PDFDocument.load(pdf);
    assert.ok(parsed.getPageCount() >= 1);
  });

  it("convierte el DOCX con portada, header/footer y tabla a PDF", async () => {
    const docx = await buildDocumentDocx({
      title: "Manual de prueba",
      version: "1.0",
      date: new Date("2026-11-03T12:00:00Z"),
      markdown: `# Manual de prueba

Introducción con acentos: áéíóú ñ ¿¡ y símbolos: → ≤ ≥.

## Tabla de datos

| Columna | Valor |
| :--- | ---: |
| Fila 1 | ñandú |
| Fila 2 | 123 |

## Conclusión

Fin del documento.`,
    });

    const pdf = await convertDocxToPdf(docx.buffer, { timeoutMs: 120_000 });
    assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");

    const parsed = await PDFDocument.load(pdf);
    assert.ok(parsed.getPageCount() >= 2, "la portada y el cuerpo deben ocupar páginas distintas");
  });
});

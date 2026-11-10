import { describe, it } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  buildDocumentDocx,
  extractMarkdownTitle,
  sanitizeDocumentText,
  slugifyDocumentFilename,
} from "../lib/markdown-to-docx.js";

const SAMPLE = `# Manual de prueba

Introducción con **negritas**, *cursivas*, \`código\` y [un enlace](https://example.com). 🚀

## Objetivos

- Elemento uno
- Elemento dos
  - Elemento anidado

1. Primer paso
2. Segundo paso

> Cita importante con dos líneas.
> Segunda línea de la cita.

| Columna A | Columna B |
| :--- | ---: |
| uno | dos |
| tres | cuatro |

\`\`\`ts
const x = 1;
console.log(x);
\`\`\`

---

Texto final del documento.`;

async function documentXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file("word/document.xml");
  assert.ok(file, "debe existir word/document.xml");
  return file.async("string");
}

describe("sanitizeDocumentText", () => {
  it("quita emojis y controles pero conserva acentos y flechas", () => {
    const value = sanitizeDocumentText("Acción → fin 🚀\u0000");
    assert.equal(value.includes("🚀"), false);
    assert.equal(value.includes("\u0000"), false);
    assert.equal(value.includes("Acción → fin"), true);
  });
});

describe("extractMarkdownTitle / slugifyDocumentFilename", () => {
  it("extrae el primer H1", () => {
    assert.equal(extractMarkdownTitle("# Título principal\n\nTexto"), "Título principal");
    assert.equal(extractMarkdownTitle("Introducción\n\n# Título tardío"), "Título tardío");
  });

  it("genera nombres de archivo sin acentos ni símbolos", () => {
    assert.equal(
      slugifyDocumentFilename("Manual de Prueba: Año 2026", "pdf"),
      "manual-de-prueba-ano-2026.pdf",
    );
    assert.equal(slugifyDocumentFilename("", "docx"), "documento.docx");
  });
});

describe("buildDocumentDocx", () => {
  it("genera un DOCX con portada, encabezados, listas, tabla, cita y código", async () => {
    const result = await buildDocumentDocx({
      markdown: SAMPLE,
      title: "Manual de prueba",
      subtitle: "Guía interna",
      version: "2.1",
      date: new Date("2026-11-03T12:00:00Z"),
    });

    assert.equal(result.buffer.subarray(0, 2).toString(), "PK");
    assert.equal(result.title, "Manual de prueba");
    assert.equal(result.filename, "manual-de-prueba.docx");

    const xml = await documentXml(result.buffer);
    assert.match(xml, /Manual de prueba/);
    assert.match(xml, /Guía interna/);
    assert.match(xml, /Introducción/);
    assert.match(xml, /negritas/);
    assert.match(xml, /Cita importante/);
    assert.match(xml, /Columna A/);
    assert.match(xml, /Primer paso/);
    assert.match(xml, /const x = 1;/);
    assert.match(xml, /<w:tbl>/);
    assert.match(xml, /w:type="page"/);
    assert.equal(xml.includes("🚀"), false);
  });

  it("incluye header y footer, pero los oculta en la portada", async () => {
    const result = await buildDocumentDocx({ markdown: SAMPLE, title: "Manual de prueba" });
    const zip = await JSZip.loadAsync(result.buffer);
    const names = Object.keys(zip.files);
    assert.ok(names.some((name) => name.startsWith("word/header")));
    assert.ok(names.some((name) => name.startsWith("word/footer")));

    const document = await documentXml(result.buffer);
    assert.match(document, /w:titlePg/);
  });

  it("puede omitir portada y header/footer", async () => {
    const result = await buildDocumentDocx({
      markdown: "# Solo título\n\nTexto del cuerpo.",
      includeCover: false,
      includeHeaderFooter: false,
    });

    const xml = await documentXml(result.buffer);
    assert.match(xml, /Solo título/);
    assert.match(xml, /Texto del cuerpo/);
    assert.equal(xml.includes('w:type="page"'), false);
    assert.equal(xml.includes("w:titlePg"), false);
  });

  it("renderiza listas de tareas sin duplicar el texto", async () => {
    const result = await buildDocumentDocx({
      markdown: "# Tareas\n\n- [x] Hecho\n- [ ] Pendiente",
    });
    const xml = await documentXml(result.buffer);
    assert.match(xml, /\[x\]/);
    assert.match(xml, /\[ \]/);
    assert.equal(xml.split("Hecho").length - 1, 1);
  });

  it("usa un título por defecto cuando el Markdown está vacío", async () => {
    const result = await buildDocumentDocx({ markdown: "" });
    assert.equal(result.title, "Documento");
    assert.equal(result.filename, "documento.docx");
  });
});

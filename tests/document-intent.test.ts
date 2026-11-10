import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectDocFormat,
  detectExportIntent,
  findDocumentRequest,
  isDocumentRetry,
  resolveDocumentIntent,
  wantsDocument,
} from "../lib/document-intent.js";
import type { DocumentIntentMode } from "../lib/document-pipeline.js";

describe("wantsDocument", () => {
  it("detecta la frase real que fallaba antes", () => {
    assert.equal(
      wantsDocument("Hazme un manual que explique este proceso para descargar en pdf"),
      true,
    );
  });

  it("detecta peticiones explícitas de archivo", () => {
    const requests = [
      "Hazme un manual en PDF",
      "Genera un manual de reparación en PDF",
      "Hazme un pdf",
      "Créame un documento en Word",
      "Hazme un documento en PDF",
      "Necesito un manual en pdf",
      "Hazme un informe",
      "Hazme una tabla",
      "Dame el archivo",
      "¿Me puedes hacer un manual de usuario?",
      "Quiero que me prepares un reporte",
    ];

    for (const request of requests) {
      assert.equal(wantsDocument(request), true, request);
    }
  });

  it("no convierte preguntas o descargas en generación", () => {
    const requests = [
      "¿Cómo hago un PDF?",
      "Explícame cómo se hace un documento en Word",
      "No me generes un PDF",
      "No me puedes hacer un manual",
      "Quiero descargar el PDF",
      "Explícame el documento",
      "Hazme un resumen de la conversación",
      "¿Qué es un PDF?",
      "Hazme una tabla de contenido",
    ];

    for (const request of requests) {
      assert.equal(wantsDocument(request), false, request);
    }
  });
});

describe("detectDocFormat", () => {
  it("prioriza el formato explícito sobre 'documento'", () => {
    assert.equal(detectDocFormat("Hazme un documento en pdf"), "pdf");
    assert.equal(detectDocFormat("Hazme un documento en word"), "docx");
    assert.equal(detectDocFormat("Hazme un documento en excel"), "xlsx");
    assert.equal(detectDocFormat("Hazme un manual en PDF"), "pdf");
  });

  it("usa xlsx para tablas sueltas y pdf para documentos con tablas", () => {
    assert.equal(detectDocFormat("Hazme una tabla de multiplicar"), "xlsx");
    assert.equal(detectDocFormat("Hazme un manual con una tabla"), "pdf");
    assert.equal(detectDocFormat("Hazme un manual con tabla de contenido"), "pdf");
  });

  it("por defecto genera PDF", () => {
    assert.equal(detectDocFormat("Hazme un manual"), "pdf");
  });
});

describe("resolveDocumentIntent", () => {
  const history = [
    { role: "user" as const, text: "Hazme un manual en Word" },
    { role: "ai" as const, text: "Claro, lo preparo." },
  ];

  it("reutiliza la petición anterior en un reintento", () => {
    const intent = resolveDocumentIntent("Inténtalo otra vez", history);
    assert.equal(intent.wantsDocument, true);
    assert.equal(intent.request, "Hazme un manual en Word");
    assert.equal(intent.format, "docx");
    assert.equal(intent.isRetry, true);
  });

  it("respeta un formato nuevo dentro del reintento", () => {
    const intent = resolveDocumentIntent("Inténtalo otra vez pero en pdf", history);
    assert.equal(intent.wantsDocument, true);
    assert.equal(intent.request, "Hazme un manual en Word");
    assert.equal(intent.format, "pdf");
  });

  it("no inventa una petición si no hay historial", () => {
    const intent = resolveDocumentIntent("Inténtalo otra vez", []);
    assert.equal(intent.wantsDocument, false);
    assert.equal(intent.isRetry, true);
  });

  it("encuentra la última petición de documento", () => {
    assert.equal(findDocumentRequest(history), "Hazme un manual en Word");
    assert.equal(isDocumentRetry("No funcionó, otra vez"), true);
    assert.equal(isDocumentRetry("Hola"), false);
  });

  it("detecta corrección de formato de un documento anterior", () => {
    assert.equal(isDocumentRetry("Mejor en Word"), true);
    assert.equal(isDocumentRetry("Mejor en Excel"), true);
    assert.equal(isDocumentRetry("Cámbialo a PDF"), true);
    assert.equal(isDocumentRetry("Hazlo como Word"), true);
    assert.equal(isDocumentRetry("Que sea en docx"), true);
    assert.equal(isDocumentRetry("Cámbialo pero en Word"), true);
    assert.equal(isDocumentRetry("Inténtalo otra vez"), true);
    assert.equal(isDocumentRetry("Hola, ¿cómo estás?"), false);
    assert.equal(isDocumentRetry("Te gustaría un documento?"), false);
  });
});

describe("detectExportIntent", () => {
  it("detecta exportación a PDF con referencia y verbo de exportación", () => {
    const intent = detectExportIntent("Exporta esto a PDF");
    assert.equal(intent.wantsExport, true);
    assert.equal(intent.format, "pdf");
    assert.equal(intent.unsupportedFormat, undefined);
  });

  it("detecta 'pásalo a Word'", () => {
    const intent = detectExportIntent("Pásalo a Word");
    assert.equal(intent.wantsExport, true);
    assert.equal(intent.format, "docx");
  });

  it("detecta 'convierte la respuesta anterior a PDF'", () => {
    const intent = detectExportIntent("Convierte la respuesta anterior a PDF");
    assert.equal(intent.wantsExport, true);
    assert.equal(intent.format, "pdf");
  });

  it("usa PDF por defecto cuando no hay formato explícito", () => {
    const intent = detectExportIntent("Exporta esto");
    assert.equal(intent.wantsExport, true);
    assert.equal(intent.format, "pdf");
  });

  it("detecta 'guarda esto como docx'", () => {
    const intent = detectExportIntent("Guarda esto como docx");
    assert.equal(intent.wantsExport, true);
    assert.equal(intent.format, "docx");
  });

  it("no exporta preguntas o negaciones", () => {
    const negatives = [
      "¿Cómo exporto a PDF?",
      "¿Se puede exportar esto a Word?",
      "No exportes esto",
      "No conviertas la respuesta",
      "¿Cómo se hace un PDF?",
      "Explícame cómo exportar",
      "Exporta el proyecto", // sin referencia ni formato
      "Pásalo", // sin formato ni referencia clara
      "¿Dónde está el archivo?",
    ];
    for (const text of negatives) {
      const intent = detectExportIntent(text);
      assert.equal(intent.wantsExport, false, text);
    }
  });

  it("marca Excel como no soportado", () => {
    const intent = detectExportIntent("Exporta esto a Excel");
    assert.equal(intent.wantsExport, true);
    assert.equal(intent.format, "pdf");
    assert.equal(intent.unsupportedFormat, "xlsx");
  });

  it("exporta con verbos de conversión y referencia, incluso sin formato (PDF por defecto)", () => {
    const intent = detectExportIntent("Convierte esto");
    assert.equal(intent.wantsExport, true);
    assert.equal(intent.format, "pdf");
    const intent2 = detectExportIntent("Convierte esto a PDF");
    assert.equal(intent2.wantsExport, true);
    assert.equal(intent2.format, "pdf");
  });
});

describe("resolveDocumentIntent modes", () => {
  const history = [
    { role: "user" as const, text: "Hazme un manual en Word" },
    { role: "ai" as const, text: "Claro, lo preparo." },
  ];

  it("nueva petición genera mode 'new'", () => {
    const intent = resolveDocumentIntent("Hazme un manual", history);
    assert.equal(intent.mode, "new");
    assert.equal(intent.forceReset, false);
    assert.equal(intent.isRetry, false);
  });

  it("reintento genera mode 'retry'", () => {
    const intent = resolveDocumentIntent("Inténtalo otra vez", history);
    assert.equal(intent.mode, "retry");
    assert.equal(intent.isRetry, true);
  });

  it("continuación genera mode 'continue'", () => {
    const intent = resolveDocumentIntent("Genera el documento PDF y continúa el texto", history);
    assert.equal(intent.mode, "continue");
    assert.equal(intent.forceReset, false);
    assert.equal(intent.wantsDocument, true);
  });

  it("'desde cero' fuerza regeneración (forceReset)", () => {
    const intent = resolveDocumentIntent("Hazlo de nuevo desde cero", history);
    assert.equal(intent.mode, "new");
    assert.equal(intent.forceReset, true);
    assert.equal(intent.wantsDocument, true);
  });

  it("'desde cero' fuerza regeneración (forceReset)", () => {
    const intent = resolveDocumentIntent("Hazme un documento desde cero", history);
    assert.equal(intent.mode, "new");
    assert.equal(intent.forceReset, true);
    assert.equal(intent.wantsDocument, true);
  });

  it("'hazlo de nuevo desde cero' fuerza regeneración (forceReset)", () => {
    const intent = resolveDocumentIntent("Hazlo de nuevo desde cero", history);
    assert.equal(intent.mode, "new");
    assert.equal(intent.forceReset, true);
    assert.equal(intent.wantsDocument, true);
  });

  it("sigue el documento genera mode 'continue'", () => {
    const intent = resolveDocumentIntent("Hazme un documento y sigue el PDF", history);
    assert.equal(intent.mode, "continue");
    assert.equal(intent.wantsDocument, true);
  });

  it("termina el documento genera mode 'continue'", () => {
    const intent = resolveDocumentIntent("Hazme un documento y termina el Word", history);
    assert.equal(intent.mode, "continue");
    assert.equal(intent.wantsDocument, true);
  });

  it("lo que falta genera mode 'continue'", () => {
    const intent = resolveDocumentIntent("Hazme el documento y agrega lo que falta del PDF", history);
    assert.equal(intent.mode, "continue");
    assert.equal(intent.wantsDocument, true);
  });

  it("reintento y continuación no coinciden: continue gana", () => {
    const intent = resolveDocumentIntent("Genera el documento Excel y continúa otra vez", history);
    assert.equal(intent.mode, "continue");
    assert.equal(intent.isRetry, true);
    assert.equal(intent.wantsDocument, true);
  });

  it("continuación con verbo de creación genera mode 'continue'", () => {
    const intent = resolveDocumentIntent("Hazme un documento y continúa el texto", history);
    assert.equal(intent.mode, "continue");
    assert.equal(intent.wantsDocument, true);
  });
});

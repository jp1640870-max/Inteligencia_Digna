import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildDocumentMessages,
  clampDocumentMarkdown,
  clampDocumentMarkdownToWords,
  cleanMarkdown,
  cleanSummary,
  countDocumentWords,
  generateDocumentDraft,
  parseDocumentResponse,
  resolveDocumentLengthHint,
  resolveDocumentMaxPages,
  type DocumentPipelineEvent,
  type DocumentStreamFn,
} from "../lib/document-pipeline.js";
import { OllamaTimeoutError } from "../lib/ollama.js";

function staticStream(chunks: string[], doneReason = "stop"): DocumentStreamFn {
  return async function* (_model, _messages, options) {
    for (const chunk of chunks) yield chunk;
    options?.onDone?.({ doneReason });
  };
}

describe("parseDocumentResponse", () => {
  it("separa resumen y documento por el delimitador", () => {
    const parsed = parseDocumentResponse(
      "RESUMEN: Un manual breve.\n\n<<<DOCUMENTO>>>\n# Título\n\nContenido.",
    );
    assert.equal(parsed.summary, "Un manual breve.");
    assert.equal(parsed.markdown, "# Título\n\nContenido.");
  });

  it("limpia fences externos y resumen con negritas", () => {
    const parsed = parseDocumentResponse(
      "**RESUMEN:** Texto de prueba.\n\n<<<DOCUMENTO>>>\n```markdown\n# Título\n\nContenido.\n```",
    );
    assert.equal(parsed.summary, "Texto de prueba.");
    assert.equal(parsed.markdown, "# Título\n\nContenido.");
  });

  it("tolera que el modelo olvide el delimitador", () => {
    const parsed = parseDocumentResponse("RESUMEN: Texto de prueba.\n\n# Título\n\nContenido.");
    assert.equal(parsed.summary, "Texto de prueba.");
    assert.equal(parsed.markdown, "# Título\n\nContenido.");
  });
});

describe("cleanSummary / cleanMarkdown", () => {
  it("normaliza el resumen", () => {
    assert.equal(cleanSummary("  RESUMEN:   Hola   mundo.  "), "Hola mundo.");
    assert.equal(cleanSummary("**RESUMEN:** Hola mundo."), "Hola mundo.");
  });

  it("quita un fence que envuelve todo el documento", () => {
    assert.equal(cleanMarkdown("```md\n# Título\n\nTexto\n```"), "# Título\n\nTexto");
  });
});

describe("buildDocumentMessages", () => {
  it("incluye contexto, historial y evita duplicar el mensaje actual", () => {
    const messages = buildDocumentMessages({
      message: "Hazme un manual",
      maxPages: 4,
      projectContext: "Proyecto X",
      kbContext: "Base Y",
      history: [
        { role: "user", text: "Hazme un manual" },
        { role: "ai", text: "Claro, lo preparo." },
      ],
    });

    assert.equal(messages[0].role, "system");
    assert.match(messages[0].content, /4 páginas/);
    assert.equal(
      messages.some((message) => message.role === "user" && message.content === "Hazme un manual"),
      false,
    );
    assert.ok(
      messages.some(
        (message) => message.role === "assistant" && message.content === "Claro, lo preparo.",
      ),
    );

    const last = messages[messages.length - 1];
    assert.match(last.content, /Proyecto X/);
    assert.match(last.content, /Base Y/);
    assert.match(last.content, /SOLICITUD DEL DOCUMENTO/);
  });

  it("limita las páginas a un máximo de 10", () => {
    assert.equal(resolveDocumentMaxPages(50), 10);
    assert.equal(resolveDocumentMaxPages(0), 1);
    assert.equal(resolveDocumentMaxPages(undefined), 10);
  });

  it("resuelve 2 páginas cuando el mensaje pide 'breve'", () => {
    assert.equal(resolveDocumentMaxPages(undefined, "Hazme un breve resumen"), 2);
    assert.equal(resolveDocumentMaxPages(undefined, "generame un pdf corto"), 2);
  });

  it("resuelve páginas explícitas del mensaje", () => {
    assert.equal(resolveDocumentMaxPages(undefined, "hazme un ensayo de 5 páginas"), 5);
    assert.equal(resolveDocumentMaxPages(undefined, "hazme un resumen de 3 hojas"), 3);
  });

  it("ignora páginas que describen la fuente y aplica 'breve'", () => {
    assert.equal(
      resolveDocumentMaxPages(undefined, "resumen del reporte de 4 páginas breve"),
      2,
    );
  });

  it("ignora páginas que describen la fuente y usa default", () => {
    assert.equal(
      resolveDocumentMaxPages(undefined, "análisis del documento de 5 hojas"),
      10,
    );
  });

  it("número explícito gana sobre 'breve'", () => {
    assert.equal(
      resolveDocumentMaxPages(undefined, "breve ensayo de 5 páginas"),
      5,
    );
  });
});

describe("resolveDocumentLengthHint", () => {
  it("devuelve 'explicit-pages' cuando hay número explícito", () => {
    assert.equal(resolveDocumentLengthHint(undefined, "hazme un manual de 3 páginas"), "explicit-pages");
  });

  it("devuelve 'brief' cuando pide breve sin número", () => {
    assert.equal(resolveDocumentLengthHint(undefined, "hazme un breve resumen"), "brief");
  });

  it("devuelve 'default' cuando no hay indicación", () => {
    assert.equal(resolveDocumentLengthHint(undefined, "hazme un manual"), "default");
  });

  it("devuelve 'explicit-pages' cuando se pasa maxPages", () => {
    assert.equal(resolveDocumentLengthHint(5), "explicit-pages");
  });
});

describe("generateDocumentDraft", () => {
  it("genera resumen, Markdown y eventos con una respuesta completa", async () => {
    const events: DocumentPipelineEvent[] = [];
    const stream = staticStream([
      "RESUMEN: Manual breve de prueba.\n\n",
      "<<<DOCUMENTO>>>\n# Manual de prueba\n\n",
      "Contenido con **negritas**.\n",
    ]);

    const draft = await generateDocumentDraft(
      {
        message: "Hazme un manual",
        format: "pdf",
        onEvent: (event) => events.push(event),
      },
      { stream },
    );

    assert.equal(draft.title, "Manual de prueba");
    assert.equal(draft.summary, "Manual breve de prueba.");
    assert.equal(draft.filename, "manual-de-prueba.pdf");
    assert.match(draft.markdown, /Contenido con/);
    assert.equal(draft.truncated, false);
    assert.equal(draft.continuationUsed, false);
    assert.ok(events.some((event) => event.type === "summary" && event.text === draft.summary));
    assert.ok(events.some((event) => event.type === "status" && event.stage === "analyzing"));
    assert.ok(events.some((event) => event.type === "progress"));
  });

  it("pide una continuación cuando el modelo se corta por longitud", async () => {
    let calls = 0;
    const stream: DocumentStreamFn = async function* (_model, messages, options) {
      calls += 1;
      if (calls === 1) {
        yield "RESUMEN: Documento largo.\n<<<DOCUMENTO>>>\n# Título\n\nPrimera parte";
        options?.onDone?.({ doneReason: "length" });
        return;
      }

      const continuationPrompt = messages[messages.length - 1].content;
      assert.match(continuationPrompt, /Primera parte/);
      yield " y segunda parte.";
      options?.onDone?.({ doneReason: "stop" });
    };

    const draft = await generateDocumentDraft(
      { message: "Hazme un manual", format: "docx" },
      { stream },
    );

    assert.equal(calls, 2);
    assert.equal(draft.continuationUsed, true);
    assert.equal(draft.truncated, false);
    assert.equal(draft.filename, "titulo.docx");
    assert.match(draft.markdown, /Primera parte y segunda parte\./);
  });

  it("conserva el documento parcial si la continuación falla", async () => {
    let calls = 0;
    const stream: DocumentStreamFn = async function* (_model, _messages, options) {
      calls += 1;
      if (calls === 1) {
        yield "RESUMEN: Documento parcial.\n<<<DOCUMENTO>>>\n# Título\n\nContenido inicial";
        options?.onDone?.({ doneReason: "length" });
        return;
      }

      throw new Error("falló la continuación");
    };

    const draft = await generateDocumentDraft({ message: "Hazme un manual" }, { stream });
    assert.equal(draft.continuationUsed, false);
    assert.equal(draft.truncated, true);
    assert.match(draft.markdown, /Contenido inicial/);
  });

  it("usa un resumen de respaldo si el modelo no lo escribe", async () => {
    const stream = staticStream(["# Documento sin resumen\n\nEste es el primer párrafo del documento."]);
    const draft = await generateDocumentDraft({ message: "Hazme un manual" }, { stream });
    assert.equal(draft.summary, "Este es el primer párrafo del documento.");
  });

  it("rechaza una respuesta vacía", async () => {
    const stream = staticStream([]);
    await assert.rejects(
      () => generateDocumentDraft({ message: "Hazme un manual" }, { stream }),
      /no devolvió contenido/i,
    );
  });

  it("conserva contenido parcial si el stream se corta por timeout", async () => {
    let calls = 0;
    const stream: DocumentStreamFn = async function* (_model, _messages, options) {
      calls += 1;
      yield "RESUMEN: Documento parcial.\n<<<DOCUMENTO>>>\n# Título\n\nContenido generado";
      throw new OllamaTimeoutError("Ollama no envió datos durante 120000 ms", "idle");
    };

    const draft = await generateDocumentDraft({ message: "Hazme un manual" }, { stream });

    assert.equal(draft.partial, true);
    assert.match(draft.markdown, /Contenido generado/);
    assert.match(draft.markdown, /> \*\*Nota:\*\* La generación se detuvo/);
    assert.ok(draft.sourceMarkdown);
    assert.ok(!draft.sourceMarkdown.includes("> **Nota:**"));
  });

  it("falla con mensaje específico si el timeout ocurre sin contenido", async () => {
    const stream: DocumentStreamFn = async function* () {
      throw new OllamaTimeoutError("Ollama no envió datos durante 120000 ms", "idle");
    };

    await assert.rejects(
      () => generateDocumentDraft({ message: "Hazme un manual" }, { stream }),
      /tiempo límite antes de producir contenido/i,
    );
  });

  it("continúa un documento parcial desde el Markdown fuente", async () => {
    let calls = 0;
    const stream: DocumentStreamFn = async function* (_model, messages, options) {
      calls += 1;
      if (calls === 1) {
        // Continuación: recibe el Markdown parcial como contexto
        const last = messages[messages.length - 1].content;
        assert.match(last, /Contenido parcial previo/);
        yield " continuación del documento.";
        options?.onDone?.({ doneReason: "stop" });
        return;
      }
      throw new Error("no debería llamarse");
    };

    const draft = await generateDocumentDraft(
      {
        message: "continúa el documento",
        continuation: {
          markdown: "# Título\n\nContenido parcial previo",
          summary: "Resumen previo",
          title: "Título",
          version: "1.0",
        },
      },
      { stream },
    );

    assert.equal(calls, 1);
    assert.equal(draft.continuationUsed, true);
    assert.equal(draft.mode, "continue");
    assert.equal(draft.version, "1.0");
    assert.match(draft.markdown, /Contenido parcial previo continuación del documento\./);
  });

  it("rechaza continuación cuando el documento ya llegó al límite de páginas", async () => {
    // 10 páginas × 450 palabras = 4500 palabras; usamos mucho texto para llenarlo
    const fullMarkdown = "# Título\n\n" + "palabra ".repeat(5000);
    await assert.rejects(
      () =>
        generateDocumentDraft(
          {
            message: "continúa el documento",
            continuation: {
              markdown: fullMarkdown,
              summary: "Resumen previo",
              title: "Título",
              version: "1.0",
            },
          },
          { stream: staticStream([]) },
        ),
      /máximo de páginas/i,
    );
  });
});

describe("countDocumentWords", () => {
  it("cuenta palabras separadas por espacios", () => {
    assert.equal(countDocumentWords("Hola mundo"), 2);
    assert.equal(countDocumentWords(""), 0);
    assert.equal(countDocumentWords("   "), 0);
    assert.equal(countDocumentWords("a   b\tc\nd"), 4);
  });
});

describe("clampDocumentMarkdownToWords", () => {
  it("no corta cuando ya está dentro del límite", () => {
    const texto = "# Título\n\nPárrafo corto.";
    const result = clampDocumentMarkdownToWords(texto, 1000, 10);
    assert.equal(result.truncated, false);
    assert.equal(result.markdown, texto);
    assert.equal(result.words, result.originalWords);
    assert.equal(result.originalChars, texto.length);
  });

  it("corta y añade nota cuando excede el límite", () => {
    const texto = "palabra ".repeat(1000);
    const result = clampDocumentMarkdownToWords(texto, 100, 10);
    assert.equal(result.truncated, true);
    assert.equal(result.originalWords, 1000);
    assert.ok(result.markdown.includes("> **Nota:**"));
    assert.ok(result.markdown.includes("límite de 10 páginas"));
    assert.ok(result.words <= 100, `expected <=100, got ${result.words}`);
  });

  it("no duplica la nota al cortar dos veces", () => {
    const texto = "# Título\n\n" + "palabra ".repeat(200);
    const primero = clampDocumentMarkdownToWords(texto, 50, 10);
    const segundo = clampDocumentMarkdownToWords(primero.markdown, 30, 10);
    assert.equal(segundo.markdown.split("**Nota:**").length, 2);
    assert.equal(segundo.truncated, true);
  });
});

describe("clampDocumentMarkdown", () => {
  it("corta al límite de páginas por defecto", () => {
    const texto = "palabra ".repeat(5000);
    const result = clampDocumentMarkdown(texto, 10);
    assert.equal(result.truncated, true);
    assert.ok(result.markdown.includes("límite de 10 páginas"));
    assert.ok(result.words <= 4500);
  });

  it("no corta cuando cabe dentro del límite", () => {
    const texto = "palabra ".repeat(100);
    const result = clampDocumentMarkdown(texto, 10);
    assert.equal(result.truncated, false);
    assert.equal(result.markdown, texto.trim());
  });
});

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import {
  getChatsByUser,
  getChatById,
  createChat,
  addMessage,
  deleteChat,
  updateChatTitle,
  truncateMessagesToCount,
} from "@/lib/db";
import { ollamaChat, ollamaChatStream, type OllamaMessage } from "@/lib/ollama";
import { buildMessages } from "@/lib/prompt-builder";
import { getUserIdFromRequest } from "@/lib/auth";
import { getProjectById, syncProjectChatTitle } from "@/lib/projects";
import { generateDocument } from "@/lib/document-generator";
import { searchWeb, formatSearchResults, shouldAutoSearch } from "@/lib/web-search";
import { retrieveRelevantChunks, formatRagContext } from "@/lib/rag";
import type { DocGenStructure, DocGenFormat, EditResult, SearchResult } from "@/types";



const DOC_PATTERN = /(?:dame|pasame|pásame|comparte|comparteme|compárteme|mandame|mándame|envíame|envíame|regálame|regalame|sácame|sacame|quiero\s+que\s+me\s+(?:des|pases|compartas|mandes|envíes)|me\s+puedes\s+(?:dar|pasar|compartir|mandar|enviar)|me\s+(?:das|pasarías|darías)|necesito\s+que\s+me\s+(?:des|pases)|crea|crear|genera|generar|haz|hacer|hacerme|elabora|elaborar|prepara|preparar|arma|armar|necesito|quiero|puedes\s+(?:crear|hacer|generar|elaborar)|me\s+puedes\s+(?:ayudar\s+a\s+)?(?:crear|hacer|generar|elaborar)|ayudame\s+a\s+(?:crear|hacer|generar|elaborar)|hazme|crearme|generarme|preparame)\s+(?:(?:un|una|el|la)\s+)?(?:excel|xlsx|word|docx|pdf|documento|tabla|hoja\s+(?:de\s+)?(?:cálculo|calculo)|archivo\s+(?:de\s+)?(?:excel|word|pdf|texto))/i;

const RETRY_PATTERN = /(?:intenta|intentalo|vuelve|vuelve\s+a\s+intentar|otra\s+vez|de\s+nuevo|no\s+funcion|fall|reintenta|reintentar|otro\s+intento|otra\s+vez)/i;

function detectFormat(text: string): DocGenFormat {
  const lower = text.toLowerCase();
  if (/\b(?:excel|xlsx|tabla|hoja\s+(?:de\s+)?cálculo|hoja\s+(?:de\s+)?calculo|spreadsheet)\b/i.test(lower)) return "xlsx";
  if (/\b(?:word|docx|documento)\b/i.test(lower)) return "docx";
  if (/\bpdf\b/i.test(lower)) return "pdf";
  return "xlsx";
}

function findMatchingMessage(history: HistoryItem[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === "user" && msg.text && DOC_PATTERN.test(msg.text)) {
      return msg.text;
    }
  }
  return null;
}

function extractJson(text: string): string {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1) return text.slice(start, end + 1);
  throw new Error("No se encontró JSON en la respuesta de la IA");
}

const CONTENT_TYPE_MAP: Record<DocGenFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

type HistoryItem = { role: "user" | "ai"; text?: string; images?: string[] };

async function handleDocumentCreation(
  model: string,
  chatId: string,
  message: string,
  filesContent: string,
  history: HistoryItem[],
  images: string[],
  projectContext: string,
  ragContext: string,
  format: DocGenFormat
): Promise<{ text: string; editResult: EditResult; docData: string }> {
  const formatLabel = { xlsx: "Excel", docx: "Word", pdf: "PDF" }[format];

  const jsonPrompt = `Genera ÚNICAMENTE un JSON válido para crear un archivo ${formatLabel} con el siguiente contenido:

${message}

${filesContent ? `\nDatos adicionales:\n${filesContent}\n` : ""}

${format === "xlsx"
  ? `Formato EXCEL:
{
  "format": "xlsx",
  "filename": "nombre.xlsx",
  "sheets": [
    {
      "name": "Hoja1",
      "headers": ["Columna1", "Columna2"],
      "rows": [
        ["dato1", "dato2"],
        ["dato3", "dato4"]
      ]
    }
  ]
}`
  : `Formato ${formatLabel}:
{
  "format": "${format}",
  "filename": "nombre.${format}",
  "content": [
    { "type": "title", "text": "Título" },
    { "type": "heading", "text": "Sección", "level": 1 },
    { "type": "paragraph", "text": "Texto del párrafo..." },
    { "type": "table", "headers": ["Col1", "Col2"], "rows": [["a", "b"]] }
  ]
}`
}

REGLAS:
- Devuelve SOLO el JSON, sin texto adicional, sin markdown.
- Los datos deben ser COMPLETOS. No trunques filas ni contenido.
- Para Excel: TODAS las filas deben estar incluidas.
- Para Word/PDF: incluye todo el contenido solicitado.
- El filename debe terminar en .${format}.`;

  const jsonMessages: OllamaMessage[] = [
    { role: "system", content: "Eres un generador de documentos. Devuelve ÚNICAMENTE JSON válido, sin texto adicional, sin markdown, sin explicaciones." },
    { role: "user", content: jsonPrompt },
  ];

  const normalMessages = buildMessages(history, message, filesContent || undefined, projectContext || undefined, undefined, ragContext || undefined);
  if (images.length > 0 && normalMessages.length > 0) {
    normalMessages[normalMessages.length - 1].images = images;
  }

  console.log(`📄 Generando ${formatLabel} (llamadas paralelas)...`);

  const [jsonResponse, textResponse] = await Promise.all([
    ollamaChat(model, jsonMessages),
    ollamaChat(model, normalMessages),
  ]);

  const cleaned = extractJson(jsonResponse);
  const structure: DocGenStructure = JSON.parse(cleaned);

  if (!structure.format || !structure.filename) {
    throw new Error("El JSON devuelto por la IA no tiene la estructura correcta");
  }

  console.log(`📄 Estructura JSON recibida, generando archivo...`);
  const { buffer } = await generateDocument(structure);
  const base64 = buffer.toString("base64");

  const changesCount = format === "xlsx"
    ? (structure.sheets || []).reduce((sum, s) => sum + s.rows.length, 0)
    : (structure.content || []).length;

  const docData = JSON.stringify({
    format,
    filename: structure.filename,
    structure,
    data: base64,
    changesCount,
  });

  const editResult: EditResult = {
    success: true,
    format,
    filename: structure.filename,
    originalName: structure.filename,
    changesCount,
    dataUri: `data:${CONTENT_TYPE_MAP[format]};base64,${base64}`,
  };

  return { text: textResponse, editResult, docData };
}


async function doStream(
  model: string,
  messages: OllamaMessage[],
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
  chatId: string,
  onFullReply: (reply: string) => void,
): Promise<void> {
  let fullReply = "";
  const startTime = Date.now();
  let cont = 0;

  try {
    console.log("🤖 Ollama streaming: modelo=", model, "| mensajes:", messages.length);
    const generator = ollamaChatStream(model, messages);
    for await (const chunk of generator) {
      if (cont === 0) console.log(`🤖 Primer chunk en ${Date.now() - startTime}ms: "${chunk.slice(0, 40)}..."`);
      cont++;
      fullReply += chunk;
      await writer.write(encoder.encode(chunk));
    }
    console.log(`🤖 OK: ${cont} chunks, ${fullReply.length} chars, ${Date.now() - startTime}ms`);

    if (!fullReply || fullReply.length < 2) {
      throw new Error("respuesta vacía");
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.log(`⚡ Error streaming: ${errMsg}, parcial: "${fullReply.slice(0, 40)}..."`);
    if (fullReply && fullReply.length >= 2) {
      console.log("⚡ Continúa con contenido parcial");
    } else {
      console.log("⚡ Retry con mismo modelo");
      let retried = false;
      try {
        fullReply = "";
        const retryGen = ollamaChatStream(model, messages);
        let cont2 = 0;
        for await (const chunk of retryGen) {
          if (cont2 === 0) retried = true;
          cont2++;
          fullReply += chunk;
          await writer.write(encoder.encode(chunk));
        }
        if (retried) console.log(`⚡ Retry OK: ${cont2} chunks, ${fullReply.length} chars`);
        if (!fullReply || fullReply.length < 2) {
          throw new Error("respuesta vacía");
        }
      } catch (e2) {
        const err2 = e2 instanceof Error ? e2.message : String(e2);
        console.log(`⚡ Fallback tras error: ${err2}`);
        fullReply = "No se pudo responder.";
        try { await writer.write(encoder.encode(fullReply)); } catch (we) { console.log("⚡ Error al escribir fallback:", we); }
      }
    }
  } finally {
    fullReply = fullReply.trim();
    if (fullReply && fullReply !== "No se pudo responder.") {
      try { addMessage(chatId, "assistant", fullReply); } catch {}
      console.log("💾 DB guardado:", fullReply.length, "chars");
    }
    onFullReply(fullReply);
    try { await writer.close(); } catch (ce) { console.log("⚡ Error al cerrar writer:", ce); }
  }
}

export async function GET(_req: Request) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const chats = getChatsByUser(userId);
  return NextResponse.json(chats);
}

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const chatId = (form.get("chatId") as string) || crypto.randomUUID();
    const message = (form.get("message") as string) || "";
    const filesContent = (form.get("filesContent") as string) || "";
    const editFromIndex = form.get("editFromIndex") as string | null;
    const projectId = form.get("projectId") as string | null;
    const images: string[] = [];
    form.forEach((value, key) => {
      if (key.startsWith("image_") && typeof value === "string") {
        images.push(value.split(",")[1]);
      }
    });

    const model = process.env.TEXT_MODEL!;

    let chat;
    if (editFromIndex) {
      chat = getChatById(chatId);
      if (chat && chat.user_id !== userId) {
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      }
      truncateMessagesToCount(chatId, parseInt(editFromIndex));
      chat = getChatById(chatId);
    } else {
      chat = getChatById(chatId);
      if (!chat) {
        createChat(chatId, userId, message.slice(0, 30));
        chat = getChatById(chatId);
      } else if (chat.user_id !== userId) {
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      }
    }

    const history = chat?.messages || [];

    let projectContext = "";

    if (projectId) {
      const project = getProjectById(projectId);
      if (project && project.user_id === userId) {
        const projectFiles = Array.isArray(project.files)
          ? (project.files as Array<{ name: string; content: string }>)
          : [];

        projectContext = `Nombre del proyecto: ${project.name}

Instrucciones del proyecto:
${project.instructions}

Archivos del proyecto:
${projectFiles.map((f) => `Archivo: ${f.name}\n${f.content}`).join("\n\n")}`;
      }
    }

    const dbMessage = filesContent
      ? `[Archivos adjuntos]\n\n${message}\n\n---\n${filesContent}`
      : message;
    try { addMessage(chatId, "user", dbMessage, images); } catch {}

    // --- RAG retrieval ---
    let ragContext = "";
    try {
      const relevantChunks = await retrieveRelevantChunks(chatId, message);
      if (relevantChunks.length > 0) {
        ragContext = formatRagContext(relevantChunks);
        console.log(`🧠 RAG: ${relevantChunks.length} chunks relevantes recuperados`);
      }
    } catch (e) {
      console.log(`🧠 RAG error: ${e instanceof Error ? e.message : String(e)}`);
    }

    // --- Document creation detection ---
    let wantsDoc = DOC_PATTERN.test(message) || DOC_PATTERN.test(dbMessage);
    let docMessageForContent = message;

    if (!wantsDoc && RETRY_PATTERN.test(message)) {
      const match = findMatchingMessage(history);
      if (match) {
        wantsDoc = true;
        docMessageForContent = match;
        console.log(`📄 Contexto detectado en historial, usando: "${match.slice(0, 60)}..."`);
      }
    }

    if (wantsDoc) {
      const format = detectFormat(docMessageForContent);
      console.log(`📄 Detección de creación de documento: formato=${format}`);

      const result = await handleDocumentCreation(
        model, chatId, docMessageForContent, filesContent, history, images, projectContext, ragContext, format
      );

      try { addMessage(chatId, "assistant", result.text, undefined, result.docData); } catch {}
      console.log(`💾 DB guardado (doc): ${result.text.length} chars`);

      return NextResponse.json({
        type: "document",
        text: result.text,
        editResult: result.editResult,
      });
    }
    // --- End document creation detection ---

    // --- Web search integration ---
    const encoder = new TextEncoder();

    let searchSources: SearchResult[] = [];

    // Phase 1: Determine if search is needed (before streaming starts)
    // First check heuristic (keyword-based)
    if (shouldAutoSearch(message)) {
      console.log(`🌐 Heurística activada, buscando: "${message.slice(0, 60)}..."`);
      searchSources = await searchWeb(message);
      if (searchSources.length > 0) {
        console.log(`🌐 ${searchSources.length} resultados obtenidos`);
      }
    }

    // If heuristic didn't fire, ask the model via a fast decision call
    if (searchSources.length === 0) {
      const decisionMessages = buildMessages(
        history,
        message,
        filesContent || undefined,
        projectContext || undefined,
        undefined,
        ragContext || undefined,
      );
      if (images.length > 0 && decisionMessages.length > 0) {
        decisionMessages[decisionMessages.length - 1].images = images;
      }
      try {
        console.log("🌐 Decision call (num_predict=20)...");
        const decision = await ollamaChat(model, decisionMessages, { num_predict: 20 });
        console.log(`🌐 Decisión: "${decision.slice(0, 100)}"`);
        const searchMatch = decision.length > 3 ? decision.match(/^\[SEARCH:\s*(.+?)\s*\]/i) : null;
        if (searchMatch) {
          const query = searchMatch[1].trim();
          console.log(`🌐 Modelo solicitó búsqueda: "${query}"`);
          searchSources = await searchWeb(query);
        }
      } catch (e) {
        console.log(`🌐 Error en decision call: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Phase 2: Build final messages with search results (if any)
    const ollamaMessages = buildMessages(
      history,
      message,
      filesContent || undefined,
      projectContext || undefined,
      searchSources.length > 0 ? formatSearchResults(searchSources) : undefined,
      ragContext || undefined,
    );

    if (images.length > 0 && ollamaMessages.length > 0) {
      const lastMsg = ollamaMessages[ollamaMessages.length - 1];
      lastMsg.images = images;
    }

    // Phase 3: Stream the response
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    doStream(model, ollamaMessages, writer, encoder, chatId, () => {});

    // Wrap readable in an outer stream that appends sources at the end
    const bodyStream = new ReadableStream({
      async start(controller) {
        const reader = readable.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          // Append sources metadata at the very end of the stream
          if (searchSources.length > 0) {
            const metaLine = `\n__SOURCES__:${JSON.stringify(searchSources)}\n`;
            controller.enqueue(encoder.encode(metaLine));
          }
          controller.close();
        } catch (e) {
          controller.error(e);
        }
      },
    });

    return new Response(bodyStream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e) {
    console.error(e);
    return new Response("Error: la IA no respondió.", { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const userId = await getUserIdFromRequest();

  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const id = body.id;
    const title = String(body.title || "").trim();

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    if (!title) {
      return NextResponse.json({ error: "Título requerido" }, { status: 400 });
    }

    const chat = getChatById(id);

    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }

    if (chat.user_id !== userId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const updated = updateChatTitle(id, userId, title);

    if (!updated) {
      return NextResponse.json({ error: "No se pudo renombrar" }, { status: 400 });
    }

    syncProjectChatTitle(id, title);

    return NextResponse.json({ success: true, id, title });
  } catch {
    return NextResponse.json({ error: "Error al renombrar" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    const chat = getChatById(id);
    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }
    if (chat.user_id !== userId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    deleteChat(id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Error al eliminar" }, { status: 500 });
  }
}

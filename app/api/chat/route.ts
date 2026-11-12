export const runtime = "nodejs";

import { NextResponse } from "next/server";
import {
  getChatsByUser,
  getChatById,
  createChat,
  addMessage,
  deleteChat,
  updateChatTitle,
  updateMessageContent,
  truncateMessagesToCount,
  getLatestPartialDocumentForChat,
} from "@/lib/db";
import { ollamaChat, ollamaChatStream, getChatModel, type InferenceMessage } from "@/lib/ollama";
import { buildMessages } from "@/lib/prompt-builder";
import { getAuthUserFromRequest, getUserIdFromRequest } from "@/lib/auth";
import { getProjectById, syncProjectChatTitle } from "@/lib/projects";
import { generateDocument } from "@/lib/document-generator";
import {
  detectExportIntent,
  resolveDocumentIntent,
  type ExportIntent,
} from "@/lib/document-intent";
import {
  DocumentGenerationError,
  generateDocumentDraft,
  normalizeForKey,
  type DocumentPipelineStage,
} from "@/lib/document-pipeline";
import { getObject } from "@/lib/storage";
import {
  exportMessageDocument,
  renderDocumentArtifactsWithLimit,
  storeDocumentArtifacts,
} from "@/lib/documents";
import { toGeneratedDocumentMeta } from "@/lib/generated-document";
import { searchWeb, formatSearchResults, shouldAutoSearch } from "@/lib/web-search";
import { retrieveRelevantChunks, formatRagContext } from "@/lib/rag";
import { retrieveKb, formatKbContext, toKbSources } from "@/lib/kb";
import { log, childLogger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import type {
  DocGenStructure,
  DocGenFormat,
  EditResult,
  GeneratedDocumentMeta,
  GeneratedDocumentRow,
  Msg,
  SearchResult,
  KbSource,
} from "@/types";



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

type DocumentStreamEvent =
  | {
      type: "progress";
      stage: DocumentPipelineStage | "rendering" | "storing";
      chars?: number;
      summary?: string;
    }
  | {
      type: "document";
      text: string;
      document: GeneratedDocumentMeta;
      editResult: EditResult;
      /** La exportación se adjunta a la respuesta anterior, no al placeholder. */
      target?: "previous-ai";
      targetMessageId?: number;
      generation: {
        pages: number | null;
        chars: number;
        truncated: boolean;
        continuationUsed: boolean;
        maxPages: number;
        engine: string;
        timedOut?: boolean;
      };
    }
  | { type: "error"; text: string };

/**
 * Respuesta NDJSON para la generación de documentos.
 *
 * El cliente recibe `progress` mientras el modelo escribe y un único evento
 * `document` o `error` al final. Se usa un stream porque la generación puede
 * tardar decenas de segundos: con JSON síncrono la interfaz solo podría mostrar
 * un spinner genérico.
 */
function documentEventStream(
  task: (send: (event: DocumentStreamEvent) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: DocumentStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };

      try {
        await task(send);
      } catch (error) {
        const text =
          error instanceof Error ? error.message : "Error generando el documento.";
        send({ type: "error", text });
      } finally {
        closed = true;
        try { controller.close(); } catch { /* el cliente ya cerró */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Evita que un proxy tipo Nginx acumule los eventos de progreso.
      "X-Accel-Buffering": "no",
    },
  });
}

function editResultFromMeta(meta: GeneratedDocumentMeta): EditResult {
  return {
    success: true,
    format: meta.format,
    filename: meta.filename,
    originalName: meta.filename,
    changesCount: 0,
    downloadUrl: meta.downloadUrl,
    documentId: meta.id,
    previewUrl: meta.previewUrl,
    pages: meta.page_count,
  };
}

function formatLabel(format: string): string {
  return format === "xlsx" ? "Excel" : format === "docx" ? "Word" : "PDF";
}

/**
 * Exporta por lenguaje natural la última respuesta del asistente.
 *
 * No llama al LLM: usa el Markdown ya guardado. El documento se enlaza al
 * mensaje de esa respuesta y se añade una confirmación breve al final.
 */
async function handleExportIntent(params: {
  userId: string;
  chatId: string;
  history: Msg[];
  intent: ExportIntent;
  signal: AbortSignal;
  reqLog: ReturnType<typeof childLogger>;
}): Promise<Response> {
  const { userId, chatId, history, intent, signal, reqLog } = params;
  const target = [...history]
    .reverse()
    .find((item) => item.role === "ai" && Boolean(item.text?.trim()));

  if (intent.unsupportedFormat === "xlsx") {
    const text =
      "Puedo exportar la respuesta anterior a PDF o Word. Excel no aplica para exportar una respuesta del chat.";
    try { await addMessage(chatId, "assistant", text); } catch {}
    return NextResponse.json({ text });
  }

  if (!target) {
    const text =
      "No hay una respuesta anterior para exportar. Primero pídeme algo y luego pide exportarlo.";
    try { await addMessage(chatId, "assistant", text); } catch {}
    return NextResponse.json({ text });
  }

  const existing = target.document;
  if (existing) {
    const existingLabel = formatLabel(existing.format);
    const requestedLabel = formatLabel(intent.format);
    const text =
      existing.format === intent.format
        ? `La respuesta anterior ya está exportada como ${existingLabel}. Usa su tarjeta para descargarla.`
        : `La respuesta anterior ya tiene un documento ${existingLabel}. Usa su tarjeta para descargarlo${
            existing.docxUrl ? " o para bajar la versión Word" : ""
          }; no hace falta generar otro ${requestedLabel}.`;
    try { await addMessage(chatId, "assistant", text); } catch {}

    return documentEventStream(async (send) => {
      send({
        type: "document",
        text,
        document: existing,
        editResult: editResultFromMeta(existing),
        target: "previous-ai",
        targetMessageId: target.id,
        generation: {
          pages: existing.page_count,
          chars: target.text?.length ?? 0,
          truncated: existing.truncated === true,
          continuationUsed: false,
          maxPages: existing.max_pages ?? 10,
          engine: "existing",
        },
      });
    });
  }

  const requestedLabel = formatLabel(intent.format);

  return documentEventStream(async (send) => {
    try {
      send({ type: "progress", stage: "rendering" });
      const stored = await exportMessageDocument({
        userId,
        chatId,
        messageId: target.id ?? null,
        markdown: target.text || "",
        format: intent.format,
        signal,
        onStage: (stage) => send({ type: "progress", stage }),
      });

      const confirmation = `Listo. Exporté la respuesta anterior como ${requestedLabel}.${
        stored.meta.truncated
          ? ` El contenido se ajustó al límite de ${stored.meta.max_pages ?? 10} páginas.`
          : ""
      }`;
      try { await addMessage(chatId, "assistant", confirmation); } catch {}

      reqLog.info(
        { documentId: stored.document.id, format: stored.document.format, targetMessageId: target.id },
        "Respuesta exportada por lenguaje natural",
      );

      send({
        type: "document",
        text: confirmation,
        document: stored.meta,
        editResult: editResultFromMeta(stored.meta),
        target: "previous-ai",
        targetMessageId: target.id,
        generation: {
          pages: stored.document.page_count,
          chars: Number(stored.document.metadata.chars) || target.text?.length || 0,
          truncated: stored.meta.truncated === true,
          continuationUsed: false,
          maxPages: stored.meta.max_pages ?? 10,
          engine: String(stored.document.metadata.engine || "pdf-lib"),
        },
      });
    } catch (error) {
      const aborted =
        signal.aborted || (error instanceof Error && error.name === "AbortError");
      const text = aborted
        ? "Exportación cancelada."
        : error instanceof Error
          ? error.message
          : "No se pudo exportar la respuesta anterior.";
      if (!aborted) {
        reqLog.error({ err: text }, "Error exportando respuesta por lenguaje natural");
      }
      try { await addMessage(chatId, "assistant", text); } catch {}
      send({ type: "error", text });
    }
  });
}

async function handleDocumentCreation(
  model: string,
  chatId: string,
  message: string,
  filesContent: string,
  history: HistoryItem[],
  images: string[],
  projectContext: string,
  ragContext: string,
  kbContext: string,
  kbSources: KbSource[],
  format: DocGenFormat
): Promise<{ text: string; editResult: EditResult; docData: string; kbSources: KbSource[] }> {
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

  const jsonMessages: InferenceMessage[] = [
    { role: "system", content: "Eres un generador de documentos. Devuelve ÚNICAMENTE JSON válido, sin texto adicional, sin markdown, sin explicaciones." },
    { role: "user", content: jsonPrompt },
  ];

  const normalMessages = buildMessages(history, message, filesContent || undefined, projectContext || undefined, undefined, ragContext || undefined, kbContext || undefined);
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

  return { text: textResponse, editResult, docData, kbSources };
}


async function doStream(
  model: string,
  messages: InferenceMessage[],
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
  chatId: string,
  onFullReply: (reply: string) => void,
  kbSources?: KbSource[],
  webSources?: SearchResult[],
  signal?: AbortSignal,
): Promise<void> {
  let fullReply = "";
  const startTime = Date.now();
  let cont = 0;

  try {
    console.log("🤖 Ollama streaming: modelo=", model, "| mensajes:", messages.length);
    const generator = ollamaChatStream(model, messages, { signal });
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
        const retryGen = ollamaChatStream(model, messages, { signal });
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
      try {
        await addMessage(
          chatId,
          "assistant",
          fullReply,
          undefined,
          undefined,
          kbSources,
          webSources,
        );
      } catch {}
      console.log("💾 DB guardado:", fullReply.length, "chars");
    }
    onFullReply(fullReply);
    try { await writer.close(); } catch (ce) { console.log("⚡ Error al cerrar writer:", ce); }
  }
}

export async function GET() {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const chats = await getChatsByUser(userId);
  return NextResponse.json(chats);
}

export async function POST(req: Request) {
  const startTime = Date.now();
  // El objeto completo (id + rol) porque el acceso a la KB depende del rol:
  // `admin`/`super_admin` tienen bypass y `user`/`editor` se rigen por su ACL.
  const user = await getAuthUserFromRequest();
  const userId = user?.id;
  if (!userId || !user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // ─── Rate limiting ───
  const rateCheck = checkRateLimit(userId);
  if (!rateCheck.allowed) {
    log.warn({ userId, ...rateCheck }, "Rate limit excedido en /api/chat");
    return NextResponse.json(
      { error: "Demasiadas solicitudes. Intenta de nuevo en unos segundos." },
      { status: 429, headers: rateCheck.headers }
    );
  }

  let chatId = crypto.randomUUID();
  let model = getChatModel();
  let reqLog = childLogger({ userId });

  try {
    const form = await req.formData();
    chatId = (form.get("chatId") as string) || crypto.randomUUID();
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

    model = getChatModel();
    reqLog = childLogger({ userId, chatId, model, projectId: projectId || undefined });

    reqLog.info({ msgLen: message.length, images: images.length, files: filesContent ? "yes" : "no" }, "Chat request iniciado");

    let chat;
    if (editFromIndex) {
      chat = await getChatById(chatId);
      if (chat && chat.user_id !== userId) {
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      }
      await truncateMessagesToCount(chatId, parseInt(editFromIndex));
      chat = await getChatById(chatId);
    } else {
      chat = await getChatById(chatId);
      if (!chat) {
        await createChat(chatId, userId, message.slice(0, 30));
        chat = await getChatById(chatId);
      } else if (chat.user_id !== userId) {
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      }
    }

    const history = chat?.messages || [];

    let projectContext = "";

    if (projectId) {
      const project = await getProjectById(projectId);
      if (project && project.user_id === userId) {
        // NOTA: la tabla projects no tiene columna `files`; el contexto
        // incluye solo nombre e instrucciones (ver schema en lib/projects.ts).
        projectContext = `Nombre del proyecto: ${project.name}

Instrucciones del proyecto:
${project.instructions}`;
      }
    }

    const dbMessage = filesContent
      ? `[Archivos adjuntos]\n\n${message}\n\n---\n${filesContent}`
      : message;
    try { await addMessage(chatId, "user", dbMessage, images); } catch {}

    // --- Exportación por lenguaje natural ---
    // Se resuelve antes de RAG/KB porque no necesita contexto externo: solo
    // convierte la última respuesta del asistente a PDF/Word.
    const exportIntent = detectExportIntent(message);
    if (exportIntent.wantsExport) {
      reqLog.info(
        { format: exportIntent.format, unsupported: exportIntent.unsupportedFormat },
        "Exportación por lenguaje natural detectada",
      );
      return handleExportIntent({
        userId,
        chatId,
        history,
        intent: exportIntent,
        signal: req.signal,
        reqLog,
      });
    }

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

    // --- KB retrieval (base de conocimiento compartida, sujeta al ACL) ---
    let kbContext = "";
    let kbSources: KbSource[] = [];
    try {
      const kbHits = await retrieveKb(message, user);
      if (kbHits.length > 0) {
        kbContext = formatKbContext(kbHits);
        kbSources = toKbSources(kbHits);
        const scores = kbHits.map((h) => h.score.toFixed(2)).join(", ");
        console.log(`📚 KB: ${kbHits.length} fragmentos recuperados [scores: ${scores}]`);
      }
    } catch (e) {
      console.log(`📚 KB error: ${e instanceof Error ? e.message : String(e)}`);
    }

    // --- Document creation detection ---
    const documentHistory = history.map((item) => ({
      role: item.role,
      text: item.text,
      images: item.images,
    }));
    const documentIntent = resolveDocumentIntent(message, documentHistory);

    if (documentIntent.wantsDocument) {
      console.log(
        `📄 Intención de documento: formato=${documentIntent.format}, reintento=${documentIntent.isRetry}`,
      );

      // XLSX conserva el generador anterior y `doc_data` legacy.
      if (documentIntent.format === "xlsx") {
        const result = await handleDocumentCreation(
          model,
          chatId,
          documentIntent.request,
          filesContent,
          history,
          images,
          projectContext,
          ragContext,
          kbContext,
          kbSources,
          "xlsx",
        );

        try {
          await addMessage(chatId, "assistant", result.text, undefined, result.docData, result.kbSources);
        } catch {}
        console.log(`💾 DB guardado (xlsx): ${result.text.length} chars`);

        return NextResponse.json({
          type: "document",
          text: result.text,
          editResult: result.editResult,
        });
      }

      const format = documentIntent.format === "docx" ? "docx" : "pdf";

      // --- Continuación de documento parcial ---
      let partialDocument: GeneratedDocumentRow | null = null;
      let continuationMarkdown: string | undefined;

      if (
        !documentIntent.forceReset &&
        (documentIntent.mode === "continue" || documentIntent.mode === "retry")
      ) {
        const candidate = await getLatestPartialDocumentForChat(chatId, userId);
        if (candidate) {
          const previousRequestKey = candidate.metadata.request_key as
            | string
            | undefined;
          const currentRequestKey = normalizeForKey(documentIntent.request);
          if (
            previousRequestKey &&
            previousRequestKey !== currentRequestKey
          ) {
            reqLog.warn(
              { previousRequestKey, currentRequestKey },
              "Parcial de petición diferente, se regenerará desde cero",
            );
          } else if (candidate.markdown_object_key) {
            try {
              const mdBuffer = await getObject(candidate.markdown_object_key);
              continuationMarkdown = mdBuffer.toString("utf8");
              partialDocument = candidate;
            } catch (e) {
              reqLog.warn(
                { err: String(e) },
                "No se pudo descargar el sidecar del parcial, se regenerará desde cero",
              );
            }
          }
        }
      }

      return documentEventStream(async (send) => {
        let assistantMessageId: number | null = null;
        try {
          const draft = await generateDocumentDraft({
            message: documentIntent.request,
            model,
            history: documentHistory,
            filesContent: filesContent || undefined,
            projectContext: projectContext || undefined,
            ragContext: ragContext || undefined,
            kbContext: kbContext || undefined,
            images,
            format,
            signal: req.signal,
            mode: documentIntent.mode,
            forceReset: documentIntent.forceReset,
            continuation: continuationMarkdown
              ? {
                  markdown: continuationMarkdown,
                  summary: partialDocument?.summary,
                  title: partialDocument?.title,
                  version: partialDocument?.version,
                  documentId: partialDocument?.id,
                }
              : undefined,
            onEvent: (event) => {
              if (event.type === "status") {
                send({ type: "progress", stage: event.stage });
                return;
              }
              if (event.type === "progress") {
                send({ type: "progress", stage: event.stage, chars: event.chars });
                return;
              }
              send({ type: "progress", stage: "writing", summary: event.text });
            },
          });

          send({ type: "progress", stage: "rendering" });
          const rendered = await renderDocumentArtifactsWithLimit(draft, {
            author: user.name || undefined,
            signal: req.signal,
          });
          const artifacts = rendered.artifacts;
          const finalDraft = rendered.draft;

          send({ type: "progress", stage: "storing" });

          const isContinuation = Boolean(
            partialDocument && finalDraft.mode === "continue",
          );

          // El mensaje se guarda antes del storage para poder enlazarlo; si el
          // almacenamiento falla, se corrige su contenido en vez de dejar una
          // tarjeta que apunta a un archivo inexistente.
          assistantMessageId = await addMessage(
            chatId,
            "assistant",
            finalDraft.summary,
            undefined,
            undefined,
            kbSources,
          );

          let stored;
          try {
            stored = await storeDocumentArtifacts({
              userId,
              chatId,
              messageId: assistantMessageId,
              documentId: isContinuation ? partialDocument!.id : undefined,
              title: finalDraft.title,
              summary: finalDraft.summary,
              version: finalDraft.version,
              source: "chat",
              artifacts,
              sourceMarkdown: isContinuation ? finalDraft.sourceMarkdown : undefined,
              signal: req.signal,
              metadata: {
                chars: finalDraft.chars,
                max_pages: finalDraft.maxPages,
                truncated: finalDraft.truncated,
                page_limit_applied: rendered.pageLimitApplied,
                page_limit_exceeded: rendered.pageLimitExceeded,
                words: finalDraft.words,
                original_words: finalDraft.originalWords,
                original_chars: finalDraft.originalChars,
                continuation_used: finalDraft.continuationUsed,
                requested_format: format,
                partial: finalDraft.partial === true,
                timed_out: finalDraft.timedOut === true,
                request_key: normalizeForKey(documentIntent.request),
                continuation_of: isContinuation ? partialDocument!.id : undefined,
              },
            });
          } catch (storageError) {
            const detail =
              storageError instanceof Error ? storageError.message : String(storageError);
            reqLog.error({ err: detail }, "No se pudo almacenar el documento generado");
            const note = `${finalDraft.summary}\n\nEl documento se generó, pero no se pudo guardar. Intenta de nuevo o revisa el storage.`;
            if (assistantMessageId) {
              try { await updateMessageContent(assistantMessageId, note); } catch {}
            }
            send({ type: "error", text: note });
            return;
          }

          const meta = toGeneratedDocumentMeta(stored.document);
          const editResult = editResultFromMeta(meta);

          console.log(
            `💾 Documento generado: ${stored.document.filename} (${artifacts.engine}, ${stored.document.page_count ?? "?"} páginas)`,
          );

          send({
            type: "document",
            text: isContinuation
              ? `Continué el documento. Versión ${finalDraft.version}.`
              : finalDraft.summary,
            document: meta,
            editResult,
            target: isContinuation ? "previous-ai" : undefined,
            targetMessageId: isContinuation
              ? (partialDocument!.message_id ?? undefined)
              : undefined,
            generation: {
              pages: stored.document.page_count,
              chars: finalDraft.chars,
              truncated: finalDraft.truncated,
              continuationUsed: finalDraft.continuationUsed,
              maxPages: finalDraft.maxPages,
              engine: artifacts.engine,
              timedOut: finalDraft.timedOut === true,
            },
          });
        } catch (error) {
          const aborted =
            req.signal.aborted ||
            (error instanceof Error && error.name === "AbortError");
          if (aborted) {
            if (assistantMessageId) {
              try {
                await updateMessageContent(assistantMessageId, "Generación cancelada.");
              } catch {}
            }
            send({ type: "error", text: "Generación cancelada." });
            return;
          }

          const detail = error instanceof Error ? error.message : String(error);
          const cause =
            error instanceof Error && error.cause instanceof Error
              ? error.cause.message
              : undefined;
          reqLog.error(
            {
              err: detail,
              cause,
              stack: error instanceof Error ? error.stack : undefined,
            },
            "Error generando documento",
          );
          const text =
            error instanceof DocumentGenerationError
              ? error.message
              : "No se pudo generar el documento. Intenta de nuevo.";
          if (assistantMessageId) {
            try { await updateMessageContent(assistantMessageId, text); } catch {}
          } else {
            try { await addMessage(chatId, "assistant", text); } catch {}
          }
          send({ type: "error", text });
        }
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
        kbContext || undefined,
      );
      if (images.length > 0 && decisionMessages.length > 0) {
        decisionMessages[decisionMessages.length - 1].images = images;
      }
      try {
        console.log("🌐 Decision call (num_predict=20)...");
        const decision = await ollamaChat(model, decisionMessages, { max_tokens: 20 });
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
    const chatMessages = buildMessages(
      history,
      message,
      filesContent || undefined,
      projectContext || undefined,
      searchSources.length > 0 ? formatSearchResults(searchSources) : undefined,
      ragContext || undefined,
      kbContext || undefined,
    );

    if (images.length > 0 && chatMessages.length > 0) {
      const lastMsg = chatMessages[chatMessages.length - 1];
      lastMsg.images = images;
    }

    // Phase 3: Stream the response
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    void doStream(
      model,
      chatMessages,
      writer,
      encoder,
      chatId,
      () => {},
      kbSources,
      searchSources,
      req.signal,
    );

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
    reqLog.error({ err: e instanceof Error ? e.message : String(e) }, "Error en chat POST");
    return new Response("Error: la IA no respondió.", { status: 500 });
  } finally {
    const elapsed = Date.now() - startTime;
    log.info({ userId, chatId, elapsedMs: elapsed }, "Chat request completado");
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

    const chat = await getChatById(id);

    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }

    if (chat.user_id !== userId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const updated = await updateChatTitle(id, userId, title);

    if (!updated) {
      return NextResponse.json({ error: "No se pudo renombrar" }, { status: 400 });
    }

    await syncProjectChatTitle(id, title);

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

    const chat = await getChatById(id);
    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }
    if (chat.user_id !== userId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    await deleteChat(id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Error al eliminar" }, { status: 500 });
  }
}

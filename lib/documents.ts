import { PDFDocument } from "pdf-lib";
import {
  createGeneratedDocument,
  getGeneratedDocumentById,
  getGeneratedDocumentByMessageId,
  updateGeneratedDocument,
} from "@/lib/db";
import { convertDocxToPdf } from "@/lib/docx-to-pdf";
import { generateDocument } from "@/lib/document-generator";
import {
  clampDocumentMarkdown,
  clampDocumentMarkdownToWords,
  countDocumentWords,
  fallbackDocumentSummary,
  resolveDocumentMaxPages,
  type DocumentDraft,
} from "@/lib/document-pipeline";
import {
  buildDocumentDocx,
  extractMarkdownTitle,
  sanitizeDocumentText,
  slugifyDocumentFilename,
} from "@/lib/markdown-to-docx";
import { markdownToDocGenBlocks } from "@/lib/markdown-to-blocks";
import {
  documentMimeType,
  documentStoragePrefix,
  toGeneratedDocumentMeta,
} from "@/lib/generated-document";
import { deleteObject, ensureBucket, getStorageConfig, objectKey, putObject } from "@/lib/storage";
import type {
  GeneratedDocumentMeta,
  GeneratedDocumentRow,
  GeneratedDocumentSource,
} from "@/types";

/**
 * Renderizado y almacenamiento de documentos generados.
 *
 * El DOCX se produce con `docx` y el PDF con LibreOffice. Si LibreOffice no
 * está disponible (`DOC_PDF_ENGINE=pdf-lib` o binario ausente), se usa el
 * generador pdf-lib existente para no dejar al usuario sin archivo.
 */

export type DocumentArtifacts = {
  primaryBuffer: Buffer;
  primaryFormat: "pdf" | "docx";
  filename: string;
  mimeType: string;
  pageCount: number | null;
  docxBuffer: Buffer | null;
  docxFilename: string | null;
  engine: "libreoffice" | "pdf-lib" | "docx";
};

export type StoredDocument = {
  document: GeneratedDocumentRow;
  meta: GeneratedDocumentMeta;
};

export type RenderDocumentOptions = {
  subtitle?: string;
  author?: string;
  signal?: AbortSignal;
};

export type StoreDocumentInput = {
  userId: string;
  chatId?: string | null;
  messageId?: number | null;
  title: string;
  summary?: string;
  version?: string;
  source?: GeneratedDocumentSource;
  artifacts: DocumentArtifacts;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
  /** Markdown fuente para subir como sidecar cuando el documento es parcial. */
  sourceMarkdown?: string;
  /** Si se pasa, se actualiza esta fila en lugar de crear una nueva. */
  documentId?: string;
};

export type ExportMessageFormat = "pdf" | "docx";

export type ExportMessageInput = {
  userId: string;
  chatId: string;
  messageId?: number | null;
  markdown: string;
  title?: string;
  summary?: string;
  format?: ExportMessageFormat;
  signal?: AbortSignal;
  onStage?: (stage: "rendering" | "storing") => void;
};

export type RenderDocumentWithLimitResult = {
  artifacts: DocumentArtifacts;
  draft: DocumentDraft;
  pageLimitApplied: boolean;
  pageLimitExceeded: boolean;
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function abortError(): Error {
  const error = new Error("Operación cancelada");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withExtension(filename: string, extension: string): string {
  const value = String(filename || "documento").trim() || "documento";
  return new RegExp(`\\.${extension}$`, "i").test(value)
    ? value
    : `${value.replace(/\.[a-z0-9]+$/i, "")}.${extension}`;
}

async function countPdfPages(buffer: Buffer): Promise<number | null> {
  try {
    const document = await PDFDocument.load(buffer, { updateMetadata: false });
    return document.getPageCount();
  } catch {
    return null;
  }
}

/** PDF de respaldo con pdf-lib, sin LibreOffice. */
async function renderPdfFallback(draft: DocumentDraft): Promise<Buffer> {
  const blocks = markdownToDocGenBlocks(draft.markdown);
  if (blocks[0]?.type !== "title") {
    blocks.unshift({ type: "title", text: draft.title });
  }

  const { buffer } = await generateDocument({
    format: "pdf",
    filename: withExtension(draft.filename, "pdf"),
    content: blocks,
  });
  return buffer;
}

/**
 * Genera el DOCX y, cuando el formato pedido es PDF, lo convierte con
 * LibreOffice. No toca base de datos ni storage.
 */
export async function renderDocumentArtifacts(
  draft: DocumentDraft,
  options: RenderDocumentOptions = {},
): Promise<DocumentArtifacts> {
  const docx = await buildDocumentDocx({
    markdown: draft.markdown,
    title: draft.title,
    version: draft.version,
    date: draft.generatedAt,
    subtitle: options.subtitle,
    author: options.author,
  });

  if (draft.format === "docx") {
    return {
      primaryBuffer: docx.buffer,
      primaryFormat: "docx",
      filename: withExtension(docx.filename, "docx"),
      mimeType: documentMimeType("docx"),
      pageCount: null,
      docxBuffer: docx.buffer,
      docxFilename: docx.filename,
      engine: "docx",
    };
  }

  let pdf: Buffer;
  let engine: DocumentArtifacts["engine"] = "libreoffice";

  try {
    pdf = await convertDocxToPdf(docx.buffer, { signal: options.signal });
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted) throw error;
    console.warn(`[documents] LibreOffice no pudo convertir; se usa pdf-lib: ${errorMessage(error)}`);
    engine = "pdf-lib";
    pdf = await renderPdfFallback(draft);
  }

  return {
    primaryBuffer: pdf,
    primaryFormat: "pdf",
    filename: withExtension(draft.filename, "pdf"),
    mimeType: documentMimeType("pdf"),
    pageCount: await countPdfPages(pdf),
    docxBuffer: docx.buffer,
    docxFilename: docx.filename,
    engine,
  };
}

/**
 * Renderiza respetando el límite de páginas real.
 *
 * El corte por palabras es una aproximación; si el PDF maquetado supera el
 * máximo, se recorta otra vez y se vuelve a renderizar una sola vez. Si aun así
 * lo supera, se devuelve `pageLimitExceeded` para que la UI lo explique y el
 * documento no quede silenciosamente fuera de límite.
 */
export async function renderDocumentArtifactsWithLimit(
  draft: DocumentDraft,
  options: RenderDocumentOptions = {},
): Promise<RenderDocumentWithLimitResult> {
  let current = draft;
  let artifacts = await renderDocumentArtifacts(current, options);
  let pageLimitApplied = current.pageLimitApplied === true;
  let pageLimitExceeded = false;

  if (
    artifacts.primaryFormat === "pdf" &&
    typeof artifacts.pageCount === "number" &&
    artifacts.pageCount > current.maxPages
  ) {
    const currentWords = current.words ?? countDocumentWords(current.markdown);
    const scaledWords = Math.floor(
      ((currentWords * current.maxPages) / artifacts.pageCount) * 0.9,
    );
    const targetWords = Math.max(50, Math.min(currentWords - 1, scaledWords));
    const clamped = clampDocumentMarkdownToWords(
      current.markdown,
      targetWords,
      current.maxPages,
    );

    if (clamped.markdown && clamped.markdown !== current.markdown) {
      current = {
        ...current,
        markdown: clamped.markdown,
        chars: clamped.markdown.length,
        words: clamped.words,
        originalWords: current.originalWords ?? clamped.originalWords,
        originalChars: current.originalChars ?? clamped.originalChars,
        truncated: true,
        pageLimitApplied: true,
      };
      artifacts = await renderDocumentArtifacts(current, options);
      pageLimitApplied = true;
      pageLimitExceeded =
        artifacts.primaryFormat === "pdf" &&
        typeof artifacts.pageCount === "number" &&
        artifacts.pageCount > current.maxPages;
    } else {
      pageLimitExceeded = true;
    }
  }

  return { artifacts, draft: current, pageLimitApplied, pageLimitExceeded };
}

// ─── Storage ────────────────────────────────────────────────────────────────

let bucketReady: Promise<void> | null = null;

function ensureStorageBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = ensureBucket().catch((error) => {
      bucketReady = null;
      throw error;
    });
  }
  return bucketReady;
}

type PendingUpload = {
  key: string;
  buffer: Buffer;
  contentType: string;
  metadata: Record<string, string>;
};

/**
 * Sube los binarios y crea (o actualiza) la fila.
 *
 * Cuando `input.documentId` se pasa, se actualiza la misma fila en lugar de
 * crear una nueva. Se suben los nuevos binarios primero y, tras actualizar la
 * fila, se borran los binarios antiguos para no dejar objetos huérfanos.
 *
 * Cuando `input.sourceMarkdown` se pasa, se sube como sidecar
 * `documents/{userId}/{chatId}/{documentId}.md` solo si el documento es
 * parcial (o siempre que se proporcione, para permitir continuación).
 */
export async function storeDocumentArtifacts(input: StoreDocumentInput): Promise<StoredDocument> {
  throwIfAborted(input.signal);

  const storage = getStorageConfig();
  const prefix = documentStoragePrefix(input.userId, input.chatId);
  const artifacts = input.artifacts;
  const isUpdate = Boolean(input.documentId);

  const uploads: PendingUpload[] = [
    {
      key: objectKey(prefix, artifacts.filename),
      buffer: artifacts.primaryBuffer,
      contentType: artifacts.mimeType,
      metadata: {
        source: "generated-document",
        format: artifacts.primaryFormat,
        engine: artifacts.engine,
      },
    },
  ];

  if (
    artifacts.primaryFormat === "pdf" &&
    artifacts.docxBuffer &&
    artifacts.docxFilename
  ) {
    uploads.push({
      key: objectKey(prefix, artifacts.docxFilename),
      buffer: artifacts.docxBuffer,
      contentType: documentMimeType("docx"),
      metadata: { source: "generated-document", format: "docx" },
    });
  }

  // Sidecar de Markdown para continuación (solo parciales).
  if (input.sourceMarkdown) {
    const markdownKey = objectKey(
      prefix,
      `${isUpdate ? input.documentId : "placeholder"}.md`,
    );
    uploads.push({
      key: markdownKey,
      buffer: Buffer.from(input.sourceMarkdown, "utf8"),
      contentType: "text/markdown; charset=utf-8",
      metadata: { source: "generated-document", format: "md" },
    });
  }

  await ensureStorageBucket();
  throwIfAborted(input.signal);

  const uploaded: string[] = [];
  try {
    for (const upload of uploads) {
      throwIfAborted(input.signal);
      await putObject(upload.key, upload.buffer, upload.contentType, upload.metadata);
      uploaded.push(upload.key);
    }

    throwIfAborted(input.signal);

    const [primary, docx] = uploads;
    const markdownUpload = uploads.find((u) => u.metadata.format === "md");
    const markdownKey = markdownUpload?.key ?? null;

    if (isUpdate && input.documentId) {
      // Leer la fila anterior para borrar sus binarios antiguos.
      const previous = await getGeneratedDocumentById(input.documentId);
      const document = await updateGeneratedDocument(input.documentId, {
        title: input.title,
        filename: artifacts.filename,
        format: artifacts.primaryFormat,
        mime_type: artifacts.mimeType,
        size_bytes: artifacts.primaryBuffer.length,
        page_count: artifacts.pageCount,
        version: input.version || "1.0",
        summary: input.summary || "",
        status: "ready",
        bucket: storage.bucket,
        object_key: primary.key,
        docx_object_key:
          artifacts.primaryFormat === "pdf" && docx ? docx.key : null,
        markdown_object_key: markdownKey,
        source: input.source || "chat",
        metadata: {
          ...input.metadata,
          engine: artifacts.engine,
          docx_size_bytes: artifacts.docxBuffer?.length ?? null,
        },
      });

      if (previous) {
        const oldKeys = [
          previous.object_key,
          previous.docx_object_key,
          previous.markdown_object_key,
        ].filter(Boolean) as string[];
        await Promise.allSettled(oldKeys.map((key) => deleteObject(key)));
      }

      const row = document ?? (await getGeneratedDocumentById(input.documentId));
      if (!row) throw new Error("No se pudo actualizar el documento.");
      return { document: row, meta: toGeneratedDocumentMeta(row) };
    }

    const document = await createGeneratedDocument({
      user_id: input.userId,
      chat_id: input.chatId ?? null,
      message_id: input.messageId ?? null,
      title: input.title,
      filename: artifacts.filename,
      format: artifacts.primaryFormat,
      mime_type: artifacts.mimeType,
      size_bytes: artifacts.primaryBuffer.length,
      page_count: artifacts.pageCount,
      version: input.version || "1.0",
      summary: input.summary || "",
      status: "ready",
      bucket: storage.bucket,
      object_key: primary.key,
      docx_object_key:
        artifacts.primaryFormat === "pdf" && docx ? docx.key : null,
      markdown_object_key: markdownKey,
      source: input.source || "chat",
      metadata: {
        ...input.metadata,
        engine: artifacts.engine,
        docx_size_bytes: artifacts.docxBuffer?.length ?? null,
      },
    });

    return { document, meta: toGeneratedDocumentMeta(document) };
  } catch (error) {
    await Promise.allSettled(uploaded.map((key) => deleteObject(key)));
    throw error;
  }
}

function titleFromMarkdown(markdown: string): string {
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[>*+-]\s+/, "")
      .trim();
    if (!line || line.startsWith("```")) continue;
    return line.slice(0, 90).trim();
  }
  return "Documento";
}

/**
 * Exporta como PDF el contenido de una respuesta del chat, sin llamar al LLM.
 *
 * Si el mensaje ya tiene un documento listo, devuelve ese mismo en lugar de
 * crear un duplicado.
 */
export async function exportMessageDocument(input: ExportMessageInput): Promise<StoredDocument> {
  throwIfAborted(input.signal);

  if (input.messageId) {
    const existing = await getGeneratedDocumentByMessageId(input.messageId);
    if (existing && existing.status === "ready") {
      return { document: existing, meta: toGeneratedDocumentMeta(existing) };
    }
  }

  const markdown = sanitizeDocumentText(input.markdown ?? "").trim();
  if (!markdown) {
    throw new Error("El mensaje no tiene contenido para exportar.");
  }

  const format: ExportMessageFormat = input.format === "docx" ? "docx" : "pdf";
  const title =
    sanitizeDocumentText(
      input.title?.trim() || extractMarkdownTitle(markdown) || titleFromMarkdown(markdown),
    ).trim() || "Documento";
  const maxPages = resolveDocumentMaxPages();
  const clamped = clampDocumentMarkdown(markdown, maxPages);

  const draft: DocumentDraft = {
    title,
    filename: slugifyDocumentFilename(title, format),
    format,
    summary: input.summary?.trim() || fallbackDocumentSummary(markdown, title),
    markdown: clamped.markdown,
    version: "1.0",
    generatedAt: new Date(),
    maxPages,
    truncated: clamped.truncated,
    continuationUsed: false,
    chars: clamped.markdown.length,
    pageLimitApplied: clamped.truncated,
    words: clamped.words,
    originalWords: clamped.originalWords,
    originalChars: clamped.originalChars,
  };

  input.onStage?.("rendering");
  throwIfAborted(input.signal);
  const rendered = await renderDocumentArtifactsWithLimit(draft, {
    signal: input.signal,
  });

  input.onStage?.("storing");
  throwIfAborted(input.signal);

  return storeDocumentArtifacts({
    userId: input.userId,
    chatId: input.chatId,
    messageId: input.messageId ?? null,
    title: rendered.draft.title,
    summary: rendered.draft.summary,
    version: rendered.draft.version,
    source: "export",
    artifacts: rendered.artifacts,
    signal: input.signal,
    metadata: {
      exported_from: "message",
      chars: rendered.draft.chars,
      max_pages: rendered.draft.maxPages,
      truncated: rendered.draft.truncated,
      page_limit_applied: rendered.pageLimitApplied,
      page_limit_exceeded: rendered.pageLimitExceeded,
      words: rendered.draft.words,
      original_words: rendered.draft.originalWords,
      original_chars: rendered.draft.originalChars,
      requested_format: format,
    },
  });
}

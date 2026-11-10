import type {
  GeneratedDocumentFormat,
  GeneratedDocumentMeta,
  GeneratedDocumentRow,
} from "@/types";

/**
 * Helpers puros de los documentos generados.
 *
 * Este módulo no toca base de datos, storage ni variables de entorno, para que
 * las rutas, `lib/db` y los tests puedan compartir el mismo contrato sin
 * arrastrar dependencias de servidor.
 */

export const DOCUMENT_MIME_TYPES: Record<GeneratedDocumentFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

export const DOCUMENT_EXTENSIONS: Record<GeneratedDocumentFormat, string> = {
  xlsx: "xlsx",
  docx: "docx",
  pdf: "pdf",
};

export function documentMimeType(format: GeneratedDocumentFormat): string {
  return DOCUMENT_MIME_TYPES[format] || "application/octet-stream";
}

/** Prefijo de storage: `documents/{userId}/{chatId}`. */
export function documentStoragePrefix(userId: string, chatId?: string | null): string {
  const owner = String(userId || "").trim().replace(/^\/+|\/+$/g, "");
  const chat = String(chatId || "").trim().replace(/^\/+|\/+$/g, "");
  return chat ? `documents/${owner}/${chat}` : `documents/${owner}`;
}

export function documentDownloadUrl(id: string): string {
  return `/api/documents/${encodeURIComponent(id)}`;
}

export function documentPreviewUrl(id: string): string {
  return `/api/documents/${encodeURIComponent(id)}?inline=1`;
}

export function documentDocxUrl(id: string): string {
  return `/api/documents/${encodeURIComponent(id)}?format=docx`;
}

/** Metadatos listos para adjuntar a un `Msg` o devolver por API. */
export function toGeneratedDocumentMeta(row: GeneratedDocumentRow): GeneratedDocumentMeta {
  const metadata = row.metadata ?? {};
  const maxPagesValue = Number(metadata.max_pages);
  const maxPages =
    Number.isFinite(maxPagesValue) && maxPagesValue > 0 ? maxPagesValue : undefined;
  const truncated = metadata.truncated === true;
  const pageLimitExceeded = metadata.page_limit_exceeded === true;
  const partial = metadata.partial === true;
  const timedOut = metadata.timed_out === true;

  return {
    id: row.id,
    title: row.title,
    filename: row.filename,
    format: row.format,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    page_count: row.page_count,
    version: row.version,
    summary: row.summary,
    source: row.source,
    created_at: row.created_at,
    downloadUrl: documentDownloadUrl(row.id),
    previewUrl: documentPreviewUrl(row.id),
    ...(row.docx_object_key ? { docxUrl: documentDocxUrl(row.id) } : {}),
    ...(truncated ? { truncated: true } : {}),
    ...(maxPages !== undefined ? { max_pages: maxPages } : {}),
    ...(pageLimitExceeded ? { page_limit_exceeded: true } : {}),
    ...(partial ? { partial: true } : {}),
    ...(timedOut ? { timed_out: true } : {}),
  };
}

/** Nombre seguro para la cabecera `Content-Disposition` (solo ASCII). */
export function asciiFilename(filename: string): string {
  const value = String(filename || "documento").replace(/[^\x20-\x7E]/g, "_");
  return value.replace(/["\\]/g, "_") || "documento";
}

/**
 * Construye `Content-Disposition` con el nombre ASCII de respaldo y
 * `filename*` codificado para conservar acentos.
 */
export function contentDispositionHeader(
  disposition: "inline" | "attachment",
  filename: string,
): string {
  return `${disposition}; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Deja un texto apto para las fuentes estándar de pdf-lib (WinAnsi).
 *
 * Solo se usa en el fallback sin LibreOffice: reemplaza comillas tipográficas,
 * guiones largos, flechas y cualquier carácter fuera de Latin-1. LibreOffice
 * no necesita esto porque embebe fuentes con cobertura Unicode.
 */
export function makePdfSafeText(input: string): string {
  const normalized = String(input ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u2190-\u21FF]/g, "->")
    .replace(/\u00A0/g, " ");

  // Recorre por puntos de código: un emoji es un par sustituto y no debe
  // convertirse en dos signos de interrogación.
  return Array.from(normalized)
    .map((char) => (/^[\t\n\x20-\x7E\u00A1-\u00FF]$/.test(char) ? char : "?"))
    .join("");
}

import {
  getChatModel,
  ollamaChatStream,
  type ChatOptions,
  type InferenceMessage,
  OllamaTimeoutError,
} from "@/lib/ollama";
import {
  buildDocumentDocx,
  extractMarkdownTitle,
  sanitizeDocumentText,
  slugifyDocumentFilename,
  type DocumentDocxResult,
} from "@/lib/markdown-to-docx";
import type { DocGenFormat } from "@/types";

export const DOCUMENT_MARKER = "<<<DOCUMENTO>>>";

const MARKER_PATTERN = /<<<\s*DOCUMENTO\s*>>>/i;
const MIN_DOCUMENT_TOKENS = 2000;
const MAX_DOCUMENT_TOKENS = 16000;
const TOKENS_PER_PAGE = 1200;
const WORDS_PER_PAGE = 450;
const MAX_PAGES = 10;
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 4000;
const MAX_CONTEXT_CHARS = 6000;
const MAX_SUMMARY_CHARS = 400;
const MAX_TITLE_CHARS = 120;

/** Páginas por defecto cuando el usuario pide un documento "breve". */
export const DEFAULT_BRIEF_MAX_PAGES = 2;
/** Páginas por defecto cuando no hay instrucción de longitud. */
export const DEFAULT_MAX_PAGES = MAX_PAGES;

/** Detecta un número explícito de páginas: "5 páginas", "de 3 paginas", etc. */
export const EXPLICIT_PAGES_PATTERN =
  /\b(\d{1,2})\s*(?:p[aá]ginas?|hojas?)\b/i;

/** Detecta páginas que describen la fuente, no la salida:
 *  "resumen del reporte de 4 páginas", "análisis del documento de 5 hojas". */
export const SOURCE_PAGES_PATTERN =
  /\b(?:resumen|síntesis|análisis|resumen ejecutivo)\b[^.]*\b(?:del|de)\s+(?:el\s+)?(?:reporte|informe|documento|archivo|pdf|contrato|manual|libro)\b[^.]*\bde\s+(\d{1,2})\s*(?:p[aá]ginas?|hojas?)\b/i;

/** Palabras que indican un documento breve. */
export const BRIEF_PATTERN =
  /\b(?:breve|breves|corto|corta|cortos|cortas|sencillo|sencilla|resumido|resumida|conciso|concisa|una\s+(?:sola\s+)?p[aá]gina|pocas\s+palabras)\b/i;

function clampPages(value: number): number {
  return Math.min(MAX_PAGES, Math.max(1, Math.round(value)));
}

/** Límite de palabras por página usado por el prompt y el recorte determinista. */
export const DOCUMENT_WORDS_PER_PAGE = WORDS_PER_PAGE;
/** Tope duro de páginas por documento. */
export const DOCUMENT_MAX_PAGES = MAX_PAGES;

export type DocumentFormat = Exclude<DocGenFormat, "xlsx">;

export type DocumentHistoryItem = {
  role: "user" | "ai";
  text?: string;
  images?: string[];
};

export type DocumentPipelineStage = "analyzing" | "writing" | "parsing";

export type DocumentPipelineEvent =
  | { type: "status"; stage: DocumentPipelineStage }
  | { type: "summary"; text: string }
  | { type: "progress"; stage: "writing"; chars: number };

/** Origen de la petición de documento. */
export type DocumentIntentMode = "new" | "retry" | "continue";

/** Pista de longitud que se le comunica al modelo. */
export type LengthHint = "explicit-pages" | "brief" | "default";

export type DocumentContinuation = {
  /** Markdown del documento parcial previo (sin notas de timeout). */
  markdown: string;
  /** Resumen previo, si lo hay. */
  summary?: string;
  /** Título previo, si lo hay. */
  title?: string;
  /** Versión previa, por defecto "1.0". */
  version?: string;
  /** ID del documento parcial en storage, para metadatos. */
  documentId?: string;
};

export type DocumentDraftRequest = {
  message: string;
  model?: string;
  history?: DocumentHistoryItem[];
  filesContent?: string;
  projectContext?: string;
  ragContext?: string;
  kbContext?: string;
  images?: string[];
  format?: DocumentFormat;
  title?: string;
  version?: string;
  maxPages?: number;
  signal?: AbortSignal;
  onEvent?: (event: DocumentPipelineEvent) => void;
  /** Si se pide continuación de un documento parcial. */
  continuation?: DocumentContinuation;
  /** Instrucción adicional para la continuación (ej. "termina el último capítulo"). */
  instruction?: string;
  /** Modo de intención: nuevo, reintento o continuación. */
  mode?: DocumentIntentMode;
  /** Si es true, se ignora cualquier parcial y se regenera desde cero. */
  forceReset?: boolean;
  /** Pista de longitud para el prompt. */
  lengthHint?: LengthHint;
};

export type DocumentDraft = {
  title: string;
  filename: string;
  format: DocumentFormat;
  summary: string;
  markdown: string;
  /** Markdown limpio sin notas de timeout, para sidecar y continuación. */
  sourceMarkdown?: string;
  version: string;
  generatedAt: Date;
  maxPages: number;
  truncated: boolean;
  continuationUsed: boolean;
  /** La generación se detuvo por timeout. */
  timedOut?: boolean;
  /** Es un documento parcial (continuación o timeout). */
  partial?: boolean;
  chars: number;
  /** El recorte se debió al límite de páginas, no solo a `done_reason=length`. */
  pageLimitApplied?: boolean;
  /** Palabras conservadas y originales, para metadatos de truncado. */
  words?: number;
  originalWords?: number;
  originalChars?: number;
  /** Origen de la petición. */
  mode?: DocumentIntentMode;
  /** Pista de longitud usada. */
  lengthHint?: LengthHint;
};

export type DocumentStreamFn = (
  model: string,
  messages: InferenceMessage[],
  options?: ChatOptions & { signal?: AbortSignal },
) => AsyncGenerator<string>;

export type DocumentPipelineDeps = {
  stream?: DocumentStreamFn;
};

export class DocumentGenerationError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "DocumentGenerationError";
    this.cause = cause;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

/** Tiempo máximo total para generar un documento (ms). Default: 5 min. */
export function resolveDocumentTimeoutMs(): number {
  const value = Number(process.env.DOC_OLLAMA_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 300_000;
}

function normalizePipelineError(error: unknown): unknown {
  if (isAbortError(error)) return error;
  if (isTimeoutError(error)) return error;
  if (error instanceof DocumentGenerationError) return error;
  return new DocumentGenerationError(
    "No se pudo generar el documento. Intenta de nuevo.",
    error,
  );
}

export function normalizeForKey(value: string): string {
  return sanitizeDocumentText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  const usable = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${usable.trimEnd()}…`;
}

export function resolveDocumentMaxPages(value?: number, message?: string): number {
  if (value !== undefined) return clampPages(value);

  const text = message ?? "";

  // 1. Excepción: páginas que describen la fuente (no la salida).
  //    Se evalúa antes que las páginas explícitas para que "resumen del reporte
  //    de 4 páginas" no se interprete como 4 páginas de salida.
  const sourceMatch = text.match(SOURCE_PAGES_PATTERN);
  if (sourceMatch) {
    const cleaned = text.replace(sourceMatch[0], " ");
    if (BRIEF_PATTERN.test(cleaned)) return DEFAULT_BRIEF_MAX_PAGES;
    return DEFAULT_MAX_PAGES;
  }

  // 2. Número explícito de páginas para el documento de salida.
  const explicit = text.match(EXPLICIT_PAGES_PATTERN);
  if (explicit) return clampPages(Number(explicit[1]));

  // 3. "Breve" → 2 páginas.
  if (BRIEF_PATTERN.test(text)) return DEFAULT_BRIEF_MAX_PAGES;

  // 4. Variable de entorno o default.
  const envValue = Number(process.env.DOC_MAX_PAGES);
  return clampPages(Number.isFinite(envValue) && envValue > 0 ? envValue : DEFAULT_MAX_PAGES);
}

/** Resuelve la pista de longitud para el prompt, sin calcular el número. */
export function resolveDocumentLengthHint(
  value?: number,
  message?: string,
): LengthHint {
  if (value !== undefined) return "explicit-pages";

  const text = message ?? "";

  const explicit = text.match(EXPLICIT_PAGES_PATTERN);
  if (explicit) return "explicit-pages";

  const sourceMatch = text.match(SOURCE_PAGES_PATTERN);
  if (sourceMatch) {
    const cleaned = text.replace(sourceMatch[0], " ");
    if (BRIEF_PATTERN.test(cleaned)) return "brief";
    return "default";
  }

  if (BRIEF_PATTERN.test(text)) return "brief";
  return "default";
}

export type DocumentClampResult = {
  markdown: string;
  truncated: boolean;
  /** Palabras conservadas (sin contar la nota de truncado). */
  words: number;
  /** Palabras del contenido original. */
  originalWords: number;
  /** Caracteres del contenido original. */
  originalChars: number;
};

const TRUNCATION_NOTE_PATTERN =
  /(?:\r?\n){0,2}>\s*\*\*Nota:\*\*\s*El contenido se truncó[^\n]*$/i;

function countWords(value: string): number {
  const text = String(value ?? "").trim();
  return text ? text.split(/\s+/).length : 0;
}

export function countDocumentWords(value: string): number {
  return countWords(value);
}

function stripTruncationNote(markdown: string): string {
  return markdown.replace(TRUNCATION_NOTE_PATTERN, "").trimEnd();
}

function truncationNote(maxPages: number): string {
  const pages = Math.max(1, Math.round(maxPages));
  const label = pages === 1 ? "página" : "páginas";
  return `> **Nota:** El contenido se truncó para respetar el límite de ${pages} ${label}.`;
}

/**
 * Corta el Markdown en un límite de palabras sin partir una palabra y,
 * cuando es posible, en un borde de párrafo. Añade una nota visible.
 */
export function clampDocumentMarkdownToWords(
  markdown: string,
  maxWords: number,
  maxPages: number = MAX_PAGES,
): DocumentClampResult {
  const original = String(markdown ?? "").trim();
  const content = stripTruncationNote(original);
  const originalWords = countWords(content);
  const originalChars = content.length;
  const limit = Math.max(1, Math.floor(maxWords));

  if (originalWords <= limit) {
    return {
      markdown: content,
      truncated: false,
      words: originalWords,
      originalWords,
      originalChars,
    };
  }

  let words = 0;
  let end = 0;
  const matcher = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(content)) !== null) {
    words += 1;
    end = match.index + match[0].length;
    if (words >= limit) break;
  }

  const rawCut = content.slice(0, end).trimEnd();
  const paragraphBoundary = rawCut.lastIndexOf("\n\n");
  const lineBoundary = rawCut.lastIndexOf("\n");
  const safeBoundary =
    paragraphBoundary >= rawCut.length * 0.6
      ? paragraphBoundary
      : lineBoundary >= rawCut.length * 0.8
        ? lineBoundary
        : -1;
  const kept = (safeBoundary > 0 ? rawCut.slice(0, safeBoundary) : rawCut).trimEnd();

  return {
    markdown: `${kept}\n\n${truncationNote(maxPages)}`,
    truncated: true,
    words: countWords(kept),
    originalWords,
    originalChars,
  };
}

/** Recorta un documento al límite de páginas configurado. */
export function clampDocumentMarkdown(
  markdown: string,
  maxPages: number = MAX_PAGES,
): DocumentClampResult {
  const pages = Math.max(1, Math.round(maxPages));
  return clampDocumentMarkdownToWords(markdown, pages * WORDS_PER_PAGE, pages);
}

function systemPrompt(maxPages: number, lengthHint?: LengthHint): string {
  const maxWords = maxPages * WORDS_PER_PAGE;
  const today = new Date().toLocaleDateString("es-MX", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  let lengthRule: string;
  if (lengthHint === "explicit-pages") {
    lengthRule = `El usuario pidió explícitamente ${maxPages} páginas. Respeta ese límite: sé conciso pero completo, sin relleno.`;
  } else if (lengthHint === "brief") {
    lengthRule = `El usuario pidió un documento breve. Sé conciso y ve directo al grano, sin relleno.`;
  } else {
    lengthRule = `Extensión máxima: ${maxPages} páginas (aproximadamente ${maxWords} palabras). Sé completo pero evita relleno.`;
  }

  return `Hoy es ${today}. Eres un redactor de documentos profesionales en español.

Tu única tarea es producir el contenido completo del documento que pide el usuario.

FORMATO DE SALIDA (obligatorio):
RESUMEN: <2 o 3 frases que expliquen qué contiene el documento>
${DOCUMENT_MARKER}
# <Título del documento>
<Contenido del documento en Markdown>

REGLAS:
- Usa Markdown puro. No envuelvas todo el documento en un bloque de código.
- Estructura el contenido con #, ## y ###. No repitas el título como encabezado de sección.
- Usa párrafos, listas, tablas GFM, negritas y cursivas cuando aporten claridad.
- No incluyas HTML, imágenes, enlaces inventados ni emojis.
- El documento debe ser autónomo: no digas "como se mencionó arriba" ni hagas referencias al chat.
- ${lengthRule}
- No incluyas una tabla de contenido ni una portada: el sistema las añade.
- Si falta información, indícalo dentro del documento; no inventes datos.
- Empieza directamente con "# Título" después del delimitador.`;
}

function contextBlock(label: string, value: string | undefined): string {
  const text = sanitizeDocumentText(value ?? "").trim();
  if (!text) return "";
  return `${label}:\n${truncate(text, MAX_CONTEXT_CHARS)}`;
}

/** Construye los mensajes de la llamada única que genera el documento. */
export function buildDocumentMessages(request: DocumentDraftRequest): InferenceMessage[] {
  const maxPages = resolveDocumentMaxPages(request.maxPages, request.message);
  const maxWords = maxPages * WORDS_PER_PAGE;
  const lengthHint = request.lengthHint ?? resolveDocumentLengthHint(request.maxPages, request.message);
  const current = sanitizeDocumentText(request.message ?? "").trim();
  const messages: InferenceMessage[] = [
    { role: "system", content: systemPrompt(maxPages, lengthHint) },
  ];

  const history = (request.history ?? []).slice(-MAX_HISTORY_MESSAGES);
  const currentKey = normalizeForKey(current);
  let currentHistoryIndex = -1;

  // El mensaje actual puede venir ya insertado en el historial.
  for (let index = history.length - 1; index >= 0; index--) {
    const item = history[index];
    if (item.role === "user" && normalizeForKey(item.text ?? "") === currentKey) {
      currentHistoryIndex = index;
      break;
    }
  }

  history.forEach((item, index) => {
    if (index === currentHistoryIndex) return;

    const text = sanitizeDocumentText(item.text ?? "").trim();
    if (!text) return;

    messages.push({
      role: item.role === "ai" ? "assistant" : "user",
      content: truncate(text, MAX_HISTORY_CHARS),
    });
  });

  const context = [
    contextBlock("CONTEXTO DEL PROYECTO", request.projectContext),
    contextBlock("BASE DE CONOCIMIENTO", request.kbContext),
    contextBlock("FRAGMENTOS DE DOCUMENTOS", request.ragContext),
    contextBlock("CONTENIDO DE ARCHIVOS ADJUNTOS", request.filesContent),
  ]
    .filter(Boolean)
    .join("\n\n");

  let lengthInstruction: string;
  if (lengthHint === "explicit-pages") {
    lengthInstruction = `Genera el documento completo en aproximadamente ${maxPages} páginas (aproximadamente ${maxWords} palabras). Respeta ese límite.`;
  } else if (lengthHint === "brief") {
    lengthInstruction = `Genera un documento breve. Sé conciso y directo, sin relleno. Máximo ${maxPages} páginas (aproximadamente ${maxWords} palabras).`;
  } else {
    lengthInstruction = `Genera el documento completo ahora. Recuerda: máximo ${maxPages} páginas (aproximadamente ${maxWords} palabras).`;
  }

  const userContent = [
    context,
    `SOLICITUD DEL DOCUMENTO:\n${current}`,
    lengthInstruction,
  ]
    .filter(Boolean)
    .join("\n\n");

  const lastUser: InferenceMessage = { role: "user", content: userContent };
  if (request.images?.length) lastUser.images = request.images;
  messages.push(lastUser);

  return messages;
}

/** Limpia el resumen que el modelo escribe antes del delimitador. */
export function cleanSummary(raw: string): string {
  let summary = sanitizeDocumentText(raw ?? "")
    .replace(/^\s*(?:\*{1,2})?(?:RESUMEN|SUMMARY)(?:\*{1,2})?\s*:\s*(?:\*{1,2})?/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“”']+|["“”']+$/g, "")
    .replace(/^(?:\*{1,2})\s*|\s*(?:\*{1,2})$/g, "")
    .trim();

  if (summary.length > MAX_SUMMARY_CHARS) {
    summary = truncate(summary, MAX_SUMMARY_CHARS);
  }

  return summary;
}

/** Limpia el Markdown del documento (fences externos, etiquetas, controles). */
export function cleanMarkdown(raw: string): string {
  let text = sanitizeDocumentText(raw ?? "").trim();
  text = text.replace(/^\uFEFF/, "");
  text = text.replace(/^\s*(?:DOCUMENTO|DOCUMENT)\s*:\s*/i, "");

  const wrapped = text.match(/^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (wrapped) {
    text = wrapped[1];
  } else {
    // Modelos que abren un fence y no lo cierran (o viceversa).
    text = text.replace(/^```(?:markdown|md|text)?\s*\n/i, "");
    text = text.replace(/\n```\s*$/i, "");
  }

  return text.trim();
}

/** Parsea de forma tolerante la respuesta del modelo. */
export function parseDocumentResponse(
  raw: string,
): { summary: string; markdown: string } {
  const text = sanitizeDocumentText(raw ?? "").trim();

  const marker = text.match(MARKER_PATTERN);
  if (marker?.index !== undefined) {
    return {
      summary: cleanSummary(text.slice(0, marker.index)),
      markdown: cleanMarkdown(text.slice(marker.index + marker[0].length)),
    };
  }

  const alternative = text.match(/(?:^|\n)\s*(?:DOCUMENTO|DOCUMENT)\s*:\s*\n/i);
  if (alternative?.index !== undefined) {
    const start = alternative.index + alternative[0].length;
    return {
      summary: cleanSummary(text.slice(0, alternative.index)),
      markdown: cleanMarkdown(text.slice(start)),
    };
  }

  // El modelo ignoró el delimitador pero sí escribió RESUMEN.
  const leadingSummary = text.match(
    /^\s*(?:\*{1,2})?(?:RESUMEN|SUMMARY)(?:\*{1,2})?\s*:\s*([\s\S]*?)\n+(?=#{1,6}\s)/i,
  );
  if (leadingSummary) {
    return {
      summary: cleanSummary(leadingSummary[1]),
      markdown: cleanMarkdown(text.slice(leadingSummary[0].length)),
    };
  }

  return { summary: "", markdown: cleanMarkdown(text) };
}

function firstBodyParagraph(markdown: string): string {
  const lines = markdown.split("\n");
  const buffer: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (buffer.length) break;
      continue;
    }
    if (/^(#{1,6}\s|[-*+]\s|\d+\.\s|>|\||```|---)/.test(trimmed)) {
      if (buffer.length) break;
      continue;
    }
    buffer.push(trimmed);
  }

  return buffer
    .join(" ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function fallbackDocumentSummary(markdown: string, title: string): string {
  const paragraph = firstBodyParagraph(markdown);
  if (paragraph) return truncate(paragraph, 320);
  return `He preparado el documento "${title}" con el contenido solicitado.`;
}

function fallbackDocumentTitle(message: string): string {
  const clean = sanitizeDocumentText(message ?? "")
    .replace(
      /^(?:hazme|haz|crea|creame|genera|generame|prepara|preparame|elabora|elaborame|redacta|redactame|escribe|escribeme|dame|pasame|necesito|quiero)\s+/i,
      "",
    )
    .replace(/[.?!].*$/, "")
    .trim()
    .slice(0, MAX_TITLE_CHARS)
    .trim();

  if (!clean) return "Documento";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function buildContinuationMessages(
  markdown: string,
  maxPages: number,
  instruction?: string,
): InferenceMessage[] {
  const tail = markdown.slice(-6000);
  const instructionLine = instruction
    ? `\nInstrucción adicional: ${instruction}\n`
    : "";
  return [
    {
      role: "system",
      content: `Continúa exactamente donde se cortó un documento Markdown. No repitas contenido, no agregues explicaciones ni bloques de código externos: devuelve solo la continuación literal. El documento completo no debe exceder ${maxPages} páginas.`,
    },
    {
      role: "user",
      content: `Fragmento final del documento hasta ahora:\n\n${tail}\n\nContinúa el documento desde el final del fragmento.${instructionLine}`,
    },
  ];
}

function joinContinuation(left: string, right: string): string {
  const a = left.trimEnd();
  const b = right.trimStart();
  if (!a) return b;
  if (!b) return a;

  // Filas de tabla y listas de valores continúan en una línea nueva.
  if (/[|,;:]\s*$/.test(a) || /^[|,;:]/.test(b)) return `${a}\n${b}`;

  // Corte a mitad de frase.
  if (!/[.!?…:]\s*$/.test(a) && /^[a-záéíóúñü0-9]/.test(b)) {
    return `${a} ${b}`;
  }

  return `${a}\n\n${b}`;
}

/**
 * Genera el borrador de un documento en una sola llamada de streaming y,
 * si el modelo se corta por longitud, pide una continuación.
 *
 * No convierte a DOCX/PDF ni guarda archivos: eso lo hace la capa de
 * almacenamiento para mantener esta pieza testeable.
 */
export async function generateDocumentDraft(
  request: DocumentDraftRequest,
  deps: DocumentPipelineDeps = {},
): Promise<DocumentDraft> {
  const stream = deps.stream ?? ollamaChatStream;
  const model = request.model || getChatModel();
  const format = request.format ?? "pdf";

  // Resolver longitud: número explícito > "breve" > default/env
  const maxPages =
    request.maxPages ?? resolveDocumentMaxPages(request.maxPages, request.message);
  const lengthHint =
    request.lengthHint ?? resolveDocumentLengthHint(request.maxPages, request.message);

  const maxTokens = Math.min(
    MAX_DOCUMENT_TOKENS,
    Math.max(MIN_DOCUMENT_TOKENS, maxPages * TOKENS_PER_PAGE),
  );
  const emit = (event: DocumentPipelineEvent) => request.onEvent?.(event);

  let timedOut = false;
  let partial = false;
  let doneReason: string | undefined;

  // ─── Continuación de documento parcial ────────────────────────────────
  const isContinuation =
    request.mode === "continue" || !!request.continuation;
  const baseMarkdown = request.continuation?.markdown ?? "";
  const baseVersion = request.continuation?.version ?? "1.0";
  const baseSummary = request.continuation?.summary;
  const baseTitle = request.continuation?.title;

  if (isContinuation && baseMarkdown) {
    const remainingWords =
      maxPages * WORDS_PER_PAGE - countDocumentWords(baseMarkdown);
    if (remainingWords <= 0) {
      throw new DocumentGenerationError(
        "El documento ya llegó al máximo de páginas. Si quieres agregar más contenido, pídeme un documento nuevo indicando un número mayor de páginas.",
      );
    }

    const continuationTokens = Math.min(
      MAX_DOCUMENT_TOKENS,
      Math.max(MIN_DOCUMENT_TOKENS, Math.floor((remainingWords / WORDS_PER_PAGE) * TOKENS_PER_PAGE)),
    );

    let truncated = false;

    emit({ type: "status", stage: "writing" });
    let raw = "";
    let totalChars = 0;
    let lastProgressAt = 0;

    const emitProgress = (chars: number, force = false) => {
      const now = Date.now();
      if (!force && now - lastProgressAt < 500) return;
      lastProgressAt = now;
      emit({ type: "progress", stage: "writing", chars });
    };

    try {
      for await (const chunk of stream(model, buildContinuationMessages(baseMarkdown, maxPages, request.instruction), {
        num_predict: continuationTokens,
        signal: request.signal,
        timeoutMs: resolveDocumentTimeoutMs(),
        idleTimeoutMs: undefined,
        onDone: (info) => {
          doneReason = info.doneReason;
        },
      })) {
        raw += chunk;
        totalChars = raw.length;
        emitProgress(totalChars);
      }
    } catch (error) {
      if (isTimeoutError(error) && raw.trim().length > 0) {
        timedOut = true;
      } else {
        throw normalizePipelineError(error);
      }
    }

    if (!raw.trim() && !timedOut) {
      throw new DocumentGenerationError(
        "La generación del documento excedió el tiempo límite antes de producir contenido. Intenta de nuevo o pide un documento más breve.",
      );
    }

    const cleaned = cleanMarkdown(raw);
    let markdown = baseMarkdown;
    if (cleaned) {
      markdown = joinContinuation(baseMarkdown, cleaned);
    }
    partial = true;

    const clamped = clampDocumentMarkdown(markdown, maxPages);
    markdown = clamped.markdown;
    const pageLimitApplied = clamped.truncated;
    if (pageLimitApplied) truncated = true; // `truncated` not yet declared in this branch

    const sourceMarkdown = markdown;

    if (timedOut) {
      markdown = `${markdown.trimEnd()}\n\n> **Nota:** La generación se detuvo al alcanzar el tiempo límite; el documento contiene el contenido generado hasta ese punto.`;
    }

    const title =
      sanitizeDocumentText(
        request.title?.trim() ||
          baseTitle ||
          extractMarkdownTitle(markdown) ||
          fallbackDocumentTitle(request.message),
      ).trim() || "Documento";

    const summary =
      baseSummary ??
      (markdown.trim() ? fallbackDocumentSummary(markdown, title) : "");

    const safeTitle =
      sanitizeDocumentText(title).slice(0, MAX_TITLE_CHARS).trim() || "Documento";
    const version =
      request.version?.trim() || baseVersion || "1.0";

    // Calcular palabras finales para metadatos
    const finalWords = countDocumentWords(markdown);
    const finalChars = markdown.length;

    return {
      title: safeTitle,
      filename: slugifyDocumentFilename(safeTitle, format),
      format,
      summary,
      markdown,
      sourceMarkdown,
      version,
      generatedAt: new Date(),
      maxPages,
      truncated: pageLimitApplied || timedOut,
      continuationUsed: true,
      timedOut,
      partial,
      chars: finalChars,
      pageLimitApplied,
      words: finalWords,
      originalWords: clamped.originalWords,
      originalChars: clamped.originalChars,
      mode: "continue",
      lengthHint,
    };
  }

  // ─── Generación normal (desde cero) ───────────────────────────────────
  emit({ type: "status", stage: "analyzing" });
  const messages = buildDocumentMessages({ ...request, maxPages, lengthHint });

  let raw = "";
  let totalChars = 0;
  let summaryEmitted = false;
  let lastProgressAt = 0;

  const emitProgress = (chars: number, force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < 500) return;
    lastProgressAt = now;
    emit({ type: "progress", stage: "writing", chars });
  };

  emit({ type: "status", stage: "writing" });

  try {
    for await (const chunk of stream(model, messages, {
      num_predict: maxTokens,
      signal: request.signal,
      timeoutMs: resolveDocumentTimeoutMs(),
      idleTimeoutMs: undefined,
      onDone: (info) => {
        doneReason = info.doneReason;
      },
    })) {
      raw += chunk;
      totalChars = raw.length;

      if (!summaryEmitted) {
        const marker = raw.match(MARKER_PATTERN);
        if (marker?.index !== undefined) {
          const summary = cleanSummary(raw.slice(0, marker.index));
          if (summary) {
            summaryEmitted = true;
            emit({ type: "summary", text: summary });
          }
        }
      }

      emitProgress(totalChars);
    }
  } catch (error) {
    if (isTimeoutError(error) && raw.trim().length > 0) {
      timedOut = true;
    } else if (isTimeoutError(error)) {
      throw new DocumentGenerationError(
        "La generación del documento excedió el tiempo límite antes de producir contenido. Intenta de nuevo o pide un documento más breve.",
        error,
      );
    } else {
      throw normalizePipelineError(error);
    }
  }

  if (!raw.trim()) {
    throw new DocumentGenerationError(
      "La IA no devolvió contenido para el documento. Intenta de nuevo.",
    );
  }

  emitProgress(totalChars, true);
  emit({ type: "status", stage: "parsing" });

  const parsed = parseDocumentResponse(raw);
  let markdown = parsed.markdown;
  let summary = parsed.summary;
  let truncated = doneReason === "length";
  let continuationUsed = false;

  if (truncated && !request.signal?.aborted) {
    emit({ type: "status", stage: "writing" });
    let extra = "";
    let extraReason: string | undefined;

    try {
      for await (const chunk of stream(
        model,
        buildContinuationMessages(markdown, maxPages),
        {
          num_predict: Math.min(8000, Math.max(2000, maxPages * 600)),
          signal: request.signal,
          timeoutMs: resolveDocumentTimeoutMs(),
          idleTimeoutMs: undefined,
          onDone: (info) => {
            extraReason = info.doneReason;
          },
        },
      )) {
        extra += chunk;
        totalChars = raw.length + extra.length;
        emitProgress(totalChars);
      }
    } catch (error) {
      if (isAbortError(error) || request.signal?.aborted) {
        throw normalizePipelineError(error);
      }
      // Si la continuación falla, conservamos el documento parcial.
    }

    const cleaned = cleanMarkdown(extra);
    if (cleaned) {
      markdown = joinContinuation(markdown, cleaned);
      continuationUsed = true;
      truncated = extraReason === "length";
    }

    emitProgress(totalChars, true);
    emit({ type: "status", stage: "parsing" });
  }

  if (!markdown.trim()) {
    throw new DocumentGenerationError(
      "La IA no devolvió el contenido del documento. Intenta de nuevo.",
    );
  }

  // Recorte determinista: aunque el modelo ignore el límite del prompt, el
  // documento nunca supera las páginas configuradas por palabras.
  const clamped = clampDocumentMarkdown(markdown, maxPages);
  markdown = clamped.markdown;
  const pageLimitApplied = clamped.truncated;
  if (pageLimitApplied) truncated = true;

  const title =
    sanitizeDocumentText(
      request.title?.trim() ||
        extractMarkdownTitle(markdown) ||
        fallbackDocumentTitle(request.message),
    ).trim() || "Documento";

  if (!summary) {
    summary = fallbackDocumentSummary(markdown, title);
  }

  if (summary && !summaryEmitted) {
    summaryEmitted = true;
    emit({ type: "summary", text: summary });
  }

  const safeTitle =
    sanitizeDocumentText(title).slice(0, MAX_TITLE_CHARS).trim() || "Documento";
  const version = request.version?.trim() || "1.0";

  const sourceMarkdown = markdown;

  if (timedOut) {
    markdown = `${markdown.trimEnd()}\n\n> **Nota:** La generación se detuvo al alcanzar el tiempo límite; el documento contiene el contenido generado hasta ese punto.`;
    partial = true;
  }

  const finalWords = countDocumentWords(markdown);
  const finalChars = markdown.length;

  return {
    title: safeTitle,
    filename: slugifyDocumentFilename(safeTitle, format),
    format,
    summary,
    markdown,
    sourceMarkdown,
    version,
    generatedAt: new Date(),
    maxPages,
    truncated,
    continuationUsed,
    timedOut,
    partial,
    chars: finalChars,
    pageLimitApplied,
    words: finalWords,
    originalWords: clamped.originalWords,
    originalChars: clamped.originalChars,
    mode: request.mode ?? "new",
    lengthHint,
  };
}

/** Convierte un borrador a DOCX reutilizando portada y estilos. */
export async function renderDocumentDocx(
  draft: DocumentDraft,
  options?: { subtitle?: string; author?: string },
): Promise<DocumentDocxResult> {
  return buildDocumentDocx({
    markdown: draft.markdown,
    title: draft.title,
    version: draft.version,
    date: draft.generatedAt,
    subtitle: options?.subtitle,
    author: options?.author,
  });
}

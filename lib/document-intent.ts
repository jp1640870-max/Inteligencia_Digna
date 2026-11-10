import type { DocGenFormat } from "@/types";
import type { DocumentIntentMode } from "@/lib/document-pipeline";

/**
 * Detección de intención de documento.
 *
 * Reglas deliberadamente conservadoras: es mejor que el usuario use el botón
 * "Exportar a PDF" a que una pregunta normal se convierta en un archivo.
 * Las frases se normalizan sin acentos para que las regex sean simples.
 */

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const CREATE_VERB =
  /\b(?:haz|hazme|hazlo|hacer|hacerme|crea|creame|crear|genera|generame|generar|prepara|preparame|preparar|elabora|elaborame|elaborar|arma|armame|armar|redacta|redactame|redactar|escribe|escribeme|escribir|dame|pasame|comparte|comparteme|mandame|enviame|necesito|quiero|solicito|requiero)\b/;

const STRONG_CREATE_VERB =
  /\b(?:haz|hazme|hazlo|crea|creame|genera|generame|prepara|preparame|elabora|elaborame|arma|armame|redacta|redactame|escribe|escribeme)\b/;

const POLITE_CREATE =
  /\b(?:(?:me\s+)?puedes|podrias|me\s+podrias|ayudame\s+a|necesito\s+que|quiero\s+que)\s+(?:me\s+)?(?:hagas|hacer|hacerme|crees|crear|crearme|generes|generar|generarme|prepares|preparar|prepararme|elabores|elaborar|elaborarme|redactes|redactar|redactarme)\b/;

const FORMAT_CUE = /\b(?:pdf|docx|xlsx|excel|word|documento|archivo)\b/;

const SPREADSHEET_CUE = /\b(?:excel|xlsx|hoja de calculo|spreadsheet|libro de excel|tabla|tablas)\b/;

const DOCUMENT_NOUN =
  /\b(?:manual|manuales|guia|guias|instructivo|instructivos|procedimiento|procedimientos|protocolo|protocolos|reporte|reportes|informe|informes|politica|politicas|contrato|contratos|carta|cartas|oficio|oficios|propuesta|propuestas|presentacion|presentaciones|plan|planes|programa|programas|checklist|lista de verificacion|formato|formatos|plantilla|plantillas|memoria|tesis|articulo|articulos|libro|libros|folleto|folletos|catalogo|catalogos|acta|actas|constancia|constancias|diploma|diplomas|recibo|recibos|factura|facturas|cotizacion|cotizaciones|presupuesto|presupuestos|resumen ejecutivo|documento|documentos|archivo|archivos)\b/;

const DOWNLOAD_CUE =
  /\b(?:para descargar|descargable|que pueda descargar|que se pueda descargar|lista para descargar|en formato)\b/;

const NEGATIVE_CUE =
  /\b(?:no\s+(?:me\s+)?(?:generes|crees|hagas|elabores|prepares|envies|mandes)|no\s+(?:me\s+)?(?:puedes|podrias)\s+(?:hacer|crear|generar|preparar|elaborar|redactar)|no\s+quiero\s+que\s+(?:me\s+)?(?:generes|crees|hagas)|(?:como|quiero saber como)\s+(?:se\s+)?(?:hace|hacer|hago|crear|generar)\s+(?:un\s+)?(?:pdf|word|docx|excel|xlsx|documento|archivo)|que\s+es\s+(?:un\s+)?(?:pdf|docx|xlsx))\b/;

const DOWNLOAD_EXISTING =
  /\b(?:quiero|necesito|puedo|me puedes)\s+descargar\s+(?:el|la|ese|esa|este|esta|mi)\s+(?:pdf|archivo|documento)\b/;

const RETRY_PATTERN =
  /\b(?:intenta|intentalo|vuelve|vuelve a intentar|otra vez|de nuevo|no funciono|no funciona|fallo|falla|reintenta|reintentar|otro intento|corrige|corregir)\b/;

const CONTINUE_PATTERN =
  /\b(?:continua|continúo|continúa|continua el|continúa el|sigue|sigue el|termina|termina el|completa|completa el|lo que falta|el resto|continuar)\b/;

const RESET_PATTERN =
  /\b(?:desde\s+cero|hazlo\s+de\s+nuevo|empieza\s+de\s+nuevo|regenera|regenerar|de\s+nuevo\s+desde\s+cero)\b/;

/**
 * Corrección de formato sobre un documento ya pedido. Exige un formato
 * explícito para no convertir un "mejor en general" en otra generación.
 */
const FORMAT_CORRECTION =
  /\b(?:mejor|cambialo|cambiala|cambiarlo|cambiarla|cambiar|ahora|que sea|hazlo|hacerlo|pero|en vez de|en lugar de)\b[^\n]*\b(?:pdf|docx|word|excel|xlsx|hoja de calculo)\b/;

const EXPORT_VERB =
  /\b(?:exporta|exportalo|exportala|exportame|exportar|exporte|exporten|convierte|conviertelo|conviertela|conviertelos|conviertelas|convertir|guarda|guardar|guardalo|guardala|guardalos|guardalas)\b/;

const PASS_VERB = /\b(?:pasalo|pasala|pasalos|pasalas|pasamelo|pasamela)\b/;

const EXPORT_REFERENCE =
  /\b(?:esto|esta|este|estos|estas|eso|esa|esos|esas|respuesta|respuestas|mensaje|mensajes|texto|contenido|archivo|anterior|ultimo|ultima|previo|previa|arriba)\b/;

const EXPORT_FORMAT = /\b(?:pdf|docx|word|excel|xlsx|hoja de calculo)\b/;

const EXPORT_QUESTION =
  /\b(?:como|se puede|puedo|podria|cual es|donde)\b[^\n]*\b(?:export\w*|conviert\w*|convertir|pasalo|pasala)\b/;

const EXPORT_NEGATIVE =
  /\bno\s+(?:exportes|exporta|exportalo|exportala|conviertas|convierte|conviertelo|conviertela|pases|pasalo|pasala|guardes|guardalo|guardala)\b/;

/** `true` si el mensaje pide crear un documento/archivo. */
export function wantsDocument(text: string): boolean {
  const value = normalize(text);
  if (!value) return false;
  if (NEGATIVE_CUE.test(value) || DOWNLOAD_EXISTING.test(value)) return false;

  const create = CREATE_VERB.test(value);
  const strongCreate = STRONG_CREATE_VERB.test(value);
  const politeCreate = POLITE_CREATE.test(value);
  const format = FORMAT_CUE.test(value);
  const noun = DOCUMENT_NOUN.test(value);
  const download = DOWNLOAD_CUE.test(value);
  const spreadsheet =
    SPREADSHEET_CUE.test(value) && !/\btabla de contenido\b/.test(value);

  // "Hazme un manual que explique este proceso para descargar en pdf"
  if (noun && (strongCreate || politeCreate || download)) return true;
  // "Hazme un pdf", "genera un excel", "dame el archivo"
  if (format && create) return true;
  // "Hazme una tabla" (sin decir Excel)
  if (spreadsheet && create) return true;

  return false;
}

/** `true` si el mensaje contiene un formato de archivo explícito. */
export function hasExplicitDocumentFormat(text: string): boolean {
  return /\b(?:pdf|docx|xlsx|excel|word|hoja de calculo|spreadsheet)\b/.test(normalize(text));
}

/**
 * Detecta el formato pedido. El PDF gana sobre "documento" para que
 * "documento en pdf" no se convierta en Word.
 */
export function detectDocFormat(text: string): DocGenFormat {
  const value = normalize(text);

  if (/\b(?:excel|xlsx|hoja de calculo|spreadsheet|libro de excel)\b/.test(value)) return "xlsx";
  if (/\bpdf\b/.test(value)) return "pdf";
  if (/\b(?:word|docx)\b/.test(value)) return "docx";
  if (
    /\b(?:tabla|tablas|columnas|filas)\b/.test(value) &&
    !/\btabla de contenido\b/.test(value) &&
    !DOCUMENT_NOUN.test(value)
  ) return "xlsx";

  return "pdf";
}

/** `true` si el mensaje parece un reintento o una corrección de formato. */
export function isDocumentRetry(text: string): boolean {
  const value = normalize(text);
  return RETRY_PATTERN.test(value) || FORMAT_CORRECTION.test(value);
}

export type ExportDocumentFormat = "pdf" | "docx";

export type ExportIntent = {
  wantsExport: boolean;
  format: ExportDocumentFormat;
  /** Formato pedido que no aplica a la exportación de una respuesta. */
  unsupportedFormat?: DocGenFormat;
};

/**
 * Detecta "exporta esto a PDF", "pásalo a Word" o "convierte la respuesta
 * anterior a PDF". Si no hay formato explícito, se asume PDF.
 */
export function detectExportIntent(text: string): ExportIntent {
  const value = normalize(text);
  const none: ExportIntent = { wantsExport: false, format: "pdf" };
  if (!value) return none;
  if (EXPORT_NEGATIVE.test(value) || EXPORT_QUESTION.test(value)) return none;

  const reference = EXPORT_REFERENCE.test(value);
  const explicitFormat = EXPORT_FORMAT.test(value);
  const exportVerb = EXPORT_VERB.test(value);
  const passVerb = PASS_VERB.test(value);
  const impliesPass = /\bpasa\b(?!me)\b/.test(value) && reference;
  const passMe = /\bpasame\b/.test(value) && reference && explicitFormat;

  if (!(exportVerb || passVerb || impliesPass || passMe)) return none;
  if (!reference && !explicitFormat) return none;

  const format = detectDocFormat(value);
  if (format === "xlsx") {
    return { wantsExport: true, format: "pdf", unsupportedFormat: "xlsx" };
  }
  return { wantsExport: true, format };
}

export type DocumentIntentHistoryItem = {
  role: "user" | "ai";
  text?: string;
};

/** Busca la última petición de documento del usuario en el historial. */
export function findDocumentRequest(history: DocumentIntentHistoryItem[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message.role === "user" && message.text && wantsDocument(message.text)) {
      return message.text;
    }
  }
  return null;
}

export type DocumentIntent = {
  wantsDocument: boolean;
  request: string;
  format: DocGenFormat;
  isRetry: boolean;
  /** Modo de resolución: nuevo, reintento o continuación. */
  mode: DocumentIntentMode;
  /** Si es true, se ignora cualquier parcial y se regenera desde cero. */
  forceReset: boolean;
};

/**
 * Resuelve intención + formato combinando el mensaje actual con el historial.
 * Si el mensaje es un reintento ("otra vez"), reutiliza la petición anterior.
 */
export function resolveDocumentIntent(
  message: string,
  history: DocumentIntentHistoryItem[] = [],
): DocumentIntent {
  const retry = isDocumentRetry(message);
  const reset = RESET_PATTERN.test(message);
  const continueRequest = CONTINUE_PATTERN.test(message);

  let request = message;
  let wants = wantsDocument(message);

  if (retry) {
    const previous = findDocumentRequest(history);
    if (previous) {
      wants = true;
      request = previous;
    }
  }

  // Prioridad: reset > continue > retry > new.
  // Los patrones de continuación y reset se evalúan incluso cuando
  // wantsDocument es false, porque el usuario puede pedir "continúa el
  // documento" sin usar un verbo de creación explícito.
  let mode: DocumentIntentMode = "new";
  let forceReset = false;

  if (reset) {
    mode = "new";
    forceReset = true;
  } else if (continueRequest) {
    mode = "continue";
  } else if (retry) {
    mode = "retry";
  }

  if (!wants) {
    return {
      wantsDocument: false,
      request: message,
      format: "pdf",
      isRetry: retry,
      mode,
      forceReset,
    };
  }

  const format =
    retry && request !== message && !hasExplicitDocumentFormat(message)
      ? detectDocFormat(request)
      : detectDocFormat(message);

  return {
    wantsDocument: true,
    request,
    format,
    isRetry: retry,
    mode,
    forceReset,
  };
}

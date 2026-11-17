import { getChatModel, ollamaChat } from "@/lib/ollama";

import { getImageConfig } from "./config";

/**
 * Intención de imagen.
 *
 * La regla de oro es no convertir una pregunta informativa en una generación.
 * Las reglas cubren los casos claros y, solo cuando queda una duda real, se
 * consulta a Ollama con una clasificación JSON validada. Si el modelo no está
 * disponible, se pide aclaración en vez de gastar GPU.
 */

export type ImageIntentAction = "generate" | "edit" | "variant" | "clarify" | "none";

export type ImageIntentHistoryItem = {
  role: "user" | "ai";
  text?: string;
};

export type ImageIntentContext = {
  history?: ImageIntentHistoryItem[];
  /** Imágenes adjuntas en el mensaje actual. */
  referenceCount?: number;
  /** Existe al menos una imagen generada o seleccionada en el chat. */
  hasGeneratedParent?: boolean;
  /** Imagen generada seleccionada explícitamente por la interfaz. */
  parentImageId?: string;
  /** El botón «Crear imagen» obliga al flujo de imagen. */
  forceImage?: boolean;
};

export type ImageIntentResult = {
  action: ImageIntentAction;
  prompt: string;
  confidence: number;
  reason: string;
  source: "rules" | "ollama" | "forced" | "fallback";
  parentImageId?: string;
  /** La imagen más reciente del chat debe usarse como referencia. */
  useLatestImage?: boolean;
  width?: number;
  height?: number;
  /** El usuario indicó orientación o medidas explícitas. */
  dimensionsExplicit?: boolean;
};

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const IMAGE_NOUN =
  /\b(?:imagen|imagenes|foto|fotos|fotografia|fotografias|ilustracion|ilustraciones|dibujo|dibujos|banner|banners|poster|posters|cartel|carteles|logo|logos|logotipo|logotipos|icono|iconos|avatar|avatares|retrato|retratos|paisaje|paisajes|escena|escenas|personaje|personajes|mascota|mascotas|arte|grafico|graficos|infografia|infografias|portada|portadas|thumbnail|thumbnails|miniatura|miniaturas|flyer|flyers|afiche|afiches|sticker|stickers|calcomania|calcomanias|wallpaper|fondos de pantalla|render|renders|emblem|emblema)\b/;

const DRAW_VERB =
  /\b(?:dibuja|dibujame|dibujar|dibujas|ilustra|ilustrame|ilustrar|pinta|pintame|pintar|pintas|garabatea|garabateame|esboza|esbozame|esbozar|renderiza|renderizame|renderizar)\b/;

const CREATE_VERB =
  /\b(?:crea|creame|crear|creas|genera|generame|generar|generas|haz|hazme|hacer|haces|disena|disename|disenar|disenas|produce|producir|elabora|elaborame|elaborar|prepara|preparame|preparar|arma|armame|armar|compone|componme|componer|monta|montame|montar)\b/;

const POLITE_REQUEST =
  /\b(?:(?:me\s+)?puedes|podrias|me\s+podrias|serias\s+capaz\s+de|te\s+importaria|quieres)\s+(?:me\s+)?(?:crear|crearme|generar|generarme|hacer|hacerme|dibujar|dibujarme|ilustrar|ilustrarme|pintar|pintarme|disenar|disenarme|producir|producirme)\b/;

const WANT_IMAGE =
  /\b(?:quiero|necesito|requiero|ocupo|solicito|busco|me\s+gustaria|me\s+interesa|me\s+vendria\s+bien)\b[^\n]{0,50}\b(?:imagen|imagenes|foto|fotos|ilustracion|ilustraciones|dibujo|dibujos|banner|banners|poster|posters|cartel|carteles|logo|logos|logotipo|logotipos|icono|iconos|avatar|avatares|retrato|retratos|paisaje|paisajes|escena|escenas|personaje|personajes|mascota|mascotas|arte|grafico|graficos|infografia|infografias|portada|portadas|thumbnail|miniaturas|flyer|afiche|sticker|wallpaper|render|emblem|emblema)\b/;

const INFO_QUESTION =
  /\b(?:que\s+es|que\s+significa|que\s+son|como\s+(?:se\s+)?(?:genera|generan|crea|crean|hace|hacen|funciona|funcionan|puedo|puede|puedes|hago|creo|genero)|como\s+funciona|explicame|explica(?:me)?|puedes\s+explicar(?:me)?|me\s+puedes\s+explicar|cuentame|informacion\s+sobre|informacion\s+de|puedes\s+generar\s+imagenes|puedes\s+crear\s+imagenes|sabes\s+generar|sabes\s+crear|eres\s+capaz\s+de\s+(?:generar|crear|hacer|dibujar)\s+imagenes|tienes\s+(?:la\s+)?capacidad|que\s+modelo|con\s+que\s+modelo|cuantos\s+pasos|que\s+es\s+flux|como\s+funciona\s+flux|quiero\s+saber|necesito\s+saber|me\s+gustaria\s+saber|puedes\s+hacer\s+imagenes|solo\s+texto|solo\s+imagenes|o\s+solo\s+texto)\b/;

const INFO_DIMENSIONS =
  /\b(?:cual|cuales|que|cuanto|cuanta|cuantos|cuantas|dimensiones?|tamano|tamano|medidas?|resolucion|aspecto)\b[^\n]{0,80}\b(?:banner|banners|poster|posters|cartel|carteles|logo|logos|imagen|imagenes|foto|fotos|horizontal|vertical|cuadrad[oa])\b/;

const CAPABILITY_ONLY =
  /^(?:si|claro|ok|bueno)?\s*(?:puedes|podrias|sabes|eres\s+capaz\s+de)\s+(?:generar|crear|hacer|dibujar)\s+(?:imagenes|fotos|ilustraciones|dibujos)\s*\??$/;

const NEGATIVE =
  /\b(?:no\s+(?:me\s+)?(?:generes|crees|hagas|dibujes|disenes|pintes|ilustres|produzcas)|no\s+quiero\s+(?:que\s+me\s+)?(?:generes|crees|hagas|dibujes)|no\s+quiero\s+(?:una|ninguna)\s+(?:imagen|foto|ilustracion|dibujo)|sin\s+(?:generar|crear|hacer|dibujar)\s+(?:una\s+)?(?:imagen|foto|ilustracion)|no\s+es\s+una\s+(?:imagen|foto))\b/;

const ANALYSIS_VERB =
  /\b(?:analiz\w*|describ\w*|explic\w*|resum\w*|interpret\w*|identific\w*|reconoc\w*|transcrib\w*|lee|leer|compar\w*|evalu\w*|critic\w*|revis\w*|detect\w*|clasific\w*)\b/;

const ANALYSIS_TARGET =
  /\b(?:imagen|imagenes|foto|fotos|fotografia|fotografias|adjunto|adjunta|adjuntos|adjuntas|captura|pantalla|esto|esta|este|eso|esa|anterior|resultado)\b/;

/** Preguntas visuales que no llevan un verbo de análisis explícito. */
const ANALYSIS_QUESTION =
  /\b(?:que\s+(?:es|son|se\s+ve|hay|muestra|aparece|contiene|significa)|de\s+que\s+(?:color|trata)|quien\s+(?:es|esta)|como\s+(?:es|se\s+ve)|donde\s+(?:esta|es))\b/;

const CHANGE_VERB =
  /\b(?:edita|editame|editar|modifica|modificame|modificar|cambia|cambiale|cambiar|cambiarle|corrige|corregir|mejora|mejorar|arregla|arreglar|ajusta|ajustar|quita|quitar|elimina|eliminar|borra|borrar|agrega|agregar|anade|anadir|pon|ponle|poner|ponerle|hazla|hazlo|hazlas|hazlos|convierte|convertir|transforma|transformar|reemplaza|reemplazar|sustituye|sustituir|recorta|recortar|redimensiona|redimensionar|escala|escalar|amplia|ampliar|extiende|extender|desenfoca|desenfocar|ilumina|iluminar|oscurece|oscurecer|estiliza|estilizar|anima|animar)\b/;

const EDIT_DESCRIPTOR =
  /\b(?:mas\s+(?:grande|pequena|pequeno|ancha|ancho|alta|alto|baja|bajo|clara|claro|oscura|oscuro|colorida|colorido|realista|detallada|detallado|simple|borrosa|borroso|nitida|nitido|vintage|moderna|moderno)|en\s+(?:blanco\s+y\s+negro|color|sepia|estilo\s+\w+)|fondo|estilo|iluminacion|encuadre|zoom|color(?:es)?|texto|sombrero|gafas|sonrisa|pelo|cabello|ropa|vestimenta|paisaje|cielo|agua)\b/;

const DEICTIC_PREVIOUS =
  /\b(?:esta|este|esa|ese|esto|eso|la\s+anterior|el\s+anterior|la\s+ultima|el\s+ultimo|la\s+misma|el\s+mismo|dicha\s+imagen|imagen\s+anterior|resultado\s+anterior|version\s+anterior)\b/;

const VARIANT_EXPLICIT =
  /\b(?:variante|variacion|version\s+alternativa|otra\s+version|nueva\s+version|otra\s+opcion|alternativa|reintenta|reintentar|regenera|regenerar)\b/;

const VARIANT_GENERIC =
  /\b(?:otra|otro|nueva|nuevo|diferente|distinta|alternativa|variante|variacion|version|opcion|de\s+nuevo|otra\s+vez)\b/;

const SHORT_VARIANT =
  /^(?:otra|otro|haz\s+otra|haz\s+otro|genera\s+otra|genera\s+otro|intenta\s+otra\s+vez|otra\s+vez|de\s+nuevo|reintenta|regenera|nueva|nuevo)[\s.!?]*$/;

const DIMENSION_CUE =
  /\b(?:horizontal|apaisad[oa]|panoramic[oa]|vertical|retrato|cuadrad[oa]|16\s*:\s*9|9\s*:\s*16|4\s*:\s*3|3\s*:\s*2|2\s*:\s*1|1\s*:\s*1|banner|poster|cartel|historia|stories)\b/;

const VISUAL_ADJECTIVE =
  /\b(?:visual|creativo|creativa|bonito|bonita|estetico|estetica|llamativo|llamativa|colorido|colorida|minimalista|moderno|moderna|futurista|realista|cinematografico|cinematografica)\b/;

const AMBIGUOUS_CREATE =
  /\b(?:hazme|haz|genera|crea|disena|prepara|necesito|quiero)\s+(?:algo|una\s+cosa|esto|eso)\b|\balgo\s+(?:visual|creativo|bonito|estetico|llamativo)\b/;

function hasImageContext(context: ImageIntentContext): boolean {
  return (
    (context.referenceCount ?? 0) > 0 ||
    context.hasGeneratedParent === true ||
    Boolean(context.parentImageId)
  );
}

function isAnalysis(value: string, context: ImageIntentContext): boolean {
  if (!ANALYSIS_VERB.test(value) && !ANALYSIS_QUESTION.test(value)) return false;
  return ANALYSIS_TARGET.test(value) || hasImageContext(context);
}

function isEditRequest(value: string, context: ImageIntentContext): boolean {
  if (!hasImageContext(context)) return false;
  if (CHANGE_VERB.test(value)) return true;
  if (EDIT_DESCRIPTOR.test(value) && DEICTIC_PREVIOUS.test(value)) return true;
  if (/^(?:que\s+sea|hazla|hazlo|ponle|quita|agrega|anade|cambia|edita|mejora|corrige)\b/.test(value)) {
    return true;
  }
  return false;
}

function isVariantRequest(value: string, context: ImageIntentContext): boolean {
  if (!hasImageContext(context)) return false;
  if (SHORT_VARIANT.test(value)) return true;
  if (VARIANT_EXPLICIT.test(value)) return true;
  if (!VARIANT_GENERIC.test(value)) return false;
  if (DEICTIC_PREVIOUS.test(value)) return true;
  // «otra imagen» sin tema nuevo se refiere al resultado anterior. Si describe
  // un tema («otra imagen de un gato»), es una generación nueva.
  return /^(?:otra|otro|nueva|nuevo|diferente|distinta|alternativa)\s+(?:imagen|foto|ilustracion|version|variante|resultado|opcion)[\s.!?]*$/.test(value);
}

function isClearGenerate(value: string): boolean {
  if (DRAW_VERB.test(value)) return true;
  if (IMAGE_NOUN.test(value) && (CREATE_VERB.test(value) || WANT_IMAGE.test(value) || POLITE_REQUEST.test(value))) {
    return true;
  }
  if (IMAGE_NOUN.test(value) && DIMENSION_CUE.test(value)) return true;
  // «Un logo minimalista para mi empresa», «una imagen de un gato»: una
  // descripción breve sin verbo también es una petición en este contexto.
  if (/^(?:un|una|unos|unas)\s+/.test(value) && IMAGE_NOUN.test(value)) return true;
  return false;
}

function shouldAskModel(value: string, context: ImageIntentContext): boolean {
  if (hasImageContext(context)) return true;
  if (IMAGE_NOUN.test(value) || DRAW_VERB.test(value)) return true;
  if (VISUAL_ADJECTIVE.test(value) && /\b(?:haz|hazme|genera|crea|disena|necesito|quiero)\b/.test(value)) {
    return true;
  }
  return AMBIGUOUS_CREATE.test(value);
}

function emptyClarification(message: string, reason: string, source: ImageIntentResult["source"]): ImageIntentResult {
  return {
    action: "clarify",
    prompt: message,
    confidence: 0.45,
    reason,
    source,
  };
}

export function hasDimensionCue(text: string): boolean {
  const value = normalize(text);
  return (
    DIMENSION_CUE.test(value) ||
    /\b\d{2,4}\s*[x×]\s*\d{2,4}\b/.test(value) ||
    /\b(?:4\s*:\s*3|3\s*:\s*2|2\s*:\s*1|1\s*:\s*1)\b/.test(value)
  );
}

function dimensionFields(
  text: string,
  defaults: { width: number; height: number },
): { width: number; height: number; dimensionsExplicit: boolean } {
  return {
    ...inferImageDimensions(text, defaults),
    dimensionsExplicit: hasDimensionCue(text),
  };
}

export function inferImageDimensions(
  text: string,
  defaults: { width: number; height: number },
): { width: number; height: number } {
  const value = normalize(text);
  const explicit = /\b(\d{2,4})\s*[x×]\s*(\d{2,4})\b/.exec(value);
  if (explicit) {
    const width = Number(explicit[1]);
    const height = Number(explicit[2]);
    if (width >= 16 && height >= 16) return { width, height };
  }

  if (/\b(?:16\s*:\s*9|horizontal|apaisad[oa]|panoramic[oa]|banner)\b/.test(value)) {
    return { width: 1344, height: 768 };
  }
  if (/\b(?:9\s*:\s*16|vertical|historia|stories|poster|cartel)\b/.test(value)) {
    return { width: 768, height: 1344 };
  }
  if (/\b(?:4\s*:\s*3)\b/.test(value)) return { width: 1152, height: 864 };
  if (/\b(?:3\s*:\s*2)\b/.test(value)) return { width: 1248, height: 832 };
  if (/\b(?:2\s*:\s*1)\b/.test(value)) return { width: 1408, height: 704 };
  if (/\b(?:1\s*:\s*1|cuadrad[oa]|icono|avatar|logo|logotipo)\b/.test(value)) {
    return { width: 1024, height: 1024 };
  }
  return defaults;
}

type Classification = {
  action: ImageIntentAction;
  prompt: string;
  confidence: number;
  reason: string;
};

function parseClassification(raw: string): Classification | null {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const action = typeof parsed.action === "string" ? parsed.action : "";
    if (!["generate", "edit", "variant", "clarify", "none"].includes(action)) return null;
    const confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
    return {
      action: action as ImageIntentAction,
      prompt: typeof parsed.prompt === "string" ? parsed.prompt.trim() : "",
      confidence,
      reason: typeof parsed.reason === "string" ? parsed.reason.trim() : "",
    };
  } catch {
    return null;
  }
}

function historyExcerpt(history: ImageIntentHistoryItem[] | undefined): string {
  return (history ?? [])
    .filter((item) => item.text && item.text.trim())
    .slice(-6)
    .map((item) => `${item.role === "user" ? "Usuario" : "Asistente"}: ${item.text!.slice(0, 500)}`)
    .join("\n");
}

async function classifyWithOllama(
  message: string,
  context: ImageIntentContext,
): Promise<Classification | null> {
  const config = getImageConfig();
  if (!config.intentUseOllama) return null;
  const model = config.intentModel || getChatModel();
  if (!model) return null;

  const system = `Eres un clasificador de intención para un chat que puede generar y editar imágenes con FLUX.2 Klein.
Devuelve SOLO JSON válido, sin markdown:
{"action":"generate|edit|variant|clarify|none","prompt":"...","confidence":0.0,"reason":"..."}

Reglas:
- generate: pide crear una imagen nueva (aunque sea indirecto: "necesito un banner horizontal", "dibuja un gato").
- edit: pide modificar una imagen existente o adjunta ("hazla más grande", "cambia el fondo", "ponle un sombrero").
- variant: pide otra versión de una imagen existente ("otra variante", "haz otra").
- clarify: parece relacionado con imágenes pero falta el contenido o el cambio.
- none: pregunta información, pide analizar/describir una imagen, rechaza generar, o no tiene relación con imágenes.

Distingue preguntas:
- "¿Puedes crearme una imagen de un laboratorio?" => generate (petición concreta).
- "¿Puedes generar imágenes?" => none (solo capacidad).
- "¿Cómo se generan las imágenes?" => none (información).
- "Analiza esta imagen" => none (análisis).
- "Haz una imagen con una imagen adjunta" => generate.
Si el mensaje es una negación ("no generes..."), action=none.
El campo prompt debe conservar el pedido concreto del usuario.`;

  const user = `Historial reciente:\n${historyExcerpt(context.history) || "(sin historial)"}\n\nImágenes adjuntas en el mensaje: ${context.referenceCount ?? 0}\nImagen generada disponible en el chat: ${context.hasGeneratedParent ? "sí" : "no"}\n\nMensaje actual:\n${message}`;

  try {
    const raw = await ollamaChat(
      model,
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      {
        temperature: 0,
        num_predict: 180,
        timeoutMs: config.intentTimeoutMs,
        think: false,
      },
    );
    return parseClassification(raw);
  } catch {
    return null;
  }
}

export async function detectImageIntent(
  message: string,
  context: ImageIntentContext = {},
): Promise<ImageIntentResult> {
  const raw = String(message || "").trim();
  const value = normalize(raw);
  const config = getImageConfig();
  const defaults = { width: config.defaultWidth, height: config.defaultHeight };
  const parentImageId = context.parentImageId;
  const useLatest = hasImageContext(context) && !parentImageId;

  if (context.forceImage) {
    // El modo imagen se activa tanto desde el botón «Crear imagen» como desde
    // las acciones «Editar»/«Variante». Con una imagen padre seleccionada hay
    // que respetar esas acciones; si no, una variante se guardaría como una
    // generación nueva con la semilla de la imagen original.
    const forcedAction: ImageIntentAction =
      parentImageId && isVariantRequest(value, context)
        ? "variant"
        : parentImageId && !isClearGenerate(value) && isEditRequest(value, context)
          ? "edit"
          : "generate";
    return {
      action: forcedAction,
      prompt: raw || "Una imagen creativa, original y llamativa",
      confidence: 1,
      reason:
        forcedAction === "generate"
          ? "El usuario activó explícitamente el modo imagen."
          : "El usuario activó el modo imagen desde una acción sobre una imagen existente.",
      source: "forced",
      parentImageId,
      useLatestImage: false,
      ...dimensionFields(raw, defaults),
    };
  }

  if (!value) {
    return {
      action: "none",
      prompt: "",
      confidence: 1,
      reason: "Mensaje vacío.",
      source: "rules",
    };
  }

  if (NEGATIVE.test(value)) {
    return {
      action: "none",
      prompt: raw,
      confidence: 0.98,
      reason: "El usuario rechazó explícitamente generar una imagen.",
      source: "rules",
    };
  }

  if (INFO_QUESTION.test(value) || CAPABILITY_ONLY.test(value)) {
    return {
      action: "none",
      prompt: raw,
      confidence: 0.96,
      reason: "Es una pregunta informativa o de capacidad, no una petición de imagen.",
      source: "rules",
    };
  }

  if (raw.endsWith("?") && INFO_DIMENSIONS.test(value)) {
    return {
      action: "none",
      prompt: raw,
      confidence: 0.93,
      reason: "Pregunta por medidas o formato, no pide generar la imagen.",
      source: "rules",
    };
  }

  if (isAnalysis(value, context)) {
    return {
      action: "none",
      prompt: raw,
      confidence: 0.94,
      reason: "Pide analizar o describir una imagen, no modificarla.",
      source: "rules",
    };
  }

  if (isVariantRequest(value, context)) {
    return {
      action: "variant",
      prompt: raw,
      confidence: 0.9,
      reason: "Pide otra versión del resultado anterior.",
      source: "rules",
      parentImageId,
      useLatestImage: useLatest,
      ...dimensionFields(raw, defaults),
    };
  }

  // Explicit creation wins over descriptor-based editing: "haz una imagen con
  // este estilo" uses the prior image as reference, it does not modify it.
  if (!isClearGenerate(value) && isEditRequest(value, context)) {
    return {
      action: "edit",
      prompt: raw,
      confidence: 0.9,
      reason: "Pide modificar una imagen existente o adjunta.",
      source: "rules",
      parentImageId,
      useLatestImage: useLatest,
      ...dimensionFields(raw, defaults),
    };
  }

  if (isClearGenerate(value)) {
    return {
      action: "generate",
      prompt: raw,
      confidence: 0.92,
      reason: "Petición clara de creación de imagen.",
      source: "rules",
      parentImageId,
      useLatestImage: Boolean(parentImageId) || (hasImageContext(context) && DEICTIC_PREVIOUS.test(value)),
      ...dimensionFields(raw, defaults),
    };
  }

  if (shouldAskModel(value, context)) {
    const classification = await classifyWithOllama(raw, context);
    if (
      classification &&
      classification.confidence >= config.intentMinConfidence &&
      classification.action !== "clarify"
    ) {
      if (classification.action === "none") {
        return {
          action: "none",
          prompt: raw,
          confidence: classification.confidence,
          reason: classification.reason || "El clasificador no detectó una petición de imagen.",
          source: "ollama",
        };
      }
      if ((classification.action === "edit" || classification.action === "variant") && !hasImageContext(context)) {
        return emptyClarification(
          raw,
          "Para editar o crear una variante necesito una imagen adjunta o una imagen anterior.",
          "ollama",
        );
      }
      return {
        action: classification.action,
        prompt: classification.prompt || raw,
        confidence: classification.confidence,
        reason: classification.reason || "Clasificación contextual de Ollama.",
        source: "ollama",
        parentImageId,
        useLatestImage:
          classification.action === "edit" || classification.action === "variant"
            ? useLatest
            : Boolean(parentImageId) || (hasImageContext(context) && DEICTIC_PREVIOUS.test(value)),
        ...dimensionFields(raw, defaults),
      };
    }
    return emptyClarification(
      raw,
      "Parece una petición visual, pero necesito saber qué imagen quieres o qué cambio deseas.",
      "fallback",
    );
  }

  return {
    action: "none",
    prompt: raw,
    confidence: 0.85,
    reason: "No se detectó una petición de imagen.",
    source: "rules",
  };
}

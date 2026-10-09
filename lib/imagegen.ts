import { ollamaChat } from "./ollama";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const IMAGE_MODEL = process.env.IMAGE_MODEL || "";
const IMAGE_WIDTH = parseInt(process.env.IMAGE_WIDTH || "768", 10);
const IMAGE_HEIGHT = parseInt(process.env.IMAGE_HEIGHT || "768", 10);
const IMAGE_STEPS = parseInt(process.env.IMAGE_STEPS || "8", 10);
const IMAGE_KEEP_ALIVE = process.env.IMAGE_KEEP_ALIVE || "0";
const VL_MODEL = process.env.VL_MODEL || "";
const IMAGE_PROMPT_MAX_CHARS = parseInt(
  process.env.IMAGE_PROMPT_MAX_CHARS || "700",
  10
);

type ImageGenResponse = {
  model: string;
  created_at: string;
  response?: string;
  image?: string;
  images?: string[];
  step?: number;
  total?: number;
  done: boolean;
  error?: string;
};

const STOPWORDS = new Set([
  "imagen", "imágen", "imagenes", "foto", "fotos", "dibujo", "dibujos", "arte",
  "poster", "póster", "banner", "logo", "infografía", "infografia",
  "una", "un", "unos", "unas", "de", "del", "para", "con", "que", "como",
  "muy", "bien", "por", "favor", "sobre", "quiero", "necesito", "regalame",
  "haz", "haga", "genera", "crea", "dibuja", "pinta", "imagina", "hazme",
  "haceme", "creame", "generame", "dibujame", "muestrame", "muéstrame",
  "muestreme", "dame", "se", "vea",
]);

function extractSubject(prompt: string): string[] {
  const words = prompt.toLowerCase().match(/[a-záéíóúüñ0-9]+/gi) || [];
  return words.filter((w) => w.length >= 4 && !STOPWORDS.has(w)).slice(0, 5);
}

function composeDetailedPrompt(
  prompt: string,
  context?: string,
  references?: string
): string {
  return `IMAGEN A CREAR (pedido original del usuario):
${prompt}

${context ? `CONTEXTO DE LA CONVERSACIÓN (historial reciente):
${context}

` : ""}${references ? `EJEMPLOS Y REFERENCIAS DE LA WEB (úsalos solo como inspiración de estilo, composición y temática; NO los copies directamente):
${references}

` : ""}Crea una imagen ORIGINAL y coherente con el pedido del usuario, aprovechando el contexto y las referencias. Exprésalo como un prompt de imagen detallado: escena, sujetos, estilo, composición, iluminación, colores y ambiente.`;
}

export async function buildDetailedImagePrompt(
  prompt: string,
  context?: string,
  references?: string
): Promise<string> {
  const composed = composeDetailedPrompt(prompt, context, references);
  const subject = extractSubject(prompt);

  let refined = "";
  const textModel = process.env.TEXT_MODEL;
  if (textModel) {
    try {
      refined = (
        await ollamaChat(
          textModel,
          [
            {
              role: "system",
              content:
                "Eres un experto en redacción de prompts para generación de imágenes con IA. Reescribe el pedido del usuario como un prompt de imagen detallado en español: sujetos, escena, estilo, composición, iluminación, colores y ambiente. Aprovecha el contexto y las referencias para enriquecerlo. IMPORTANTE: mantén SIEMPRE el sujeto central del pedido original (el nombre de un juego, personaje, lugar, animal o cosa) tal cual aparece en el pedido. Devuelve ÚNICAMENTE el prompt final, sin texto adicional, sin markdown.",
            },
            {
              role: "user",
              content: `PROMPT ORIGINAL DEL USUARIO:\n${prompt}

${references ? `EJEMPLOS Y REFERENCIAS DE LA WEB:\n${references}\n\n` : ""}${context ? `CONTEXTO DE LA CONVERSACIÓN:\n${context}` : ""}`,
            },
          ],
          { num_predict: 900 }
        )
      ).trim();
    } catch (e) {
      console.log(`🖼️ Refinamiento de prompt no disponible: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const candidate = refined.length >= 10 ? refined : composed;

  // Garantizar que el sujeto central del pedido esté presente en el prompt final,
  // para no perder el tema exacto (p. ej. "Hollow Knight") durante el refinado.
  if (subject.length > 0) {
    const lower = candidate.toLowerCase();
    const missing = subject.filter((w) => !lower.includes(w));
    if (missing.length === subject.length) {
      return `${prompt.trim()} — ${candidate}`.slice(0, 4000);
    }
  }

  return candidate.slice(0, 4000);
}

export type VisualReference = { mime: string; data: string };

/**
 * Usa un modelo de visión (VL) con la imagen de referencia de la web como
 * contexto visual para escribir un prompt CORTO y detallado (mucho menor que
 * el generado solo por texto con referencias).
 */
export async function describeImageWithVL(
  image: VisualReference,
  prompt: string,
  context?: string
): Promise<string> {
  if (!VL_MODEL) return "";

  try {
    const content = (
      await ollamaChat(
        VL_MODEL,
        [
          {
            role: "system",
            content:
              "Eres un experto en redacción de prompts para generación de imágenes. Observa la imagen de referencia (contexto visual) y usa el pedido del usuario para escribir un prompt corto y detallado en español: sujeto/escena, estilo visual, composición, iluminación, colores y ambiente. MANTÉN SIEMPRE el sujeto central del pedido original tal cual aparece (nombre de un juego, personaje, lugar, animal o cosa). Devuelve ÚNICAMENTE el prompt final, sin texto adicional ni markdown, en un solo párrafo breve.",
          },
          {
            role: "user",
            content: `PEDIDO DEL USUARIO:\n${prompt}\n\n${
              context ? `CONTEXTO DE LA CONVERSACIÓN:\n${context}\n\n` : ""
            }Usa la imagen adjunta como referencia visual de estilo y temática, y crea un prompt corto.`,
            images: [image.data],
          },
        ],
        { num_predict: 300 }
      )
    ).trim();

    return content.slice(0, IMAGE_PROMPT_MAX_CHARS);
  } catch (e) {
    console.log(
      `🖼️ Descripción visual no disponible: ${e instanceof Error ? e.message : String(e)}`
    );
    return "";
  }
}

export async function ollamaGenerateImage(
  prompt: string,
  options?: {
    width?: number;
    height?: number;
    steps?: number;
    seed?: number;
  }
): Promise<string> {
  if (!IMAGE_MODEL) {
    throw new Error(
      "No hay modelo de imágenes configurado para Ollama (define IMAGE_MODEL). La generación de imágenes es por ComfyUI/COMFY_URL."
    );
  }

  const width = options?.width ?? IMAGE_WIDTH;
  const height = options?.height ?? IMAGE_HEIGHT;
  const steps = options?.steps ?? IMAGE_STEPS;
  const seed = options?.seed ?? Math.floor(Math.random() * 2 ** 31);

  let res: Response;
  const startedAt = Date.now();
  try {
    res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt,
        stream: false,
        width,
        height,
        steps,
        seed,
        keep_alive: IMAGE_KEEP_ALIVE,
      }),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || /abort/i.test(msg));
    throw new Error(
      timedOut
        ? `Ollama tardó más de 5 min en responder (${OLLAMA_URL}, modelo ${IMAGE_MODEL}). El servidor puede estar sobrecargado o sin memoria.`
        : `No se pudo conectar con Ollama en ${OLLAMA_URL} (modelo ${IMAGE_MODEL}): ${msg}`
    );
  }
  console.log(`🖼️ Ollama respondió en ${Date.now() - startedAt}ms (estado ${res.status})`);

  let raw: string;
  try {
    raw = await res.text();
  } catch (e) {
    throw new Error(
      `Conexión perdida al recibir la imagen (${OLLAMA_URL}, modelo ${IMAGE_MODEL}): ${e instanceof Error ? e.message : String(e)}`
    );
  }

  if (!res.ok) {
    let serverError = "";
    try {
      const parsed = JSON.parse(raw);
      serverError = typeof parsed.error === "string" ? parsed.error : "";
    } catch {
      serverError = raw.slice(0, 300);
    }
    throw new Error(
      `Ollama respondió con código ${res.status}${
        IMAGE_MODEL ? ` (modelo: ${IMAGE_MODEL})` : ""
      }${serverError ? ` — ${serverError}` : ""}`
    );
  }

  const contentType = res.headers.get("Content-Type") || "";

  // Respuesta NDJSON (stream aunque pidamos stream:false en algunos servidores)
  if (contentType.includes("ndjson")) {
    const lines = raw.trim().split("\n").filter(Boolean);
    let lastImage = "";
    for (const line of lines) {
      try {
        const json: ImageGenResponse = JSON.parse(line);
        if (json.error) throw new Error(json.error);
        const candidate =
          (json.image as string | undefined) ||
          (Array.isArray(json.images) ? json.images[0] : undefined);
        if (candidate) lastImage = candidate;
        if (json.done) break;
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
    if (!lastImage) throw new Error("Ollama no devolvió ninguna imagen");
    return `data:image/png;base64,${lastImage}`;
  }

  // Respuesta JSON simple
  try {
    const json: ImageGenResponse = JSON.parse(raw);
    if (json.error) throw new Error(json.error);
    const result =
      (json.image as string | undefined) ||
      (Array.isArray(json.images) ? json.images[0] : undefined);
    if (!result) throw new Error("Ollama no devolvió ninguna imagen");
    return `data:image/png;base64,${result}`;
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error("Respuesta no reconocida del servidor de generación de imágenes");
    }
    throw e;
  }
}
import { getChatModel, ollamaChat } from "@/lib/ollama";

import { getImageConfig } from "./config";
import type { ImageJobKind } from "@/types";

export type RefineImagePromptInput = {
  prompt: string;
  kind: ImageJobKind;
  history?: Array<{ role: "user" | "ai"; text?: string }>;
  /** Extracto ya persistido en el job; útil para el worker. */
  context?: string | null;
  hasReferences?: boolean;
  maxChars?: number;
};

function historyExcerpt(history: RefineImagePromptInput["history"]): string {
  return (history ?? [])
    .filter((item) => item.text && item.text.trim())
    .slice(-5)
    .map((item) => `${item.role === "user" ? "Usuario" : "Asistente"}: ${item.text!.slice(0, 400)}`)
    .join("\n");
}

function fallbackPrompt(input: RefineImagePromptInput): string {
  const base = input.prompt.trim();
  if (input.kind === "edit") {
    return `Edita la imagen de referencia. ${base}. Conserva la identidad, la composición y todos los elementos que el usuario no pidió cambiar.`;
  }
  if (input.kind === "variant") {
    return `Crea una variación de la imagen de referencia. ${base}. Mantén el tema y la identidad, pero cambia la composición, la iluminación y los detalles para que sea claramente una versión nueva.`;
  }
  if (input.hasReferences) {
    return `${base}. Usa las imágenes de referencia como inspiración de estilo, color y composición, sin copiarlas literalmente.`;
  }
  return `${base}. Composición cuidada, iluminación coherente, alto nivel de detalle y acabado profesional.`;
}

function cleanPrompt(value: string, maxChars: number): string {
  return value
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .replace(/^(?:prompt|imagen|resultado)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

export async function refineImagePrompt(input: RefineImagePromptInput): Promise<string> {
  const config = getImageConfig();
  const maxChars = input.maxChars ?? config.promptMaxChars;
  const original = input.prompt.trim();
  if (!original && input.kind !== "generate") return fallbackPrompt(input);

  if (!config.refinePrompt) return cleanPrompt(fallbackPrompt(input), maxChars);

  const model = config.promptModel || getChatModel();
  if (!model) return cleanPrompt(fallbackPrompt(input), maxChars);

  const mode =
    input.kind === "edit"
      ? "edición de una imagen existente"
      : input.kind === "variant"
        ? "variación de una imagen existente"
        : "creación desde cero";

  const system = `Eres un director de arte que escribe prompts para FLUX.2 Klein.
Convierte el pedido del usuario en un prompt visual preciso, en español, de un solo párrafo.
Incluye sujeto, acción, escena, composición, iluminación, color, estilo y nivel de detalle cuando aporten.
No inventes marcas, personajes ni textos que el usuario no haya pedido. No agregues texto a la imagen salvo que se solicite.
En ${mode}, respeta la intención exacta del usuario y no cambies el tema central.
Devuelve ÚNICAMENTE el prompt final, sin markdown, sin comillas y sin explicaciones.`;

  const context = input.context?.trim() || historyExcerpt(input.history);
  const user = `PEDIDO DEL USUARIO:
${original}

${context ? `CONTEXTO RECIENTE DEL CHAT:\n${context}\n\n` : ""}${input.hasReferences ? "Hay imágenes de referencia adjuntas.\n" : ""}Modo: ${mode}.`;

  try {
    const refined = await ollamaChat(
      model,
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      {
        temperature: 0.35,
        num_predict: Math.min(900, Math.max(250, maxChars)),
        timeoutMs: config.promptTimeoutMs,
        think: false,
      },
    );
    const cleaned = cleanPrompt(refined, maxChars);
    return cleaned.length >= 12 ? cleaned : cleanPrompt(fallbackPrompt(input), maxChars);
  } catch {
    return cleanPrompt(fallbackPrompt(input), maxChars);
  }
}

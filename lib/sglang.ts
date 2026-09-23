/**
 * Cliente único de inferencia: SGLang (protocolo OpenAI-compatible).
 *
 * Reemplaza a lib/ollama.ts (protocolo Ollama /api/chat + NDJSON).
 * La app habla SOLO con estos endpoints:
 *   - Chat fast      → SGLANG_URL            (puerto 8005, qwen3.6-35b-a3b)
 *   - Hearts deep    → SGLANG_HEARTS_URL     (puerto 8006, qwen3.8-27b)
 *   - Embeddings RAG → SGLANG_EMBEDDINGS_URL (puerto 8007, bge-m3)
 *
 * El enrutamiento por modelo es automático (baseUrlForModel): el caller
 * pasa el nombre del modelo y este módulo elige el engine correcto.
 * Si una variable *_URL trae sufijo "/v1", se normaliza (no se duplica).
 */

import { env } from "@/lib/env";

export type SGLangMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
};

/** Opciones estilo OpenAI. Se acepta `num_predict` (legado Ollama) como alias de `max_tokens`. */
export type ChatOptions = {
  temperature?: number;
  max_tokens?: number;
  num_predict?: number;
  [key: string]: unknown;
};

type OpenAIChatResponse = {
  choices?: Array<{ message?: { role?: string; content?: string | null } }>;
};

type OpenAIChunk = {
  choices?: Array<{ delta?: { role?: string; content?: string | null }; finish_reason?: string | null }>;
};

type OpenAIEmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
};

/** Quita barras finales y un eventual sufijo "/v1" para no duplicar el path. */
function normalizeBase(raw: string): string {
  return raw.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function chatBaseUrl(): string {
  return normalizeBase(env.SGLANG_URL);
}

function heartsBaseUrl(): string {
  if (env.SGLANG_HEARTS_URL) return normalizeBase(env.SGLANG_HEARTS_URL);
  return chatBaseUrl();
}

function embeddingsBaseUrl(): string {
  if (env.SGLANG_EMBEDDINGS_URL) return normalizeBase(env.SGLANG_EMBEDDINGS_URL);
  return chatBaseUrl();
}

/**
 * Elige el engine según el modelo: si el modelo pedido es el de hearts
 * (HEARTS_MODEL) y hay URL dedicada, usa el engine de hearts; si no, el de chat.
 */
function baseUrlForModel(model: string): string {
  const heartsModel = env.HEARTS_MODEL || "";
  if (heartsModel && model === heartsModel) return heartsBaseUrl();
  return chatBaseUrl();
}

function heartsModel(): string {
  return env.HEARTS_MODEL || env.TEXT_MODEL;
}

function embeddingModel(): string {
  return env.EMBEDDING_MODEL || "bge-m3";
}

/** Convierte mensajes internos a formato OpenAI (vision → content parts). */
function toOpenAIMessages(messages: SGLangMessage[]): unknown[] {
  return messages.map((m) => {
    if (!m.images || m.images.length === 0) {
      return { role: m.role, content: m.content };
    }
    return {
      role: m.role,
      content: [
        { type: "text", text: m.content },
        ...m.images.map((img) => ({
          type: "image_url",
          image_url: {
            url: img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}`,
          },
        })),
      ],
    };
  });
}

/** Traduce opciones a parámetros OpenAI (`num_predict` → `max_tokens`). */
function toOpenAIOptions(options?: ChatOptions): Record<string, unknown> {
  if (!options) return {};
  const { num_predict, max_tokens, temperature, ...rest } = options;
  const out: Record<string, unknown> = { ...rest };
  if (max_tokens !== undefined) out.max_tokens = max_tokens;
  else if (num_predict !== undefined) out.max_tokens = num_predict;
  if (temperature !== undefined) out.temperature = temperature;
  return out;
}

export async function sglangChat(
  model: string,
  messages: SGLangMessage[],
  options?: ChatOptions
): Promise<string> {
  const res = await fetch(`${baseUrlForModel(model)}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: toOpenAIMessages(messages),
      stream: false,
      ...toOpenAIOptions(options),
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `SGLang respondió con código ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`
    );
  }

  const json: OpenAIChatResponse = await res.json();
  return (json.choices?.[0]?.message?.content || "").trim();
}

export async function* sglangChatStream(
  model: string,
  messages: SGLangMessage[]
): AsyncGenerator<string> {
  const totalChars = messages.reduce((s, m) => s + m.content.length, 0);
  console.log(`📡 SGLang fetch: ${totalChars} chars, timeout 60s`);
  const res = await fetch(`${baseUrlForModel(model)}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: toOpenAIMessages(messages),
      stream: true,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    yield `Error: SGLang respondió con código ${res.status}.`;
    return;
  }

  if (!res.body) {
    yield "Error: no se pudo conectar con SGLang.";
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let chunkCount = 0;
  let charCount = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      console.log(`📡 SGLang stream done: ${chunkCount} chunks, ${charCount} chars`);
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") {
        console.log(`📡 SGLang [DONE]: ${chunkCount} chunks, ${charCount} chars`);
        return;
      }
      chunkCount++;
      try {
        const json: OpenAIChunk = JSON.parse(payload);
        const content = json.choices?.[0]?.delta?.content;
        if (content) {
          charCount += content.length;
          yield content;
        }
        if (json.choices?.[0]?.finish_reason) {
          console.log(`📡 SGLang finish=${json.choices[0].finish_reason}: ${chunkCount} chunks, ${charCount} chars`);
          return;
        }
      } catch {
        console.log(`📡 SGLang JSON inválido: ${payload.slice(0, 100)}`);
      }
    }
  }
}

/** Genera un embedding con el engine de embeddings (bge-m3). Devuelve [] si falla. */
export async function sglangEmbedding(text: string): Promise<number[]> {
  try {
    const res = await fetch(`${embeddingsBaseUrl()}/v1/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: embeddingModel(), input: text }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.log(`🧠 Embedding error: ${res.status}`);
      return [];
    }

    const data: OpenAIEmbeddingResponse = await res.json();
    return data.data?.[0]?.embedding || [];
  } catch (e) {
    console.log(`🧠 Embedding error: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

/** Modelo configurado para hearts / deep-think (edición de documentos). */
export function getHeartsModel(): string {
  return heartsModel();
}

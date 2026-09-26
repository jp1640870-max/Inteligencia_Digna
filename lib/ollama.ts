import { env } from "@/lib/env";

export type InferenceMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
};

export type ChatOptions = {
  temperature?: number;
  max_tokens?: number;
  num_predict?: number;
  num_ctx?: number;
  keep_alive?: string | number;
  think?: boolean;
  [key: string]: unknown;
};

type OllamaChatResponse = {
  message?: { content?: string | null };
  error?: string;
};

type OllamaEmbeddingResponse = {
  embeddings?: number[][];
  error?: string;
};

type OllamaTagResponse = {
  models?: Array<{ name?: string; model?: string }>;
};

function normalizeBase(value: string): string {
  return value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1$/, "")
    .replace(/\/api\/(chat|embed)$/, "");
}

function baseUrl(): string {
  if (!env.OLLAMA_URL) throw new Error("Falta OLLAMA_URL");
  return normalizeBase(env.OLLAMA_URL);
}

function configuredModel(primary: string | undefined, fallback: string): string {
  return primary || fallback;
}

export function getChatModel(): string {
  return configuredModel(env.OLLAMA_CHAT_MODEL || env.TEXT_MODEL, "inteligencia-digna:qwen3.8-chat");
}

export function getAgentModel(): string {
  return configuredModel(env.OLLAMA_AGENT_MODEL || env.HEARTS_MODEL, getChatModel());
}

export function getEmbeddingModel(): string {
  return configuredModel(env.OLLAMA_EMBEDDING_MODEL || env.EMBEDDING_MODEL, "inteligencia-digna:bge-m3-rag");
}

function numberSetting(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function chatOptions(model: string, options?: ChatOptions): {
  bodyOptions: Record<string, unknown>;
  keepAlive?: string | number;
} {
  const input = options || {};
  const { max_tokens, num_predict, num_ctx, temperature, keep_alive, ...rest } = input;
  const bodyOptions: Record<string, unknown> = { ...rest };
  const defaultContext = model === getAgentModel()
    ? numberSetting(env.OLLAMA_AGENT_CONTEXT_LENGTH, 49152)
    : numberSetting(env.OLLAMA_CHAT_CONTEXT_LENGTH || env.OLLAMA_CONTEXT_LENGTH, 32768);
  const defaultPredict = numberSetting(env.OLLAMA_NUM_PREDICT, 4096);
  bodyOptions.num_ctx = num_ctx ?? defaultContext;
  bodyOptions.num_predict = max_tokens ?? num_predict ?? defaultPredict;
  if (temperature !== undefined) bodyOptions.temperature = temperature;
  else if (env.OLLAMA_TEMPERATURE) bodyOptions.temperature = numberSetting(env.OLLAMA_TEMPERATURE, 0.3);

  return {
    bodyOptions,
    keepAlive: keep_alive ?? (model === getAgentModel() ? env.OLLAMA_AGENT_KEEP_ALIVE : env.OLLAMA_CHAT_KEEP_ALIVE),
  };
}

function toOllamaMessages(messages: InferenceMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    const normalized: Record<string, unknown> = {
      role: message.role,
      content: message.content,
    };
    if (message.images && message.images.length > 0) {
      normalized.images = message.images.map((image) => image.replace(/^data:[^;]+;base64,/, ""));
    }
    return normalized;
  });
}

function timeoutSignal(timeoutMs: number, requestSignal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return requestSignal ? AbortSignal.any([timeout, requestSignal]) : timeout;
}

async function responseError(response: Response): Promise<Error> {
  const detail = await response.text().catch(() => "");
  return new Error(`Ollama respondió con código ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
}

export async function ollamaChat(
  model: string,
  messages: InferenceMessage[],
  options?: ChatOptions & { signal?: AbortSignal },
): Promise<string> {
  const settings = options ? { ...options } : {};
  const requestSignal = settings.signal;
  delete settings.signal;
  const configured = chatOptions(model, settings);
  const response = await fetch(`${baseUrl()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: toOllamaMessages(messages),
      stream: false,
      options: configured.bodyOptions,
      ...(configured.keepAlive !== undefined ? { keep_alive: configured.keepAlive } : {}),
      think: options?.think ?? false,
    }),
    signal: timeoutSignal(numberSetting(env.OLLAMA_TIMEOUT_MS, 120000), requestSignal),
  });

  if (!response.ok) throw await responseError(response);
  const payload = (await response.json()) as OllamaChatResponse;
  if (payload.error) throw new Error(`Ollama: ${payload.error}`);
  return (payload.message?.content || "").trim();
}

export async function* ollamaChatStream(
  model: string,
  messages: InferenceMessage[],
  options?: ChatOptions & { signal?: AbortSignal },
): AsyncGenerator<string> {
  const settings = options ? { ...options } : {};
  const requestSignal = settings.signal;
  delete settings.signal;
  const configured = chatOptions(model, settings);
  const response = await fetch(`${baseUrl()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: toOllamaMessages(messages),
      stream: true,
      options: configured.bodyOptions,
      ...(configured.keepAlive !== undefined ? { keep_alive: configured.keepAlive } : {}),
      think: options?.think ?? false,
    }),
    signal: timeoutSignal(numberSetting(env.OLLAMA_TIMEOUT_MS, 120000), requestSignal),
  });

  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new Error("Ollama no devolvió un cuerpo de streaming");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const processLine = (line: string): { content?: string; done: boolean } => {
    const value = line.trim();
    if (!value) return { done: false };
    let event: OllamaChatResponse & { done?: boolean };
    try {
      event = JSON.parse(value) as OllamaChatResponse & { done?: boolean };
    } catch {
      throw new Error("Ollama devolvió un NDJSON inválido");
    }
    if (event.error) throw new Error(`Ollama: ${event.error}`);
    return { content: event.message?.content || undefined, done: event.done === true };
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffer.trim()) {
        const event = processLine(buffer);
        if (event.content) yield event.content;
      }
      return;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const event = processLine(line);
      if (event.content) yield event.content;
      if (event.done) return;
    }
  }
}

export async function ollamaEmbedding(
  text: string,
  options?: { signal?: AbortSignal; keep_alive?: string | number },
): Promise<number[]> {
  const vectors = await ollamaEmbeddings([text], options);
  return vectors[0] || [];
}

export async function ollamaEmbeddings(
  texts: string[],
  options?: { signal?: AbortSignal; keep_alive?: string | number },
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const response = await fetch(`${baseUrl()}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: getEmbeddingModel(),
      input: texts,
      truncate: true,
      keep_alive: options?.keep_alive ?? env.OLLAMA_EMBEDDING_KEEP_ALIVE ?? "0",
    }),
    signal: timeoutSignal(numberSetting(env.OLLAMA_EMBEDDING_TIMEOUT_MS, 30000), options?.signal),
  });

  if (!response.ok) throw await responseError(response);
  const payload = (await response.json()) as OllamaEmbeddingResponse;
  if (payload.error) throw new Error(`Ollama embeddings: ${payload.error}`);
  const vectors = payload.embeddings || [];
  if (vectors.length !== texts.length) throw new Error("Ollama devolvió una cantidad inesperada de embeddings");
  return vectors;
}

export async function listOllamaModels(options?: { signal?: AbortSignal }): Promise<string[]> {
  const response = await fetch(`${baseUrl()}/api/tags`, {
    signal: timeoutSignal(5000, options?.signal),
  });
  if (!response.ok) throw await responseError(response);
  const payload = (await response.json()) as OllamaTagResponse;
  return (payload.models || []).map((model) => model.name || model.model || "").filter(Boolean);
}

export function getOllamaBaseUrl(): string {
  return baseUrl();
}

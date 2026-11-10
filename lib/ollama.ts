import { env } from "@/lib/env";

export type InferenceMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
};

export type ChatDoneInfo = {
  /** Motivo reportado por Ollama: "stop", "length", etc. */
  doneReason?: string;
};

export class OllamaTimeoutError extends Error {
  readonly kind: "idle" | "total";

  constructor(message: string, kind: "idle" | "total") {
    super(message);
    this.name = "TimeoutError";
    this.kind = kind;
  }
}

export type ChatOptions = {
  temperature?: number;
  max_tokens?: number;
  num_predict?: number;
  num_ctx?: number;
  keep_alive?: string | number;
  think?: boolean;
  /** Timeout total para llamadas no-streaming (ms). No se envía a Ollama. */
  timeoutMs?: number;
  /** Timeout de inactividad para streaming: se reinicia con cada token (ms). No se envía a Ollama. */
  idleTimeoutMs?: number;
  /** Se llama una sola vez al terminar el stream. No se envía a Ollama. */
  onDone?: (info: ChatDoneInfo) => void;
  [key: string]: unknown;
};

type OllamaChatResponse = {
  message?: { content?: string | null };
  done?: boolean;
  done_reason?: string;
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

/**
 * Ollama acepta `keep_alive` como número (segundos) o como string con unidad
 * ("5m"). Un valor type env siempre llega como string, así que "-1" (mantener
 * el modelo siempre en memoria) se envía como string y Ollama responde
 * `time: missing unit in duration "-1"`. Si el string es numérico puro, se
 * convierte a número; si trae unidad, se deja como string.
 */
function normalizeKeepAlive(value: string | number | undefined): string | number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || value.trim() === "") return value;
  const trimmed = value.trim();
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : trimmed;
}

function chatOptions(model: string, options?: ChatOptions): {
  bodyOptions: Record<string, unknown>;
  keepAlive?: string | number;
} {
  const input = options || {};
  const {
    max_tokens,
    num_predict,
    num_ctx,
    temperature,
    keep_alive,
    timeoutMs,
    idleTimeoutMs,
    think,
    ...rest
  } = input;
  delete rest.onDone;
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
    keepAlive: normalizeKeepAlive(
      keep_alive ?? (model === getAgentModel() ? env.OLLAMA_AGENT_KEEP_ALIVE : env.OLLAMA_CHAT_KEEP_ALIVE),
    ),
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

/**
 * Crea un AbortController que se aborta por inactividad (se reinicia con cada
 * token recibido) y, opcionalmente, por tiempo total.
 *
 * Devuelve una señal que se puede pasar a `fetch` y un par de funciones para
 * reiniciar/detener el temporizador de inactividad alrededor de cada lectura
 * del stream.
 */
function createStreamGuard(params: {
  idleMs: number;
  totalMs?: number;
  signal?: AbortSignal;
}): {
  signal: AbortSignal;
  startIdle: () => void;
  stopIdle: () => void;
  dispose: () => void;
} {
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let totalTimer: ReturnType<typeof setTimeout> | undefined;

  const abort = (kind: "idle" | "total") => {
    const message =
      kind === "idle"
        ? `Ollama no envió datos durante ${params.idleMs} ms`
        : `Ollama excedió el tiempo total de ${params.totalMs} ms`;
    controller.abort(new OllamaTimeoutError(message, kind));
  };

  const startIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => abort("idle"), params.idleMs);
  };

  const stopIdle = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  };

  const onRequestAbort = () => controller.abort(params.signal?.reason);
  if (params.signal?.aborted) onRequestAbort();
  else params.signal?.addEventListener("abort", onRequestAbort, { once: true });

  if (params.totalMs && params.totalMs > 0) {
    totalTimer = setTimeout(() => abort("total"), params.totalMs);
  }

  return {
    signal: controller.signal,
    startIdle,
    stopIdle,
    dispose: () => {
      stopIdle();
      if (totalTimer) {
        clearTimeout(totalTimer);
        totalTimer = undefined;
      }
      params.signal?.removeEventListener("abort", onRequestAbort);
    },
  };
}

/**
 * Lee un chunk del stream respetando la señal de abort. Si la señal se aborta
 * mientras se espera `reader.read()`, se cancela el lector y se lanza el
 * motivo de la señal (por ejemplo `OllamaTimeoutError`).
 */
async function readWithGuard(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<{ done: boolean; value?: Uint8Array }> {
  if (signal.aborted) throw signal.reason;

  const onAbort = () => {
    reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    return await reader.read();
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
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

  const idleMs =
    options?.idleTimeoutMs ??
    numberSetting(env.OLLAMA_STREAM_IDLE_TIMEOUT_MS, numberSetting(env.OLLAMA_TIMEOUT_MS, 120_000));
  const totalMs = options?.timeoutMs;

  const guard = createStreamGuard({ idleMs, totalMs, signal: requestSignal });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  try {
    guard.startIdle();
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
      signal: guard.signal,
    });

    guard.stopIdle();

    if (!response.ok) throw await responseError(response);
    if (!response.body) throw new Error("Ollama no devolvió un cuerpo de streaming");

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let notified = false;

    const notifyDone = (doneReason?: string) => {
      if (notified) return;
      notified = true;
      options?.onDone?.({ doneReason });
    };

    const processLine = (line: string): { content?: string; done: boolean; doneReason?: string } => {
      const value = line.trim();
      if (!value) return { done: false };
      let event: OllamaChatResponse;
      try {
        event = JSON.parse(value) as OllamaChatResponse;
      } catch {
        throw new Error("Ollama devolvió un NDJSON inválido");
      }
      if (event.error) throw new Error(`Ollama: ${event.error}`);
      return {
        content: event.message?.content || undefined,
        done: event.done === true,
        doneReason: event.done_reason,
      };
    };

    while (true) {
      if (guard.signal.aborted) throw guard.signal.reason;
      guard.startIdle();
      const { done, value } = await readWithGuard(reader!, guard.signal);
      guard.stopIdle();
      if (guard.signal.aborted) throw guard.signal.reason;
      if (done) {
        if (buffer.trim()) {
          const event = processLine(buffer);
          if (event.content) yield event.content;
          if (event.done) {
            notifyDone(event.doneReason);
            return;
          }
        }
        notifyDone();
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const event = processLine(line);
        if (event.content) yield event.content;
        if (event.done) {
          notifyDone(event.doneReason);
          return;
        }
      }
    }
  } finally {
    guard.dispose();
    if (reader) {
      try {
        reader.releaseLock();
      } catch {
        /* el lector ya pudo haberse liberado */
      }
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
      keep_alive: normalizeKeepAlive(options?.keep_alive ?? env.OLLAMA_EMBEDDING_KEEP_ALIVE ?? "0"),
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

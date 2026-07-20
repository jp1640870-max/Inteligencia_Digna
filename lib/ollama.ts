import { env } from "@/lib/env";

const OLLAMA_URL = env.OLLAMA_URL;

export type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
};

type OllamaResponse = {
  model: string;
  created_at: string;
  message: { role: string; content: string };
  done: boolean;
};

export async function ollamaChat(
  model: string,
  messages: OllamaMessage[],
  options?: Record<string, unknown>
): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false, options }),
  });

  const json: OllamaResponse = await res.json();
  return (json.message?.content || "").trim();
}

export async function* ollamaChatStream(
  model: string,
  messages: OllamaMessage[]
): AsyncGenerator<string> {
  const totalTokens = messages.reduce((s, m) => s + m.content.length, 0);
  console.log(`📡 Ollama fetch: ${totalTokens} chars, timeout 60s`);
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    yield `Error: Ollama respondió con código ${res.status}.`;
    return;
  }

  if (!res.body) {
    yield "Error: no se pudo conectar con Ollama.";
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  
  let lineCount = 0;
  let charCount = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      console.log(`📡 Ollama stream done: ${lineCount} líneas, ${charCount} chars`);
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      lineCount++;
      try {
        const json: OllamaResponse = JSON.parse(line);
        if (json.message?.content) {
          charCount += json.message.content.length;
          yield json.message.content;
        }
        if (json.done) {
          console.log(`📡 Ollama done=true: ${lineCount} líneas, ${charCount} chars`);
          return;
        }
      } catch {
        console.log(`📡 Ollama JSON inválido: ${line.slice(0, 100)}`);
      }
    }
  }
}

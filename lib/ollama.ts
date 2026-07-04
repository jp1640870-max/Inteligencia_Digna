const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

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
  messages: OllamaMessage[]
): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
  });

  const json: OllamaResponse = await res.json();
  return (json.message?.content || "").trim();
}

export async function* ollamaChatStream(
  model: string,
  messages: OllamaMessage[]
): AsyncGenerator<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true }),
  });

  if (!res.body) {
    yield "Error: no se pudo conectar con Ollama.";
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json: OllamaResponse = JSON.parse(line);
        if (json.message?.content) {
          yield json.message.content;
        }
        if (json.done) return;
      } catch {
        // skip invalid JSON lines
      }
    }
  }
}

import type { OllamaMessage } from "./ollama";

const SYSTEM_PROMPT = `
Responde en español de forma clara, directa y útil.
Si das código, usa bloques markdown con el lenguaje correspondiente.
NO uses HTML.
No repitas la pregunta.
Sé conciso pero completo.
`;

type HistoryItem = {
  role: "user" | "ai";
  text?: string;
  images?: string[];
};

export function buildMessages(
  history: HistoryItem[],
  newMessage?: string,
  filesContent?: string,
  projectContext?: string
): OllamaMessage[] {
  const systemPrompt = projectContext
    ? `${SYSTEM_PROMPT}

CONTEXTO DEL PROYECTO:
${projectContext}`
    : SYSTEM_PROMPT;

  const messages: OllamaMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  for (const msg of history) {
    const entry: OllamaMessage = {
      role: msg.role === "ai" ? "assistant" : "user",
      content: msg.text || "",
    };

    if (msg.images && msg.images.length > 0) {
      const base64Images = msg.images.map((img) => {
        const parts = img.split(",");
        return parts.length > 1 ? parts[1] : img;
      });
      entry.images = base64Images;
    }

    messages.push(entry);
  }

  if (newMessage !== undefined) {
    let userContent = newMessage;

    if (filesContent) {
      userContent = `El usuario ha proporcionado el siguiente archivo:\n\n${filesContent}\n\n${newMessage}`;
    }

    messages.push({ role: "user", content: userContent });
  }

  return messages;
}

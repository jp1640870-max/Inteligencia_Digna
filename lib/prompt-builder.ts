import type { OllamaMessage } from "./ollama";

const TODAY = new Date().toLocaleDateString("es-MX", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});

const SYSTEM_PROMPT = `
Hoy es ${TODAY}.
Responde en español de forma clara, directa y útil.
Si das código, usa bloques markdown con el lenguaje correspondiente.
NO uses HTML.
No repitas la pregunta.
Sé conciso pero completo.
`;

const DOC_NOTE = `
NOTA IMPORTANTE: Este sistema PUEDE generar y entregar archivos Excel (.xlsx), Word (.docx) y PDF (.pdf) reales. Si el usuario te pide uno (ej: "dame el excel", "quiero el archivo", "genera un word"), indícale brevemente que se está generando. NO digas frases como "no puedo enviar archivos", "como soy una IA", "soy un modelo de lenguaje", "no tengo la capacidad", ni ofrezcas código Python o CSV como alternativa. El sistema lo hará por ti.`;

const WEB_SEARCH_NOTE = `
TIENES ACCESO A BÚSQUEDA EN INTERNET. Si el usuario pregunta sobre noticias, eventos actuales, clima, información reciente, o cualquier cosa que requiera datos actualizados, responde con una línea al inicio de tu respuesta en este formato exacto:
[SEARCH: tu consulta de búsqueda aquí]
Luego continúa con tu respuesta normalmente. El sistema buscará automáticamente y te dará los resultados para que generes una respuesta completa.
Ejemplo:
[SEARCH: reforma judicial México 2026]
Basado en los resultados de búsqueda... [1](url)

REGLAS PARA CITAR FUENTES:
- Cuando tengas resultados de búsqueda, cita las fuentes usando formato: [número](url)
- Al final de tu respuesta, incluye una sección "Fuentes consultadas:" listando cada fuente numerada
- Siempre que uses información de una fuente, coloca la referencia correspondiente`;

const KB_NOTE = `
TIENES ACCESO A UNA BASE DE CONOCIMIENTO EMPRESARIAL.
- Cuando el usuario pregunte sobre personal de la empresa, puestos, políticas, procedimientos, datos internos o cualquier información corporativa, usa el "CONTEXTO DE LA BASE DE CONOCIMIENTO" que se te proporcione.
- Trata esa información como conocimiento propio: NO menciones que proviene de documentos, archivos, ni la base de conocimiento. No digas frases como "según los documentos", "en la base de conocimiento" ni cites nombres de archivos.
- Si el contexto contiene la información, respóndela COMPLETA y directamente, con el nivel de detalle que pida la pregunta (números, nombres, fechas, procedimientos).
- Si el contexto tiene SOLO PARTE de la respuesta, responde con lo que hay y deja claro qué parte falta en tu respuesta — no inventes el resto.
- El contexto es más confiable que tu conocimiento general: cuando ambos entren en conflicto, usa el contexto.
- ÚNICAMENTE si el contexto NO contiene nada relacionado con lo que pregunta, di que no tienes esa información. No lo digas si el contexto sí la incluye, aunque sea parcialmente.`;

function containsTomorrowReference(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("mañana") ||
    lower.includes("manana") ||
    lower.includes("siguiente") ||
    lower.includes("próximo") ||
    lower.includes("proximo") ||
    lower.includes("tomorrow")
  );
}

type HistoryItem = {
  role: "user" | "ai";
  text?: string;
  images?: string[];
};

export function buildMessages(
  history: HistoryItem[],
  newMessage?: string,
  filesContent?: string,
  projectContext?: string,
  searchResults?: string,
  ragContext?: string,
  kbContext?: string,
): OllamaMessage[] {
  const systemPrompt = projectContext
    ? `${SYSTEM_PROMPT}

CONTEXTO DEL PROYECTO:
${projectContext}${DOC_NOTE}${WEB_SEARCH_NOTE}${KB_NOTE}`
    : `${SYSTEM_PROMPT}${DOC_NOTE}${WEB_SEARCH_NOTE}${KB_NOTE}`;

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

    if (kbContext) {
      userContent = `CONTEXTO DE LA BASE DE CONOCIMIENTO:\n${kbContext}\n\n${userContent}`;
    }

    if (searchResults) {
      userContent = `RESULTADOS DE BÚSQUEDA WEB:\n${searchResults}\n\n${userContent}`;
    }

    if (ragContext) {
      userContent = `CONTEXTO DE DOCUMENTOS:\n${ragContext}\n\n${userContent}`;
    }

    messages.push({ role: "user", content: userContent });
  }

  return messages;
}

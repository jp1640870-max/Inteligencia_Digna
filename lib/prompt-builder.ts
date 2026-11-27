import type { InferenceMessage } from "./ollama";
import type { HeartTool } from "./heart-config";
import type { HeartDefinition } from "./heart-definition";

// Se calcula por request (no a nivel de módulo) para no congelar la fecha
// en procesos de larga duración.
function getToday(): string {
  return new Date().toLocaleDateString("es-MX", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getSystemPrompt(): string {
  return `
Hoy es ${getToday()}.
Responde en español de forma clara, directa y útil.
No repitas la pregunta.
Sé conciso pero completo.

FORMATO DE RESPUESTA:
- Usa Markdown cuando ayude a leer: párrafos cortos, listas, tablas y encabezados.
- No conviertas toda la respuesta en listas ni uses negritas en cada frase.
- Usa encabezados (## o ###) solo en respuestas largas o con secciones claras.
- Para comparar opciones o datos, usa tablas Markdown.
- Usa citas (> texto) para fragmentos textuales.
- Puedes incluir imágenes con ![descripción](URL) solo si la URL es real (proporcionada por el usuario o por los resultados de búsqueda). Nunca inventes URLs de imágenes.
- Si das código, usa bloques Markdown con el lenguaje correspondiente.
- NO uses HTML.
`;
}

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
- Cuando tengas resultados de búsqueda, cita la fuente con formato [número](url) justo después de la afirmación que la usa.
- Usa el número que corresponde al orden de los resultados.
- NO agregues una sección "Fuentes consultadas" ni una lista de enlaces al final: la interfaz ya muestra las fuentes en tarjetas.
- No inventes URLs ni fuentes. Si no tienes un resultado, no lo cites.`;

const KB_NOTE = `
TIENES ACCESO A UNA BASE DE CONOCIMIENTO EMPRESARIAL.
- Cuando el usuario pregunte sobre personal de la empresa, puestos, políticas, procedimientos, datos internos o cualquier información corporativa, usa el "CONTEXTO DE LA BASE DE CONOCIMIENTO" que se te proporcione.
- Trata esa información como conocimiento propio: NO menciones que proviene de documentos, archivos, ni la base de conocimiento. No digas frases como "según los documentos", "en la base de conocimiento" ni cites nombres de archivos.
- Si el contexto contiene la información, respóndela COMPLETA y directamente, con el nivel de detalle que pida la pregunta (números, nombres, fechas, procedimientos).
- Si el contexto tiene SOLO PARTE de la respuesta, responde con lo que hay y deja claro qué parte falta en tu respuesta — no inventes el resto.
- El contexto es más confiable que tu conocimiento general: cuando ambos entren en conflicto, usa el contexto.
- ÚNICAMENTE si el contexto NO contiene nada relacionado con lo que pregunta, di que no tienes esa información. No lo digas si el contexto sí la incluye, aunque sea parcialmente.`;

type HeartPromptConfig = {
  name: string;
  role: string;
  tone: string;
  instructions: string;
  limitations: string;
  tools: HeartTool[];
};

/**
 * Instrucciones para un Heart normal. Solo se anuncian y habilitan las
 * capacidades declaradas en el Heart; la base de conocimiento es una capacidad
 * común de la plataforma.
 */
export function buildHeartInstructions(heart: HeartPromptConfig): string {
  const sections: string[] = [
    `Eres el Heart "${heart.name}" de la organización.`,
  ];

  if (heart.role) sections.push(`Rol: ${heart.role}`);
  if (heart.tone) sections.push(`Tono: ${heart.tone}`);
  if (heart.instructions) {
    sections.push(`INSTRUCCIONES DEL HEART:\n${heart.instructions}`);
  }
  if (heart.limitations) {
    sections.push(`LÍMITES DEL HEART:\n${heart.limitations}`);
  }

  const allowed = ["base de conocimiento empresarial"];
  if (heart.tools.includes("read_files")) allowed.push("leer archivos adjuntos");
  if (heart.tools.includes("generate_docs")) allowed.push("generar documentos");
  if (heart.tools.includes("web_search")) allowed.push("buscar en internet");
  if (heart.tools.includes("analyze_images")) allowed.push("analizar imágenes");

  sections.push(
    `HERRAMIENTAS DISPONIBLES\n- ${allowed.join("\n- ")}\nNo uses herramientas que no estén en esta lista. No generes imágenes dentro de un Heart.`,
  );

  const notes: string[] = [KB_NOTE];
  if (heart.tools.includes("generate_docs")) notes.push(DOC_NOTE);
  if (heart.tools.includes("web_search")) notes.push(WEB_SEARCH_NOTE);

  return `${sections.join("\n\n")}${notes.join("")}`;
}

/**
 * Instrucciones efectivas de un Heart definido por el Registry.
 *
 * Se apoya en el mismo constructor que usa el runtime histórico para que el
 * texto sea idéntico; la diferencia es que la fuente es el snapshot publicado,
 * no la fila editable de `hearts`.
 */
export function buildHeartInstructionsFromDefinition(
  heart: HeartDefinition,
): string {
  return buildHeartInstructions({
    name: heart.identity.name,
    role: heart.identity.role,
    tone: heart.behavior.tone,
    instructions: heart.behavior.instructions,
    limitations: heart.behavior.limitations,
    tools: heart.capabilities.tools,
  });
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
  agentInstructions?: string,
): InferenceMessage[] {
  // Los agentes oficiales y los Hearts sustituyen las notas genéricas por sus
  // propias reglas. El chat normal conserva exactamente el mismo system prompt
  // de siempre.
  const systemPrompt = agentInstructions
    ? `${getSystemPrompt()}${projectContext ? `\n\nCONTEXTO DEL PROYECTO:\n${projectContext}` : ""}\n\n${agentInstructions}`
    : projectContext
      ? `${getSystemPrompt()}

CONTEXTO DEL PROYECTO:
${projectContext}${DOC_NOTE}${WEB_SEARCH_NOTE}${KB_NOTE}`
      : `${getSystemPrompt()}${DOC_NOTE}${WEB_SEARCH_NOTE}${KB_NOTE}`;

  const messages: InferenceMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  for (const msg of history) {
    const entry: InferenceMessage = {
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

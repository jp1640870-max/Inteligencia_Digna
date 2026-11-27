/**
 * Configuración compartida de Hearts.
 *
 * Este módulo no importa nada del servidor para poder usarse también en
 * componentes cliente (formularios y tarjetas de la vista de Hearts).
 */

export const HEART_TOOLS = [
  "read_files",
  "generate_docs",
  "web_search",
  "analyze_images",
] as const;

export type HeartTool = (typeof HEART_TOOLS)[number];

export const HEART_TOOL_LABELS: Record<HeartTool, string> = {
  read_files: "Leer archivos",
  generate_docs: "Generar documentos",
  web_search: "Buscar en la web",
  analyze_images: "Analizar imágenes",
};

export const HEART_LIMITS = {
  name: 80,
  role: 120,
  tone: 120,
  instructions: 4000,
  limitations: 4000,
  temperatureMin: 0,
  temperatureMax: 2,
} as const;

export type HeartDraft = {
  name: string;
  role: string;
  tone: string;
  instructions: string;
  limitations: string;
  temperature: number;
  tools: HeartTool[];
};

export const EMPTY_HEART_DRAFT: HeartDraft = {
  name: "",
  role: "",
  tone: "",
  instructions: "",
  limitations: "",
  temperature: 0.7,
  tools: [],
};

export function isHeartTool(value: unknown): value is HeartTool {
  return typeof value === "string" && (HEART_TOOLS as readonly string[]).includes(value);
}

/**
 * Parser canónico de la columna `tools` (JSONB o texto JSON).
 *
 * Vive aquí, en un módulo puro, para que `lib/hearts.ts` y el contrato
 * `HeartDefinition` usen la misma normalización sin arrastrar base de datos.
 * Los IDs desconocidos se descartan: son datos históricos o malformados, no
 * una autorización de ejecución.
 */
export function parseHeartTools(value: unknown): HeartTool[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const tools: HeartTool[] = [];
  for (const item of parsed) {
    if (!isHeartTool(item) || seen.has(item)) continue;
    seen.add(item);
    tools.push(item);
  }
  return tools;
}

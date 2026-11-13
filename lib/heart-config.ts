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

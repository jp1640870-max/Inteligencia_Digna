/**
 * Contrato y catálogo base de herramientas (Fase 0).
 *
 * No hay Tool Gateway todavía. Este módulo fija el vocabulario común para que
 * el Runtime de Fase 2 y el Gateway de Fase 3 no tengan que inventar IDs,
 * riesgos ni permisos a mitad del refactor.
 *
 * El catálogo es código definido por la plataforma. Un usuario no puede
 * registrar herramientas ni introducir código arbitrario.
 */

import { ALL_CAPABILITIES, type Capability } from "./permissions";
import {
  HEART_TOOLS,
  isHeartTool,
  type HeartTool,
} from "./heart-config";

export const PLATFORM_TOOL_IDS = ["kb_search", "prepare_escalation"] as const;

export type PlatformToolId = (typeof PLATFORM_TOOL_IDS)[number];

export const TOOL_IDS = [...HEART_TOOLS, ...PLATFORM_TOOL_IDS] as const;

export type ToolId = (typeof TOOL_IDS)[number];

/**
 * Herramientas que un usuario puede seleccionar hoy desde el formulario de
 * Hearts. Las herramientas de plataforma se habilitan por definición y no se
 * muestran todavía en la UI de usuario.
 */
export const HEART_SELECTABLE_TOOLS = HEART_TOOLS;

export const TOOL_RISKS = ["low", "medium", "high"] as const;
export type ToolRisk = (typeof TOOL_RISKS)[number];

export const TOOL_STATUSES = ["active", "disabled"] as const;
export type ToolStatus = (typeof TOOL_STATUSES)[number];

export type ToolContract = {
  id: ToolId;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  requiredCapabilities: readonly Capability[];
  risk: ToolRisk;
  integration: string | null;
  version: number;
  status: ToolStatus;
  requiresApproval: boolean;
};

/**
 * IDs históricos del agente oficial. Se mantienen para compatibilidad con
 * `OfficialAgent.allowedTools`; el catálogo canónico usa los IDs de la derecha.
 */
export const LEGACY_OFFICIAL_TOOL_MAP = {
  knowledge_base: "kb_search",
  conversation_files: "read_files",
  prepare_escalation: "prepare_escalation",
} as const satisfies Record<string, ToolId>;

export function isToolId(value: unknown): value is ToolId {
  return (
    typeof value === "string" &&
    (TOOL_IDS as readonly string[]).includes(value)
  );
}

export function isToolRisk(value: unknown): value is ToolRisk {
  return (
    typeof value === "string" &&
    (TOOL_RISKS as readonly string[]).includes(value)
  );
}

export function isToolStatus(value: unknown): value is ToolStatus {
  return (
    typeof value === "string" &&
    (TOOL_STATUSES as readonly string[]).includes(value)
  );
}

export function isHeartSelectableTool(value: unknown): value is HeartTool {
  return isHeartTool(value);
}

/**
 * Resuelve un ID canónico o un ID histórico del agente oficial.
 */
export function resolveToolId(value: unknown): ToolId | null {
  if (isToolId(value)) return value;
  if (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(LEGACY_OFFICIAL_TOOL_MAP, value)
  ) {
    return LEGACY_OFFICIAL_TOOL_MAP[
      value as keyof typeof LEGACY_OFFICIAL_TOOL_MAP
    ];
  }
  return null;
}

/**
 * Catálogo base.
 *
 * `kb_search` y `prepare_escalation` son herramientas de plataforma. La primera
 * siempre se resuelve con el ACL del usuario; la segunda es una vista previa y
 * no crea tickets ni escribe en ServiceDesk.
 */
export const HEART_TOOL_CATALOG: readonly ToolContract[] = [
  {
    id: "kb_search",
    name: "Buscar en la base de conocimiento",
    description:
      "Recupera fragmentos de la base de conocimiento autorizados por el ACL del usuario.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
    requiredCapabilities: [],
    risk: "low",
    integration: null,
    version: 1,
    status: "active",
    requiresApproval: false,
  },
  {
    id: "read_files",
    name: "Leer archivos de la conversación",
    description:
      "Lee el contenido de archivos adjuntos a la conversación actual.",
    inputSchema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
    requiredCapabilities: [],
    risk: "low",
    integration: null,
    version: 1,
    status: "active",
    requiresApproval: false,
  },
  {
    id: "generate_docs",
    name: "Generar documentos",
    description:
      "Genera archivos PDF, Word o Excel a partir del contenido de la conversación.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["pdf", "docx", "xlsx"] },
        request: { type: "string" },
      },
      required: ["format", "request"],
    },
    requiredCapabilities: [],
    risk: "medium",
    integration: null,
    version: 1,
    status: "active",
    requiresApproval: false,
  },
  {
    id: "web_search",
    name: "Buscar en internet",
    description:
      "Consulta fuentes externas para obtener información actualizada.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
    requiredCapabilities: [],
    risk: "medium",
    integration: null,
    version: 1,
    status: "active",
    requiresApproval: false,
  },
  {
    id: "analyze_images",
    name: "Analizar imágenes",
    description:
      "Analiza imágenes adjuntas a la conversación con el modelo de visión.",
    inputSchema: {
      type: "object",
      properties: {
        images: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["images"],
    },
    requiredCapabilities: [],
    risk: "low",
    integration: null,
    version: 1,
    status: "active",
    requiresApproval: false,
  },
  {
    id: "prepare_escalation",
    name: "Preparar escalamiento",
    description:
      "Prepara una vista previa de escalamiento para revisión del usuario. No crea tickets ni escribe en ServiceDesk.",
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string" },
      },
    },
    requiredCapabilities: [],
    risk: "low",
    integration: null,
    version: 1,
    status: "active",
    requiresApproval: false,
  },
];

export function getToolContract(id: ToolId): ToolContract | undefined {
  return HEART_TOOL_CATALOG.find((tool) => tool.id === id);
}

type ValidationResult =
  | { ok: true; value: ToolContract }
  | { ok: false; error: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isCapability(value: unknown): value is Capability {
  return (
    typeof value === "string" &&
    (ALL_CAPABILITIES as readonly string[]).includes(value)
  );
}

/**
 * Valida un contrato ya construido. El Gateway de Fase 3 usará una validación
 * equivalente antes de aceptar una herramienta en el catálogo.
 */
export function validateToolContract(input: unknown): ValidationResult {
  const root = asRecord(input);
  if (!root) {
    return { ok: false, error: "El contrato debe ser un objeto." };
  }

  if (!isToolId(root.id)) {
    return { ok: false, error: `Herramienta desconocida: ${String(root.id)}.` };
  }

  if (typeof root.name !== "string" || root.name.trim() === "") {
    return { ok: false, error: "El nombre de la herramienta es obligatorio." };
  }

  if (typeof root.description !== "string" || root.description.trim() === "") {
    return {
      ok: false,
      error: "La descripción de la herramienta es obligatoria.",
    };
  }

  const inputSchema = asRecord(root.inputSchema);
  if (!inputSchema) {
    return {
      ok: false,
      error: "El esquema de entrada debe ser un objeto.",
    };
  }

  if (!Array.isArray(root.requiredCapabilities)) {
    return {
      ok: false,
      error: "Los permisos requeridos deben ser un arreglo.",
    };
  }
  const requiredCapabilities: Capability[] = [];
  for (const capability of root.requiredCapabilities) {
    if (!isCapability(capability)) {
      return {
        ok: false,
        error: `Capacidad desconocida: ${String(capability)}.`,
      };
    }
    requiredCapabilities.push(capability);
  }

  if (!isToolRisk(root.risk)) {
    return { ok: false, error: `Riesgo inválido: ${String(root.risk)}.` };
  }

  if (
    root.integration !== null &&
    typeof root.integration !== "string"
  ) {
    return {
      ok: false,
      error: "La integración debe ser texto o null.",
    };
  }

  const version = Number(root.version);
  if (!Number.isInteger(version) || version < 1) {
    return {
      ok: false,
      error: "La versión debe ser un entero mayor o igual a 1.",
    };
  }

  if (!isToolStatus(root.status)) {
    return { ok: false, error: `Estado inválido: ${String(root.status)}.` };
  }

  if (typeof root.requiresApproval !== "boolean") {
    return {
      ok: false,
      error: "El campo requiresApproval debe ser booleano.",
    };
  }

  let outputSchema: Record<string, unknown> | undefined;
  if (root.outputSchema !== undefined) {
    const parsedOutputSchema = asRecord(root.outputSchema);
    if (!parsedOutputSchema) {
      return {
        ok: false,
        error: "El esquema de salida debe ser un objeto.",
      };
    }
    outputSchema = parsedOutputSchema;
  }

  return {
    ok: true,
    value: {
      id: root.id,
      name: root.name.trim(),
      description: root.description.trim(),
      inputSchema,
      outputSchema,
      requiredCapabilities,
      risk: root.risk,
      integration: root.integration,
      version,
      status: root.status,
      requiresApproval: root.requiresApproval,
    },
  };
}

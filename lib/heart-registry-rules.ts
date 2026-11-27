/**
 * Reglas puras del Registry de Hearts (Fase 1).
 *
 * No abre conexiones ni importa rutas: contiene la normalización de entrada,
 * las reglas de propiedad y la máquina de estados que comparten el servicio,
 * las rutas administrativas y las pruebas.
 */

import { PERIMETER_ROLES, type HeartScope } from "@/types";
import {
  HEART_LIMITS,
  parseHeartTools,
  type HeartTool,
} from "./heart-config";
import {
  HEART_DEFINITION_LIMITS,
  canTransitionHeartStatus,
  type HeartDefinition,
  type HeartStatus,
} from "./heart-definition";

export type HeartActor = { id: string; role: string };

export type HeartAction =
  | "publish"
  | "pause"
  | "revoke"
  | "archive"
  | "reactivate";

export type HeartWriteInput = {
  name?: string;
  description?: string;
  role?: string;
  tone?: string;
  instructions?: string;
  limitations?: string;
  temperature?: number;
  tools?: HeartTool[];
  model?: string | null;
  declaredFiles?: string[];
};

export type HeartRegistryRecord = {
  definition: HeartDefinition;
  agentKey: string | null;
  isFeatured: boolean;
  ownerName: string | null;
  ownerEmail: string | null;
};

/** Vista plana que consume el panel administrativo. */
export type HeartAdminItem = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  role: string;
  tone: string;
  instructions: string;
  limitations: string;
  temperature: number;
  model: string | null;
  status: HeartStatus;
  version: number;
  published_at: string | null;
  tools: HeartTool[];
  knowledge_files: string[];
  scope: HeartScope;
  agent_key: string | null;
  is_featured: boolean;
  user_name: string | null;
  user_email: string | null;
  created_at: string;
  updated_at: string;
};

type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

function readString(
  value: unknown,
  field: string,
  maxLength: number,
): FieldResult<string> {
  if (typeof value !== "string") {
    return { ok: false, error: `El campo "${field}" debe ser texto.` };
  }
  const text = value.trim();
  if (text.length > maxLength) {
    return {
      ok: false,
      error: `El campo "${field}" supera el máximo de ${maxLength} caracteres.`,
    };
  }
  return { ok: true, value: text };
}

function readStringArray(value: unknown, field: string): FieldResult<string[]> {
  if (!Array.isArray(value)) {
    return { ok: false, error: `El campo "${field}" debe ser un arreglo.` };
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return { ok: false, error: `El campo "${field}" solo admite texto.` };
    }
    const text = item.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return { ok: true, value: result };
}

/**
 * Normaliza lo que una ruta puede escribir de un Heart.
 *
 * Deliberadamente no acepta `scope`, `user_id`, `agent_key`, `status` ni
 * `version`: propiedad y ciclo de vida se cambian solo con sus propias
 * operaciones.
 */
export function parseHeartWriteInput(raw: unknown): FieldResult<HeartWriteInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Datos inválidos." };
  }
  const data = raw as Record<string, unknown>;
  const result: HeartWriteInput = {};

  if (data.name !== undefined) {
    const field = readString(data.name, "name", HEART_LIMITS.name);
    if (!field.ok) return field;
    result.name = field.value;
  }
  if (data.description !== undefined) {
    const field = readString(
      data.description,
      "description",
      HEART_DEFINITION_LIMITS.description,
    );
    if (!field.ok) return field;
    result.description = field.value;
  }
  for (const fieldName of ["role", "tone", "instructions", "limitations"] as const) {
    if (data[fieldName] === undefined) continue;
    const field = readString(data[fieldName], fieldName, HEART_LIMITS[fieldName]);
    if (!field.ok) return field;
    result[fieldName] = field.value;
  }
  if (data.temperature !== undefined) {
    const temperature =
      typeof data.temperature === "number"
        ? data.temperature
        : Number(data.temperature);
    if (
      data.temperature === null ||
      data.temperature === "" ||
      !Number.isFinite(temperature) ||
      temperature < HEART_LIMITS.temperatureMin ||
      temperature > HEART_LIMITS.temperatureMax
    ) {
      return {
        ok: false,
        error: `La temperatura debe estar entre ${HEART_LIMITS.temperatureMin} y ${HEART_LIMITS.temperatureMax}.`,
      };
    }
    result.temperature = temperature;
  }
  if (data.tools !== undefined) {
    if (!Array.isArray(data.tools)) {
      return { ok: false, error: 'El campo "tools" debe ser un arreglo.' };
    }
    result.tools = parseHeartTools(data.tools);
  }
  if (data.model !== undefined) {
    if (data.model === null || data.model === "") {
      result.model = null;
    } else {
      const field = readString(data.model, "model", 120);
      if (!field.ok) return field;
      result.model = field.value;
    }
  }
  if (data.declaredFiles !== undefined) {
    const field = readStringArray(data.declaredFiles, "declaredFiles");
    if (!field.ok) return field;
    result.declaredFiles = field.value;
  }

  return { ok: true, value: result };
}

export function buildHeartDefinitionForCreate(args: {
  input: HeartWriteInput;
  id: string;
  ownerId: string;
  scope: HeartScope;
  status: "draft" | "published";
  now: string;
}): HeartDefinition {
  return {
    id: args.id,
    ownerId: args.ownerId,
    identity: {
      name: args.input.name ?? "",
      description: args.input.description ?? "",
      role: args.input.role ?? "",
    },
    behavior: {
      tone: args.input.tone ?? "",
      instructions: args.input.instructions ?? "",
      limitations: args.input.limitations ?? "",
    },
    model: {
      name: args.input.model ?? null,
      temperature: args.input.temperature ?? 0.7,
    },
    knowledge: {
      mode: "platform_acl",
      declaredFiles: args.input.declaredFiles ?? [],
    },
    capabilities: {
      tools: args.input.tools ?? [],
    },
    admin: {
      scope: args.scope,
      status: args.status,
      version: 1,
      publishedAt: args.status === "published" ? args.now : null,
    },
    timestamps: {
      createdAt: args.now,
      updatedAt: args.now,
    },
  };
}

/**
 * Aplica una edición ordinaria. No cambia estado, versión ni propiedad.
 *
 * El agente oficial conserva las instrucciones, limitaciones, herramientas y
 * modelo definidos en el backend: desde el panel solo se ajusta su
 * presentación, igual que hace hoy la ruta administrativa.
 */
export function applyHeartDefinitionPatch(
  current: HeartDefinition,
  patch: HeartWriteInput,
  options: { official?: boolean } = {},
): HeartDefinition {
  const next: HeartDefinition = {
    ...current,
    identity: { ...current.identity },
    behavior: { ...current.behavior },
    model: { ...current.model },
    knowledge: { ...current.knowledge, declaredFiles: [...current.knowledge.declaredFiles] },
    capabilities: { tools: [...current.capabilities.tools] },
    admin: { ...current.admin },
    timestamps: { ...current.timestamps },
  };

  if (patch.name !== undefined) next.identity.name = patch.name;
  if (patch.description !== undefined) next.identity.description = patch.description;
  if (patch.role !== undefined) next.identity.role = patch.role;
  if (patch.tone !== undefined) next.behavior.tone = patch.tone;
  if (options.official) return next;

  if (patch.instructions !== undefined) next.behavior.instructions = patch.instructions;
  if (patch.limitations !== undefined) next.behavior.limitations = patch.limitations;
  if (patch.temperature !== undefined) next.model.temperature = patch.temperature;
  if (patch.model !== undefined) next.model.name = patch.model;
  if (patch.tools !== undefined) next.capabilities.tools = [...patch.tools];
  if (patch.declaredFiles !== undefined) {
    next.knowledge.declaredFiles = [...patch.declaredFiles];
  }
  return next;
}

export function isHeartPerimeterRole(role: string): boolean {
  return (PERIMETER_ROLES as readonly string[]).includes(role);
}

/** `admin`/`super_admin` gestionan todo; el usuario solo lo personal propio. */
export function canManageHeartDefinition(
  definition: Pick<HeartDefinition, "ownerId" | "admin">,
  actor: HeartActor,
): boolean {
  if (isHeartPerimeterRole(actor.role)) return true;
  return definition.admin.scope === "personal" && definition.ownerId === actor.id;
}

export function isHeartAction(value: unknown): value is HeartAction {
  return (
    value === "publish" ||
    value === "pause" ||
    value === "revoke" ||
    value === "archive" ||
    value === "reactivate"
  );
}

/**
 * Resuelve el estado destino de una acción.
 *
 * Republicar un Heart ya publicado no es una transición de estado: es una
 * nueva versión, por eso se permite explícitamente aquí sin tocar la tabla de
 * transiciones del contrato de Fase 0.
 */
export function resolveHeartStatusAction(
  current: HeartStatus,
  action: HeartAction,
): HeartStatus | null {
  if (action === "publish") {
    return current === "published" || canTransitionHeartStatus(current, "published")
      ? "published"
      : null;
  }
  const target: HeartStatus =
    action === "pause"
      ? "paused"
      : action === "revoke"
        ? "revoked"
        : action === "reactivate"
          ? "draft"
          : "archived";
  return canTransitionHeartStatus(current, target) ? target : null;
}

export function toHeartAdminItem(record: HeartRegistryRecord): HeartAdminItem {
  const definition = record.definition;
  return {
    id: definition.id,
    user_id: definition.ownerId,
    name: definition.identity.name,
    description: definition.identity.description,
    role: definition.identity.role,
    tone: definition.behavior.tone,
    instructions: definition.behavior.instructions,
    limitations: definition.behavior.limitations,
    temperature: definition.model.temperature,
    model: definition.model.name,
    status: definition.admin.status,
    version: definition.admin.version,
    published_at: definition.admin.publishedAt,
    tools: definition.capabilities.tools,
    knowledge_files: definition.knowledge.declaredFiles,
    scope: definition.admin.scope,
    agent_key: record.agentKey,
    is_featured: record.isFeatured,
    user_name: record.ownerName,
    user_email: record.ownerEmail,
    created_at: definition.timestamps.createdAt,
    updated_at: definition.timestamps.updatedAt,
  };
}

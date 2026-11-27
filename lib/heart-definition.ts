/**
 * Contrato tipado de un Heart (Fase 0).
 *
 * Este módulo es deliberadamente puro: no importa `lib/db`, `lib/ollama` ni
 * ninguna ruta de Next.js. Su objetivo es fijar la forma de la definición que
 * usarán el Registry y el Runtime en las siguientes fases, sin conectar todavía
 * esa definición a la ejecución actual.
 *
 * La definición se construye como una vista tipada sobre las columnas planas de
 * `hearts`. No se introduce un nuevo JSON en base de datos en esta fase.
 *
 * En Fase 1 se añaden `description`, `model`, `status`, `version` y
 * `published_at`. Los defaults siguen permitiendo leer filas anteriores a la
 * migración 013.
 */

import type { HeartRow, HeartScope } from "@/types";
import {
  HEART_LIMITS,
  isHeartTool,
  parseHeartTools,
  type HeartTool,
} from "./heart-config";

export const HEART_STATUSES = [
  "draft",
  "published",
  "paused",
  "revoked",
  "archived",
] as const;

export type HeartStatus = (typeof HEART_STATUSES)[number];

/**
 * Transiciones permitidas del ciclo de vida.
 *
 * `revoked` sigue siendo terminal salvo a `archived`. `archived` puede volver a
 * `draft` solo como decisión administrativa explícita de reactivación; el
 * Registry la ejecuta con auditoría. Ningún estado distinto de `published`
 * permite uso por usuarios.
 */
export const HEART_STATUS_TRANSITIONS: Record<
  HeartStatus,
  readonly HeartStatus[]
> = {
  draft: ["published", "archived"],
  published: ["paused", "revoked", "archived"],
  paused: ["published", "revoked", "archived"],
  revoked: ["archived"],
  archived: ["draft"],
};

/** Estados en los que un Heart puede iniciar una ejecución normal. */
export const HEART_USABLE_STATUSES = ["published"] as const;

export const HEART_DEFINITION_LIMITS = {
  description: 500,
  versionMin: 1,
} as const;

export type HeartDefinition = {
  id: string;
  ownerId: string;
  identity: {
    name: string;
    description: string;
    role: string;
  };
  behavior: {
    tone: string;
    instructions: string;
    limitations: string;
  };
  model: {
    /** `null` significa: usar el modelo por defecto del chat. */
    name: string | null;
    temperature: number;
  };
  knowledge: {
    /**
     * En Fase 0 solo existe la política de conocimiento de plataforma sujeta al
     * ACL del usuario. Las fuentes explícitas por Heart se incorporarán en una
     * fase posterior sin ampliar el ACL.
     */
    mode: "platform_acl";
    declaredFiles: string[];
  };
  capabilities: {
    tools: HeartTool[];
  };
  admin: {
    scope: HeartScope;
    status: HeartStatus;
    version: number;
    /** Última publicación; `null` mientras el Heart nunca se ha publicado. */
    publishedAt: string | null;
  };
  timestamps: {
    createdAt: string;
    updatedAt: string;
  };
};

/**
 * Contrato de una versión publicada o editable de un Heart.
 *
 * No hay tabla `heart_versions` todavía. El contrato existe para que la Fase 1
 * pueda persistir snapshots sin inventar la forma en ese momento.
 */
export type HeartVersion = {
  heartId: string;
  version: number;
  snapshot: HeartDefinition;
  authorId: string;
  createdAt: string;
  changeSummary: string;
};

export type HeartVersionValidationResult =
  | { ok: true; value: HeartVersion }
  | { ok: false; error: string };

/**
 * Fila actual o futura de `hearts`.
 *
 * Los campos de Fase 1 se declaran opcionales para que el contrato pueda
 * probarse hoy contra filas existentes, sin exigir todavía la migración.
 */
export type HeartDefinitionSource = HeartRow & {
  description?: string | null;
  model?: string | null;
  status?: string | null;
  version?: number | string | null;
  published_at?: string | Date | null;
};

type ValidationResult =
  | { ok: true; value: HeartDefinition }
  | { ok: false; error: string };

function textValue(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function nullableTextValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  return text === "" ? null : text;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseStringArray(value: unknown): string[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

export function isHeartStatus(value: unknown): value is HeartStatus {
  return (
    typeof value === "string" &&
    (HEART_STATUSES as readonly string[]).includes(value)
  );
}

export function isHeartScope(value: unknown): value is HeartScope {
  return value === "personal" || value === "company";
}

export function isHeartUsable(status: HeartStatus): boolean {
  return (HEART_USABLE_STATUSES as readonly string[]).includes(status);
}

export function canTransitionHeartStatus(
  from: HeartStatus,
  to: HeartStatus,
): boolean {
  return HEART_STATUS_TRANSITIONS[from].includes(to);
}

function normalizeStatus(value: unknown): HeartStatus {
  return isHeartStatus(value) ? value : "published";
}

function normalizeVersion(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= HEART_DEFINITION_LIMITS.versionMin
    ? parsed
    : HEART_DEFINITION_LIMITS.versionMin;
}

function normalizeTemperature(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) &&
    parsed >= HEART_LIMITS.temperatureMin &&
    parsed <= HEART_LIMITS.temperatureMax
    ? parsed
    : 0.7;
}

/**
 * Convierte una fila de `hearts` en la definición tipada.
 *
 * Los campos que todavía no existen en la base se resuelven con defaults
 * compatibles: `description = ""`, `model = null`, `status = "published"` y
 * `version = 1`.
 */
export function toHeartDefinition(
  row: HeartDefinitionSource,
): HeartDefinition {
  return {
    id: textValue(row.id),
    ownerId: textValue(row.user_id),
    identity: {
      name: textValue(row.name),
      description: textValue(row.description),
      role: textValue(row.role),
    },
    behavior: {
      tone: textValue(row.tone),
      instructions: textValue(row.instructions),
      limitations: textValue(row.limitations),
    },
    model: {
      name: nullableTextValue(row.model),
      temperature: normalizeTemperature(row.temperature),
    },
    knowledge: {
      mode: "platform_acl",
      declaredFiles: parseStringArray(row.knowledge_files),
    },
    capabilities: {
      tools: parseHeartTools(row.tools),
    },
    admin: {
      scope: row.scope === "company" ? "company" : "personal",
      status: normalizeStatus(row.status),
      version: normalizeVersion(row.version),
      publishedAt: nullableTextValue(row.published_at),
    },
    timestamps: {
      createdAt: textValue(row.created_at),
      updatedAt: textValue(row.updated_at),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readText(
  value: unknown,
  field: string,
  maxLength: number,
): { ok: true; value: string } | { ok: false; error: string } {
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

function readStringArray(
  value: unknown,
  field: string,
): { ok: true; value: string[] } | { ok: false; error: string } {
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
 * Valida una definición ya construida. No se usa todavía en las rutas: su
 * propósito es fijar las invariantes que el Registry aplicará en Fase 1.
 */
export function validateHeartDefinition(input: unknown): ValidationResult {
  const root = asRecord(input);
  if (!root) {
    return { ok: false, error: "La definición debe ser un objeto." };
  }

  const id = readText(root.id, "id", 100);
  if (!id.ok) return id;
  if (!id.value) return { ok: false, error: "El id es obligatorio." };

  const ownerId = readText(root.ownerId, "ownerId", 100);
  if (!ownerId.ok) return ownerId;
  if (!ownerId.value) {
    return { ok: false, error: "El propietario es obligatorio." };
  }

  const identity = asRecord(root.identity);
  if (!identity) {
    return { ok: false, error: "La identidad del Heart es obligatoria." };
  }

  const name = readText(identity.name, "name", HEART_LIMITS.name);
  if (!name.ok) return name;
  if (!name.value) {
    return { ok: false, error: "El nombre del Heart es obligatorio." };
  }

  const description = readText(
    identity.description,
    "description",
    HEART_DEFINITION_LIMITS.description,
  );
  if (!description.ok) return description;

  const role = readText(identity.role, "role", HEART_LIMITS.role);
  if (!role.ok) return role;

  const behavior = asRecord(root.behavior);
  if (!behavior) {
    return { ok: false, error: "El comportamiento del Heart es obligatorio." };
  }

  const tone = readText(behavior.tone, "tone", HEART_LIMITS.tone);
  if (!tone.ok) return tone;

  const instructions = readText(
    behavior.instructions,
    "instructions",
    HEART_LIMITS.instructions,
  );
  if (!instructions.ok) return instructions;

  const limitations = readText(
    behavior.limitations,
    "limitations",
    HEART_LIMITS.limitations,
  );
  if (!limitations.ok) return limitations;

  const model = asRecord(root.model);
  if (!model) {
    return { ok: false, error: "La configuración de modelo es obligatoria." };
  }

  const modelName = nullableTextValue(model.name);
  if (model.name !== null && model.name !== undefined && typeof model.name !== "string") {
    return { ok: false, error: 'El campo "model.name" debe ser texto o null.' };
  }
  if (modelName && modelName.length > 120) {
    return {
      ok: false,
      error: 'El campo "model.name" supera el máximo de 120 caracteres.',
    };
  }

  const temperature = Number(model.temperature);
  if (
    !Number.isFinite(temperature) ||
    temperature < HEART_LIMITS.temperatureMin ||
    temperature > HEART_LIMITS.temperatureMax
  ) {
    return {
      ok: false,
      error: `La temperatura debe estar entre ${HEART_LIMITS.temperatureMin} y ${HEART_LIMITS.temperatureMax}.`,
    };
  }

  const knowledge = asRecord(root.knowledge);
  if (!knowledge) {
    return { ok: false, error: "La política de conocimiento es obligatoria." };
  }
  if (knowledge.mode !== "platform_acl") {
    return {
      ok: false,
      error: 'El único modo de conocimiento soportado en Fase 0 es "platform_acl".',
    };
  }
  const declaredFiles = readStringArray(
    knowledge.declaredFiles,
    "knowledge.declaredFiles",
  );
  if (!declaredFiles.ok) return declaredFiles;

  const capabilities = asRecord(root.capabilities);
  if (!capabilities) {
    return { ok: false, error: "Las capacidades del Heart son obligatorias." };
  }
  if (!Array.isArray(capabilities.tools)) {
    return {
      ok: false,
      error: 'El campo "capabilities.tools" debe ser un arreglo.',
    };
  }
  const tools: HeartTool[] = [];
  const seenTools = new Set<HeartTool>();
  for (const item of capabilities.tools) {
    if (!isHeartTool(item)) {
      return {
        ok: false,
        error: `Herramienta desconocida: ${String(item)}.`,
      };
    }
    if (seenTools.has(item)) {
      return {
        ok: false,
        error: `Herramienta duplicada: ${item}.`,
      };
    }
    seenTools.add(item);
    tools.push(item);
  }

  const admin = asRecord(root.admin);
  if (!admin) {
    return { ok: false, error: "La administración del Heart es obligatoria." };
  }
  if (!isHeartScope(admin.scope)) {
    return { ok: false, error: 'El scope debe ser "personal" o "company".' };
  }
  if (!isHeartStatus(admin.status)) {
    return { ok: false, error: `Estado de Heart inválido: ${String(admin.status)}.` };
  }
  const version = Number(admin.version);
  if (
    !Number.isInteger(version) ||
    version < HEART_DEFINITION_LIMITS.versionMin
  ) {
    return {
      ok: false,
      error: `La versión debe ser un entero mayor o igual a ${HEART_DEFINITION_LIMITS.versionMin}.`,
    };
  }

  const publishedAt =
    admin.publishedAt === null || admin.publishedAt === undefined
      ? null
      : readText(admin.publishedAt, "admin.publishedAt", 100);
  if (publishedAt && !publishedAt.ok) return publishedAt;

  const timestamps = asRecord(root.timestamps);
  if (!timestamps) {
    return { ok: false, error: "Los timestamps del Heart son obligatorios." };
  }
  const createdAt = readText(timestamps.createdAt, "timestamps.createdAt", 100);
  if (!createdAt.ok) return createdAt;
  const updatedAt = readText(timestamps.updatedAt, "timestamps.updatedAt", 100);
  if (!updatedAt.ok) return updatedAt;

  return {
    ok: true,
    value: {
      id: id.value,
      ownerId: ownerId.value,
      identity: {
        name: name.value,
        description: description.value,
        role: role.value,
      },
      behavior: {
        tone: tone.value,
        instructions: instructions.value,
        limitations: limitations.value,
      },
      model: {
        name: modelName,
        temperature,
      },
      knowledge: {
        mode: "platform_acl",
        declaredFiles: declaredFiles.value,
      },
      capabilities: {
        tools,
      },
      admin: {
        scope: admin.scope,
        status: admin.status,
        version,
        publishedAt: publishedAt && publishedAt.ok ? publishedAt.value : null,
      },
      timestamps: {
        createdAt: createdAt.value,
        updatedAt: updatedAt.value,
      },
    },
  };
}

/**
 * Valida un snapshot versionado. La versión del snapshot debe coincidir con
 * `snapshot.admin.version`, y el `heartId` con `snapshot.id`.
 */
export function validateHeartVersion(
  input: unknown,
): HeartVersionValidationResult {
  const root = asRecord(input);
  if (!root) {
    return { ok: false, error: "La versión debe ser un objeto." };
  }

  const heartId = readText(root.heartId, "heartId", 100);
  if (!heartId.ok) return heartId;
  if (!heartId.value) {
    return { ok: false, error: "El heartId es obligatorio." };
  }

  const version = Number(root.version);
  if (!Number.isInteger(version) || version < HEART_DEFINITION_LIMITS.versionMin) {
    return {
      ok: false,
      error: `La versión debe ser un entero mayor o igual a ${HEART_DEFINITION_LIMITS.versionMin}.`,
    };
  }

  const snapshot = validateHeartDefinition(root.snapshot);
  if (!snapshot.ok) {
    return { ok: false, error: `Snapshot inválido: ${snapshot.error}` };
  }
  if (snapshot.value.id !== heartId.value) {
    return {
      ok: false,
      error: "El heartId no coincide con el id del snapshot.",
    };
  }
  if (snapshot.value.admin.version !== version) {
    return {
      ok: false,
      error: "La versión no coincide con admin.version del snapshot.",
    };
  }

  const authorId = readText(root.authorId, "authorId", 100);
  if (!authorId.ok) return authorId;
  if (!authorId.value) {
    return { ok: false, error: "El autor es obligatorio." };
  }

  const createdAt = readText(root.createdAt, "createdAt", 100);
  if (!createdAt.ok) return createdAt;
  if (!createdAt.value) {
    return { ok: false, error: "La fecha de la versión es obligatoria." };
  }

  const changeSummary = readText(root.changeSummary, "changeSummary", 500);
  if (!changeSummary.ok) return changeSummary;

  return {
    ok: true,
    value: {
      heartId: heartId.value,
      version,
      snapshot: snapshot.value,
      authorId: authorId.value,
      createdAt: createdAt.value,
      changeSummary: changeSummary.value,
    },
  };
}

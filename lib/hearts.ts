import { v4 as uuidv4 } from "uuid";
import { query } from "./db-connection";
import {
  HEART_LIMITS,
  isHeartTool,
  type HeartDraft,
  type HeartTool,
} from "./heart-config";
import type { Agent, HeartRow } from "@/types";

type DbRow = Record<string, unknown>;

function textValue(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function parseHeartTools(value: unknown): HeartTool[] {
  const parsed = parseJson(value);
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

function parseStringArray(value: unknown): string[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string");
}

function normalizeHeartRow(row: DbRow): HeartRow {
  return {
    id: textValue(row.id),
    user_id: textValue(row.user_id),
    name: textValue(row.name),
    role: textValue(row.role),
    tone: textValue(row.tone),
    instructions: textValue(row.instructions),
    limitations: textValue(row.limitations),
    temperature: numberValue(row.temperature, 0.7),
    knowledge_files: JSON.stringify(parseStringArray(row.knowledge_files)),
    tools: JSON.stringify(parseHeartTools(row.tools)),
    agent_memory: textValue(row.agent_memory),
    is_public: booleanValue(row.is_public) ? 1 : 0,
    is_preset: booleanValue(row.is_preset) ? 1 : 0,
    created_at: textValue(row.created_at),
    updated_at: textValue(row.updated_at),
  };
}

/** Convierte una fila de BD en el Heart que consume la vista de usuario. */
export function toAgent(row: HeartRow, viewerId: string): Agent {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    role: row.role,
    tone: row.tone,
    instructions: row.instructions,
    limitations: row.limitations,
    temperature: row.temperature,
    tools: parseHeartTools(row.tools),
    knowledge_files: parseStringArray(row.knowledge_files),
    is_public: Boolean(row.is_public),
    is_preset: Boolean(row.is_preset),
    is_owner: row.user_id === viewerId,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function canEditHeart(heart: Pick<HeartRow, "user_id">, userId: string): boolean {
  return heart.user_id === userId;
}

type SanitizeResult =
  | { ok: true; value: HeartDraft }
  | { ok: false; error: string };

function readText(
  data: Record<string, unknown>,
  field: keyof HeartDraft,
  maxLength: number,
): { ok: true; value: string } | { ok: false; error: string } {
  const raw = data[field];
  if (raw === undefined || raw === null) return { ok: true, value: "" };
  if (typeof raw !== "string") {
    return { ok: false, error: `El campo "${field}" debe ser texto.` };
  }
  const value = raw.trim();
  if (value.length > maxLength) {
    return {
      ok: false,
      error: `El campo "${field}" supera el máximo de ${maxLength} caracteres.`,
    };
  }
  return { ok: true, value };
}

/**
 * Normaliza y valida lo que un usuario puede escribir desde la vista de
 * Hearts. Deliberadamente ignora campos administrativos (`is_preset`,
 * `is_public`, `user_id`): publicar un Heart es una acción del panel.
 */
export function sanitizeHeartInput(input: unknown): SanitizeResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Datos inválidos." };
  }

  const data = input as Record<string, unknown>;

  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name) return { ok: false, error: "El nombre del Heart es obligatorio." };
  if (name.length > HEART_LIMITS.name) {
    return {
      ok: false,
      error: `El nombre supera el máximo de ${HEART_LIMITS.name} caracteres.`,
    };
  }

  const role = readText(data, "role", HEART_LIMITS.role);
  if (!role.ok) return role;

  const tone = readText(data, "tone", HEART_LIMITS.tone);
  if (!tone.ok) return tone;

  const instructions = readText(data, "instructions", HEART_LIMITS.instructions);
  if (!instructions.ok) return instructions;

  const limitations = readText(data, "limitations", HEART_LIMITS.limitations);
  if (!limitations.ok) return limitations;

  let temperature = 0.7;
  if (data.temperature !== undefined && data.temperature !== null && data.temperature !== "") {
    temperature = Number(data.temperature);
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
  }

  return {
    ok: true,
    value: {
      name,
      role: role.value,
      tone: tone.value,
      instructions: instructions.value,
      limitations: limitations.value,
      temperature,
      tools: parseHeartTools(data.tools ?? []),
    },
  };
}

// ─── Acceso a datos ─────────────────────────────────────────────────────────

/**
 * Hearts visibles para un usuario: los propios y los publicados por la empresa
 * (`is_preset` o `is_public`). El orden deja primero los propios.
 */
export async function listHeartsForUser(userId: string): Promise<Agent[]> {
  const result = await query(
    `SELECT *
       FROM hearts
      WHERE user_id = $1 OR is_public = TRUE OR is_preset = TRUE
      ORDER BY (user_id = $1) DESC, is_preset DESC, updated_at DESC`,
    [userId],
  );

  return (result.rows as DbRow[]).map((row) =>
    toAgent(normalizeHeartRow(row), userId),
  );
}

export async function readHeartForUser(
  id: string,
  userId: string,
): Promise<Agent | null> {
  const result = await query(
    `SELECT *
       FROM hearts
      WHERE id = $1
        AND (user_id = $2 OR is_public = TRUE OR is_preset = TRUE)
      LIMIT 1`,
    [id, userId],
  );

  const row = result.rows[0] as DbRow | undefined;
  return row ? toAgent(normalizeHeartRow(row), userId) : null;
}

export async function getHeartRow(id: string): Promise<HeartRow | null> {
  const result = await query("SELECT * FROM hearts WHERE id = $1 LIMIT 1", [id]);
  const row = result.rows[0] as DbRow | undefined;
  return row ? normalizeHeartRow(row) : null;
}

export async function insertHeart(
  userId: string,
  draft: HeartDraft,
): Promise<Agent> {
  const id = uuidv4();

  await query(
    `INSERT INTO hearts
       (id, user_id, name, role, tone, instructions, limitations, temperature, tools)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      id,
      userId,
      draft.name,
      draft.role,
      draft.tone,
      draft.instructions,
      draft.limitations,
      draft.temperature,
      JSON.stringify(draft.tools),
    ],
  );

  const created = await readHeartForUser(id, userId);
  if (!created) throw new Error("No se pudo leer el Heart recién creado.");
  return created;
}

export async function updateOwnedHeart(
  id: string,
  userId: string,
  draft: HeartDraft,
): Promise<Agent | null> {
  const result = await query(
    `UPDATE hearts
        SET name = $1,
            role = $2,
            tone = $3,
            instructions = $4,
            limitations = $5,
            temperature = $6,
            tools = $7::jsonb,
            updated_at = NOW()
      WHERE id = $8 AND user_id = $9`,
    [
      draft.name,
      draft.role,
      draft.tone,
      draft.instructions,
      draft.limitations,
      draft.temperature,
      JSON.stringify(draft.tools),
      id,
      userId,
    ],
  );

  if ((result.rowCount ?? 0) === 0) return null;
  return readHeartForUser(id, userId);
}

export async function removeOwnedHeart(
  id: string,
  userId: string,
): Promise<boolean> {
  const result = await query("DELETE FROM hearts WHERE id = $1 AND user_id = $2", [
    id,
    userId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

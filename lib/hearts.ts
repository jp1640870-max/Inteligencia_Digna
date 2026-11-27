import { v4 as uuidv4 } from "uuid";
import { query } from "./db-connection";
import {
  HEART_LIMITS,
  parseHeartTools,
  type HeartDraft,
} from "./heart-config";
import { SUPPORT_AGENT } from "./official-agents";
import type { Agent, HeartRow, HeartScope } from "@/types";

/** Parser canónico. Se reexporta para no romper a quien ya lo importaba aquí. */
export { parseHeartTools };

type DbRow = Record<string, unknown>;

function textValue(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function nullableTextValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.trim() === "" ? null : text;
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

function parseStringArray(value: unknown): string[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string");
}

function normalizeHeartRow(row: DbRow): HeartRow {
  const scope: HeartScope = row.scope === "company" ? "company" : "personal";

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
    scope,
    agent_key: nullableTextValue(row.agent_key),
    is_featured: booleanValue(row.is_featured) ? 1 : 0,
    is_pinned: booleanValue(row.is_pinned) ? 1 : 0,
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
    scope: row.scope,
    agent_key: row.agent_key,
    is_featured: Boolean(row.is_featured),
    is_pinned: Boolean(row.is_pinned),
    is_owner: row.scope === "personal" && row.user_id === viewerId,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Solo el propietario puede editar un Heart personal. Los Hearts de empresa
 * se editan exclusivamente desde el panel de administración.
 */
export function canEditHeart(
  heart: Pick<HeartRow, "user_id" | "scope">,
  userId: string,
): boolean {
  return heart.scope === "personal" && heart.user_id === userId;
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
 * Hearts. Deliberadamente ignora campos administrativos (`scope`, `agent_key`,
 * `is_preset`, `is_public`, `is_featured`, `user_id`): publicar o fijar un
 * Heart de empresa es una acción exclusiva del panel de administración.
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
 * Hearts visibles para un usuario: sus Hearts personales y todos los Hearts de
 * empresa, siempre que estén publicados. Pausados, revocados y archivados no se
 * listan ni pueden iniciar ejecución, aunque el panel admin los siga mostrando.
 * Los fijados por el usuario o destacados por el administrador suben al
 * principio; después se muestran los personales.
 */
export async function listHeartsForUser(userId: string): Promise<Agent[]> {
  const result = await query(
    `SELECT h.*,
            (p.user_id IS NOT NULL) AS is_pinned
       FROM hearts h
       LEFT JOIN user_heart_pins p
         ON p.heart_id = h.id AND p.user_id = $1
      WHERE (h.scope = 'company'
         OR (h.scope = 'personal' AND h.user_id = $1))
        AND h.status = 'published'
      ORDER BY (p.user_id IS NOT NULL OR h.is_featured) DESC,
               (h.scope = 'personal' AND h.user_id = $1) DESC,
               h.updated_at DESC`,
    [userId],
  );

  return (result.rows as DbRow[]).map((row) =>
    toAgent(normalizeHeartRow(row), userId),
  );
}

/** Lectura de un Heart usable por el usuario: solo si está publicado. */
export async function readHeartForUser(
  id: string,
  userId: string,
): Promise<Agent | null> {
  const result = await query(
    `SELECT h.*,
            (p.user_id IS NOT NULL) AS is_pinned
       FROM hearts h
       LEFT JOIN user_heart_pins p
         ON p.heart_id = h.id AND p.user_id = $2
      WHERE h.id = $1
        AND h.status = 'published'
        AND (
          h.scope = 'company'
          OR (h.scope = 'personal' AND h.user_id = $2)
        )
      LIMIT 1`,
    [id, userId],
  );

  const row = result.rows[0] as DbRow | undefined;
  return row ? toAgent(normalizeHeartRow(row), userId) : null;
}

/** Resuelve un Heart de empresa por el identificador del agente oficial. */
export async function getHeartByAgentKeyForUser(
  agentKey: string,
  userId: string,
): Promise<Agent | null> {
  const result = await query(
    `SELECT h.*,
            (p.user_id IS NOT NULL) AS is_pinned
       FROM hearts h
       LEFT JOIN user_heart_pins p
         ON p.heart_id = h.id AND p.user_id = $2
      WHERE h.agent_key = $1
        AND h.status = 'published'
        AND (
          h.scope = 'company'
          OR (h.scope = 'personal' AND h.user_id = $2)
        )
      LIMIT 1`,
    [agentKey, userId],
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
       (id, user_id, name, role, tone, instructions, limitations, temperature, tools, scope, is_preset)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'personal', FALSE)`,
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
      WHERE id = $8 AND user_id = $9 AND scope = 'personal'`,
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
  const result = await query(
    "DELETE FROM hearts WHERE id = $1 AND user_id = $2 AND scope = 'personal'",
    [id, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Fija o desfija un Heart para el usuario que consulta. */
export async function setHeartPinnedForUser(
  heartId: string,
  userId: string,
  pinned: boolean,
): Promise<Agent | null> {
  const heart = await readHeartForUser(heartId, userId);
  if (!heart) return null;

  if (pinned) {
    await query(
      `INSERT INTO user_heart_pins (user_id, heart_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [userId, heartId],
    );
  } else {
    await query(
      "DELETE FROM user_heart_pins WHERE user_id = $1 AND heart_id = $2",
      [userId, heartId],
    );
  }

  return readHeartForUser(heartId, userId);
}

/**
 * Garantiza que exista la tarjeta oficial de Soporte Técnico en Hearts.
 *
 * Si ya existe un Heart vinculado a `SUPPORT_AGENT.id` no se duplica ni se
 * sobrescribe: solo se asegura de que sea de empresa. Si no existe, se crea
 * una única vez a nombre del usuario que consulta.
 */
export async function ensureOfficialSupportHeart(ownerId: string): Promise<void> {
  await query(
    `INSERT INTO hearts
       (id, user_id, name, description, role, tone, instructions, limitations,
        temperature, tools, is_preset, scope, agent_key, status, version, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '[]'::jsonb, TRUE, 'company', $10,
             'published', 1, NOW())
     ON CONFLICT DO NOTHING`,
    [
      uuidv4(),
      ownerId,
      SUPPORT_AGENT.name,
      SUPPORT_AGENT.description,
      SUPPORT_AGENT.role,
      "Profesional y claro",
      SUPPORT_AGENT.instructions,
      "No inventa evidencia ni crea tickets reales. El escalamiento es una vista previa.",
      0.2,
      SUPPORT_AGENT.id,
    ],
  );

  await query(
    `UPDATE hearts
        SET scope = 'company',
            is_preset = TRUE,
            status = 'published',
            version = GREATEST(version, 1),
            description = COALESCE(NULLIF(description, ''), $2),
            published_at = COALESCE(published_at, NOW())
      WHERE agent_key = $1`,
    [SUPPORT_AGENT.id, SUPPORT_AGENT.description],
  );
}

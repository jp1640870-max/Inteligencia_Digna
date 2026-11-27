/**
 * Registry de Hearts (Fase 1).
 *
 * Servicio de definiciones: crear, editar, listar, obtener y eliminar con
 * validación, propiedad y auditoría. No ejecuta Hearts: el resolver de Fase 2
 * consume la definición y el snapshot publicado para construir la ejecución.
 */

import { v4 as uuidv4 } from "uuid";
import type { HeartScope } from "@/types";
import { query, withTransaction } from "./db-connection";
import { logAudit } from "./db";
import {
  toHeartDefinition,
  validateHeartDefinition,
  type HeartDefinition,
  type HeartDefinitionSource,
  type HeartStatus,
} from "./heart-definition";
import { SUPPORT_AGENT } from "./official-agents";
import {
  applyHeartDefinitionPatch,
  buildHeartDefinitionForCreate,
  canManageHeartDefinition,
  isHeartPerimeterRole,
  parseHeartWriteInput,
  type HeartActor,
  type HeartRegistryRecord,
} from "./heart-registry-rules";
import { buildHeartVersion, insertHeartVersion } from "./heart-versions";

type DbRow = Record<string, unknown>;

export type {
  HeartActor,
  HeartAction,
  HeartAdminItem,
  HeartRegistryRecord,
} from "./heart-registry-rules";
export { toHeartAdminItem } from "./heart-registry-rules";

export type HeartListFilters = {
  scope?: HeartScope | null;
  status?: HeartStatus | null;
  search?: string | null;
};

export type HeartRegistryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: 400 | 403 | 404 | 409 | 500 };

const HEART_RECORD_SELECT = `
  SELECT h.*, u.name AS user_name, u.email AS user_email
    FROM hearts h
    LEFT JOIN users u ON u.id = h.user_id`;

function nullableTextValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  return text === "" ? null : text;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function toRecord(row: DbRow): HeartRegistryRecord {
  return {
    definition: toHeartDefinition(row as unknown as HeartDefinitionSource),
    agentKey: nullableTextValue(row.agent_key),
    isFeatured: booleanValue(row.is_featured),
    ownerName: nullableTextValue(row.user_name),
    ownerEmail: nullableTextValue(row.user_email),
  };
}

export async function loadHeartRecord(
  id: string,
): Promise<HeartRegistryRecord | null> {
  const result = await query(`${HEART_RECORD_SELECT} WHERE h.id = $1 LIMIT 1`, [id]);
  const row = result.rows[0] as DbRow | undefined;
  return row ? toRecord(row) : null;
}

/** Obtiene un Heart para gestión, comprobando propiedad y rol del actor. */
export async function getHeartDefinitionRecord(
  id: string,
  actor: HeartActor,
): Promise<HeartRegistryResult<HeartRegistryRecord>> {
  const record = await loadHeartRecord(id);
  if (!record) {
    return { ok: false, error: "Heart no encontrado", status: 404 };
  }
  if (!canManageHeartDefinition(record.definition, actor)) {
    return { ok: false, error: "No autorizado para gestionar este Heart", status: 403 };
  }
  return { ok: true, value: record };
}

export async function listHeartDefinitions(
  actor: HeartActor,
  filters: HeartListFilters = {},
): Promise<HeartRegistryResult<HeartRegistryRecord[]>> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  // Defensa en profundidad: sin rol de perímetro solo se listan Hearts propios.
  if (!isHeartPerimeterRole(actor.role)) {
    conditions.push(`h.scope = 'personal' AND h.user_id = $${paramIndex++}`);
    values.push(actor.id);
  }
  if (filters.scope === "personal" || filters.scope === "company") {
    conditions.push(`h.scope = $${paramIndex++}`);
    values.push(filters.scope);
  }
  if (
    filters.status === "draft" ||
    filters.status === "published" ||
    filters.status === "paused" ||
    filters.status === "revoked" ||
    filters.status === "archived"
  ) {
    conditions.push(`h.status = $${paramIndex++}`);
    values.push(filters.status);
  }
  if (filters.search && filters.search.trim()) {
    conditions.push(
      `(h.name ILIKE $${paramIndex} OR h.description ILIKE $${paramIndex} OR h.role ILIKE $${paramIndex})`,
    );
    values.push(`%${filters.search.trim()}%`);
    paramIndex += 1;
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const result = await query(
    `${HEART_RECORD_SELECT}${where} ORDER BY h.updated_at DESC`,
    values,
  );
  return {
    ok: true,
    value: (result.rows as DbRow[]).map(toRecord),
  };
}

export type HeartCreateInput = {
  scope: HeartScope;
  status?: "draft" | "published";
  isFeatured?: boolean;
  [key: string]: unknown;
};

/** Crea una definición. Publicar en la creación también escribe el snapshot v1. */
export async function createHeartDefinition(
  input: HeartCreateInput,
  actor: HeartActor,
): Promise<HeartRegistryResult<HeartRegistryRecord>> {
  const parsed = parseHeartWriteInput(input);
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };

  if (input.scope !== "personal" && input.scope !== "company") {
    return { ok: false, error: 'El scope debe ser "personal" o "company".', status: 400 };
  }
  if (input.scope === "company" && !isHeartPerimeterRole(actor.role)) {
    return { ok: false, error: "No autorizado para crear Hearts de empresa", status: 403 };
  }
  if (
    input.status !== undefined &&
    input.status !== "draft" &&
    input.status !== "published"
  ) {
    return { ok: false, error: "Estado inicial inválido", status: 400 };
  }

  const status = input.status ?? "draft";
  const isFeatured =
    input.scope === "company" && Boolean(input.isFeatured) && isHeartPerimeterRole(actor.role);
  const now = new Date().toISOString();
  const definition = buildHeartDefinitionForCreate({
    input: parsed.value,
    id: uuidv4(),
    ownerId: actor.id,
    scope: input.scope,
    status,
    now,
  });
  const validated = validateHeartDefinition(definition);
  if (!validated.ok) return { ok: false, error: validated.error, status: 400 };

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO hearts
         (id, user_id, name, description, role, tone, instructions, limitations,
          temperature, model, tools, knowledge_files, is_preset, is_featured,
          scope, status, version, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb,
               FALSE, $13, $14, $15, $16, $17)`,
      [
        definition.id,
        definition.ownerId,
        definition.identity.name,
        definition.identity.description,
        definition.identity.role,
        definition.behavior.tone,
        definition.behavior.instructions,
        definition.behavior.limitations,
        definition.model.temperature,
        definition.model.name,
        JSON.stringify(definition.capabilities.tools),
        JSON.stringify(definition.knowledge.declaredFiles),
        isFeatured,
        definition.admin.scope,
        definition.admin.status,
        definition.admin.version,
        definition.admin.publishedAt,
      ],
    );

    if (status === "published") {
      await insertHeartVersion(
        client,
        buildHeartVersion({
          definition,
          authorId: actor.id,
          createdAt: now,
          changeSummary: "Creación y publicación inicial",
        }),
      );
    }
  });

  await logAudit(
    actor.id,
    "create_heart_definition",
    `Heart de ${definition.admin.scope} creado: ${definition.identity.name} (${status})`,
  );
  const record = await loadHeartRecord(definition.id);
  if (!record) {
    return { ok: false, error: "No se pudo leer el Heart creado", status: 500 };
  }
  return { ok: true, value: record };
}

/**
 * Edita una definición. Nunca cambia propiedad, scope, agente oficial, estado
 * ni versión: para eso existen las operaciones de ciclo de vida.
 */
export async function updateHeartDefinition(
  id: string,
  rawPatch: unknown,
  actor: HeartActor,
): Promise<HeartRegistryResult<HeartRegistryRecord>> {
  const record = await loadHeartRecord(id);
  if (!record) return { ok: false, error: "Heart no encontrado", status: 404 };
  if (!canManageHeartDefinition(record.definition, actor)) {
    return { ok: false, error: "No autorizado para gestionar este Heart", status: 403 };
  }

  const parsed = parseHeartWriteInput(rawPatch);
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };
  const patch = parsed.value;
  const official = Boolean(record.agentKey);
  const candidate = applyHeartDefinitionPatch(record.definition, patch, { official });
  const validated = validateHeartDefinition(candidate);
  if (!validated.ok) return { ok: false, error: validated.error, status: 400 };

  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    sets.push(`${column} = $${values.length + 1}`);
    values.push(value);
  };

  if (patch.name !== undefined) add("name", candidate.identity.name);
  if (patch.description !== undefined) add("description", candidate.identity.description);
  if (patch.role !== undefined) add("role", candidate.identity.role);
  if (patch.tone !== undefined) add("tone", candidate.behavior.tone);
  if (!official) {
    if (patch.instructions !== undefined) add("instructions", candidate.behavior.instructions);
    if (patch.limitations !== undefined) add("limitations", candidate.behavior.limitations);
    if (patch.temperature !== undefined) add("temperature", candidate.model.temperature);
    if (patch.model !== undefined) add("model", candidate.model.name);
    if (patch.tools !== undefined) {
      add("tools", JSON.stringify(candidate.capabilities.tools));
    }
    if (patch.declaredFiles !== undefined) {
      add("knowledge_files", JSON.stringify(candidate.knowledge.declaredFiles));
    }
  }

  if (rawPatch && typeof rawPatch === "object" && !Array.isArray(rawPatch)) {
    const body = rawPatch as Record<string, unknown>;
    const rawFeatured =
      "isFeatured" in body ? body.isFeatured : "is_featured" in body ? body.is_featured : undefined;
    if (rawFeatured !== undefined && record.definition.admin.scope === "company") {
      add("is_featured", Boolean(rawFeatured));
    }
  }

  if (sets.length === 0) return { ok: true, value: record };

  sets.push(`updated_at = NOW()`);
  values.push(id);
  await query(`UPDATE hearts SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
  await logAudit(
    actor.id,
    "update_heart_definition",
    `Heart actualizado: ${candidate.identity.name}${official ? " (agente oficial: solo presentación)" : ""}`,
  );

  const updated = await loadHeartRecord(id);
  if (!updated) return { ok: false, error: "No se pudo leer el Heart actualizado", status: 500 };
  return { ok: true, value: updated };
}

export async function deleteHeartDefinition(
  id: string,
  actor: HeartActor,
): Promise<HeartRegistryResult<{ id: string }>> {
  const record = await loadHeartRecord(id);
  if (!record) return { ok: false, error: "Heart no encontrado", status: 404 };
  if (!canManageHeartDefinition(record.definition, actor)) {
    return { ok: false, error: "No autorizado para gestionar este Heart", status: 403 };
  }
  if (record.agentKey) {
    return { ok: false, error: "El agente oficial no se puede eliminar", status: 409 };
  }

  await query("DELETE FROM hearts WHERE id = $1", [id]);
  await logAudit(
    actor.id,
    "delete_heart_definition",
    `Heart eliminado: ${record.definition.identity.name}`,
  );
  return { ok: true, value: { id } };
}

/**
 * Definición de Soporte para el consumidor del Registry.
 *
 * Si la fila sembrada no existe o no valida, se usa el agente oficial del
 * código. Este fallback es temporal: el comportamiento sigue ejecutándose desde
 * `official-agents.ts` y las ramas actuales del chat.
 */
export function buildFallbackSupportDefinition(): HeartDefinition {
  const timestamp = "1970-01-01T00:00:00.000Z";
  return {
    id: SUPPORT_AGENT.id,
    ownerId: "system",
    identity: {
      name: SUPPORT_AGENT.name,
      description: SUPPORT_AGENT.description,
      role: SUPPORT_AGENT.role,
    },
    behavior: {
      tone: "Profesional y claro",
      instructions: SUPPORT_AGENT.instructions,
      limitations:
        "No inventa evidencia ni crea tickets reales. El escalamiento es una vista previa.",
    },
    model: { name: null, temperature: 0.2 },
    knowledge: { mode: "platform_acl", declaredFiles: [] },
    capabilities: { tools: [] },
    admin: {
      scope: "company",
      status: "published",
      version: 1,
      publishedAt: timestamp,
    },
    timestamps: { createdAt: timestamp, updatedAt: timestamp },
  };
}

export async function getOfficialSupportDefinition(): Promise<HeartDefinition> {
  try {
    const result = await query(
      `${HEART_RECORD_SELECT} WHERE h.agent_key = $1 LIMIT 1`,
      [SUPPORT_AGENT.id],
    );
    const row = result.rows[0] as DbRow | undefined;
    if (row) {
      const validated = validateHeartDefinition(toRecord(row).definition);
      if (validated.ok) return validated.value;
    }
  } catch {
    // Sin base de datos o fila inválida: el agente oficial sigue disponible.
  }
  return buildFallbackSupportDefinition();
}

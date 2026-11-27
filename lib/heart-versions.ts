/**
 * Persistencia de snapshots versionados de Hearts (Fase 1).
 *
 * Cada publicación guarda una copia inmutable de la definición. La tabla no
 * sustituye a `hearts`: es el historial y la fuente que el resolver de Fase 2
 * usa para ejecutar la versión publicada vigente.
 */

import type { PoolClient } from "pg";
import { query } from "./db-connection";
import {
  validateHeartVersion,
  type HeartDefinition,
  type HeartVersion,
} from "./heart-definition";
import type { HeartVersionRow } from "@/types";

type DbRow = Record<string, unknown>;
type Queryable = Pick<PoolClient, "query">;

function textValue(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function parseSnapshot(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** Convierte una fila en un `HeartVersion`. Devuelve null si el snapshot es inválido. */
export function toHeartVersion(row: HeartVersionRow): HeartVersion | null {
  const result = validateHeartVersion({
    heartId: textValue(row.heart_id),
    version: row.version,
    snapshot: parseSnapshot(row.snapshot),
    authorId: textValue(row.author_id),
    createdAt: textValue(row.created_at),
    changeSummary: textValue(row.change_summary),
  });
  return result.ok ? result.value : null;
}

/** Inserta un snapshot validado. Se usa dentro de la transacción de publicación. */
export async function insertHeartVersion(
  client: Queryable,
  version: HeartVersion,
): Promise<void> {
  const validated = validateHeartVersion(version);
  if (!validated.ok) throw new Error(validated.error);

  await client.query(
    `INSERT INTO heart_versions
       (heart_id, version, snapshot, author_id, created_at, change_summary)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6)`,
    [
      validated.value.heartId,
      validated.value.version,
      JSON.stringify(validated.value.snapshot),
      validated.value.authorId,
      validated.value.createdAt,
      validated.value.changeSummary,
    ],
  );
}

/** Historial de un Heart, ordenado de la versión más reciente a la más antigua. */
export async function listHeartVersions(heartId: string): Promise<HeartVersion[]> {
  const result = await query(
    "SELECT * FROM heart_versions WHERE heart_id = $1 ORDER BY version DESC",
    [heartId],
  );
  const versions: HeartVersion[] = [];
  for (const raw of result.rows as DbRow[]) {
    const version = toHeartVersion(raw as unknown as HeartVersionRow);
    if (version) versions.push(version);
  }
  return versions;
}

export async function getHeartVersion(
  heartId: string,
  version: number,
): Promise<HeartVersion | null> {
  const result = await query(
    "SELECT * FROM heart_versions WHERE heart_id = $1 AND version = $2 LIMIT 1",
    [heartId, version],
  );
  const row = result.rows[0] as DbRow | undefined;
  return row ? toHeartVersion(row as unknown as HeartVersionRow) : null;
}

/** Contrato de snapshot para una definición ya publicada. */
export function buildHeartVersion(args: {
  definition: HeartDefinition;
  authorId: string;
  createdAt: string;
  changeSummary: string;
}): HeartVersion {
  return {
    heartId: args.definition.id,
    version: args.definition.admin.version,
    snapshot: args.definition,
    authorId: args.authorId,
    createdAt: args.createdAt,
    changeSummary: args.changeSummary,
  };
}

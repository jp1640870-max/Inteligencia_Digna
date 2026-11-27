/**
 * Ciclo de vida del Registry de Hearts (Fase 1).
 *
 * Publicar, pausar, revocar y archivar son operaciones auditadas. Publicar
 * incrementa la versión y escribe un snapshot atómico; las demás acciones no
 * cambian la versión. La lectura de usuario y el resolver de Fase 2 solo
 * ejecutan Hearts publicados; pausar o archivar los retira de circulación.
 */

import { withTransaction } from "./db-connection";
import { logAudit } from "./db";
import { validateHeartDefinition, type HeartDefinition } from "./heart-definition";
import {
  getHeartDefinitionRecord,
  loadHeartRecord,
  type HeartActor,
  type HeartRegistryRecord,
  type HeartRegistryResult,
} from "./heart-registry";
import {
  isHeartAction,
  resolveHeartStatusAction,
  type HeartAction,
} from "./heart-registry-rules";
import { buildHeartVersion, insertHeartVersion } from "./heart-versions";

export { isHeartAction, resolveHeartStatusAction } from "./heart-registry-rules";
export type { HeartAction } from "./heart-registry-rules";

function nextDefinition(
  current: HeartDefinition,
  status: HeartDefinition["admin"]["status"],
  version: number,
  publishedAt: string | null,
  now: string,
): HeartDefinition {
  return {
    ...current,
    admin: { ...current.admin, status, version, publishedAt },
    timestamps: { ...current.timestamps, updatedAt: now },
  };
}

/**
 * Aplica una acción de ciclo de vida.
 *
 * La transición se valida contra la tabla de Fase 0. Republicar un Heart ya
 * publicado está permitido como nueva versión, no como transición de estado.
 */
export async function applyHeartStatusAction(
  id: string,
  action: HeartAction,
  actor: HeartActor,
  changeSummary = "",
): Promise<HeartRegistryResult<HeartRegistryRecord>> {
  if (!isHeartAction(action)) {
    return { ok: false, error: "Acción de estado inválida", status: 400 };
  }

  const currentResult = await getHeartDefinitionRecord(id, actor);
  if (!currentResult.ok) return currentResult;
  const current = currentResult.value;
  if (current.agentKey) {
    return {
      ok: false,
      error: "El agente oficial no cambia de estado desde el panel",
      status: 409,
    };
  }

  const target = resolveHeartStatusAction(current.definition.admin.status, action);
  if (!target) {
    return {
      ok: false,
      error: `Transición no permitida desde ${current.definition.admin.status}`,
      status: 409,
    };
  }

  const now = new Date().toISOString();
  // La primera publicación conserva la v1. Publicar desde un estado distinto
  // de draft, o republicar un Heart reactivado que ya tenía publicación
  // anterior, crea una versión nueva. Así nunca se repite un snapshot vN.
  const isRepublish =
    current.definition.admin.status !== "draft" ||
    current.definition.admin.publishedAt !== null;
  const version =
    action === "publish" && isRepublish
      ? current.definition.admin.version + 1
      : current.definition.admin.version;
  const publishedAt =
    action === "publish" ? now : current.definition.admin.publishedAt;
  const candidate = nextDefinition(
    current.definition,
    target,
    version,
    publishedAt,
    now,
  );
  const validated = validateHeartDefinition(candidate);
  if (!validated.ok) return { ok: false, error: validated.error, status: 400 };

  const applied = await withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE hearts
          SET status = $1, version = $2, published_at = $3, updated_at = NOW()
        WHERE id = $4 AND status = $5`,
      [
        validated.value.admin.status,
        version,
        validated.value.admin.publishedAt,
        id,
        current.definition.admin.status,
      ],
    );
    if ((updated.rowCount ?? 0) === 0) return false;

    if (action === "publish") {
      await insertHeartVersion(
        client,
        buildHeartVersion({
          definition: validated.value,
          authorId: actor.id,
          createdAt: now,
          changeSummary,
        }),
      );
    }
    return true;
  });

  if (!applied) {
    return { ok: false, error: "El Heart cambió de estado durante la operación", status: 409 };
  }

  await logAudit(
    actor.id,
    "heart_status_changed",
    `${action}: ${current.definition.admin.status} -> ${target} (v${version}) · ${candidate.identity.name}`,
  );
  const record = await loadHeartRecord(id);
  if (!record) return { ok: false, error: "No se pudo leer el Heart actualizado", status: 500 };
  return { ok: true, value: record };
}

export function publishHeartDefinition(
  id: string,
  actor: HeartActor,
  changeSummary = "",
): Promise<HeartRegistryResult<HeartRegistryRecord>> {
  return applyHeartStatusAction(id, "publish", actor, changeSummary);
}

export function pauseHeartDefinition(
  id: string,
  actor: HeartActor,
): Promise<HeartRegistryResult<HeartRegistryRecord>> {
  return applyHeartStatusAction(id, "pause", actor);
}

export function revokeHeartDefinition(
  id: string,
  actor: HeartActor,
): Promise<HeartRegistryResult<HeartRegistryRecord>> {
  return applyHeartStatusAction(id, "revoke", actor);
}

export function archiveHeartDefinition(
  id: string,
  actor: HeartActor,
): Promise<HeartRegistryResult<HeartRegistryRecord>> {
  return applyHeartStatusAction(id, "archive", actor);
}

/** Reactivación administrativa: `archived → draft`, auditada y sin versión nueva. */
export function reactivateHeartDefinition(
  id: string,
  actor: HeartActor,
): Promise<HeartRegistryResult<HeartRegistryRecord>> {
  return applyHeartStatusAction(id, "reactivate", actor);
}

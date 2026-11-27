/**
 * Resolución compartida del runtime de Hearts (Fase 2).
 *
 * El resolver es la única puerta que decide qué definición, modelo,
 * temperatura, prompt y herramientas efectivas usa una ejecución. No llama al
 * modelo ni ejecuta tools: entrega un `HeartExecution` listo para consumir.
 *
 * Reglas:
 * - Un Heart publicado ejecuta su último snapshot publicado. Las ediciones del
 *   panel que aún no se publicaron no cambian el comportamiento del usuario.
 * - Si un Heart histórico no tiene snapshot, se usa su definición actual como
 *   compatibilidad; nunca se amplía el ACL ni se inventan capacidades.
 * - Soporte conserva su prompt y su conjunto oficial de tools.
 * - El chat normal no tiene Heart ni ejecución y conserva todas las ramas.
 */

import type { Agent } from "@/types";
import type { HeartTool } from "./heart-config";
import {
  buildHeartExecution,
  type HeartExecution,
  type HeartExecutionActor,
  type HeartExecutionLimits,
  type HeartExecutionResult,
} from "./heart-execution";
import {
  isHeartUsable,
  type HeartDefinition,
} from "./heart-definition";
import {
  buildFallbackSupportDefinition,
  getOfficialSupportDefinition,
  loadHeartRecord,
} from "./heart-registry";
import { getHeartVersion } from "./heart-versions";
import { logAudit } from "./db";
import type { OfficialAgent } from "./official-agents";
import { buildHeartInstructionsFromDefinition } from "./prompt-builder";

export type ChatHeartRuntimeKind = "normal" | "support" | "heart";

export type ChatHeartRuntime = {
  kind: ChatHeartRuntimeKind;
  /** Definición efectiva; `null` en el chat normal. */
  definition: HeartDefinition | null;
  /** Ejecución configurada; `null` en chat normal y en Soporte. */
  execution: HeartExecution | null;
  model: string;
  /** `undefined` conserva la temperatura configurada por el entorno. */
  temperature: number | undefined;
  /** `null` significa que el chat normal conserva todas las ramas actuales. */
  allowedTools: HeartTool[] | null;
};

export type ChatHeartRuntimeResult =
  | { ok: true; runtime: ChatHeartRuntime }
  | { ok: false; error: string; status: 409 | 500 };

export type BuildHeartExecutionFromDefinitionInput = {
  definition: HeartDefinition;
  actor: HeartExecutionActor;
  chatId: string;
  defaultModel: string;
  requestedTools: readonly HeartTool[];
  executionId?: string;
  limits?: Partial<HeartExecutionLimits>;
};

/**
 * Construye la ejecución desde una definición ya resuelta. Es puro salvo por
 * `executionId`, que se puede inyectar para pruebas.
 */
export function buildHeartExecutionFromDefinition(
  input: BuildHeartExecutionFromDefinitionInput,
): HeartExecutionResult {
  return buildHeartExecution({
    executionId: input.executionId ?? crypto.randomUUID(),
    actor: input.actor,
    heart: input.definition,
    chatId: input.chatId,
    defaultModel: input.defaultModel,
    instructions: buildHeartInstructionsFromDefinition(input.definition),
    allowedTools: input.requestedTools,
    limits: input.limits,
  });
}

/**
 * Resuelve la definición que debe ejecutar un Heart publicado.
 *
 * Usa el snapshot de la versión vigente. Si el Heart es histórico y no tiene
 * snapshot, cae a la fila actual para no romper Hearts anteriores a la
 * migración 013. Devuelve `null` si el Heart no existe o no está publicado.
 */
export async function resolvePublishedHeartDefinition(
  heartId: string,
): Promise<HeartDefinition | null> {
  const record = await loadHeartRecord(heartId);
  if (!record || !isHeartUsable(record.definition.admin.status)) return null;

  try {
    const snapshot = await getHeartVersion(
      heartId,
      record.definition.admin.version,
    );
    if (snapshot && isHeartUsable(snapshot.snapshot.admin.status)) {
      return snapshot.snapshot;
    }
  } catch {
    // Compatibilidad con despliegues anteriores a la migración 013.
  }

  return record.definition;
}

/**
 * Resuelve el runtime completo de una petición de chat.
 *
 * Soporte y el chat normal no construyen `HeartExecution` para preservar su
 * comportamiento actual; un Heart sí, porque su definición publicada gobierna
 * modelo, temperatura, prompt y tools.
 */
export async function resolveChatHeartRuntime(input: {
  heart: Agent | null;
  supportAgent: OfficialAgent | null;
  actor: HeartExecutionActor;
  chatId: string;
  defaultModel: string;
  requestedTools: readonly HeartTool[];
}): Promise<ChatHeartRuntimeResult> {
  if (input.supportAgent) {
    const support = await getOfficialSupportDefinition();
    const definition = isHeartUsable(support.admin.status)
      ? support
      : buildFallbackSupportDefinition();

    return {
      ok: true,
      runtime: {
        kind: "support",
        definition,
        execution: null,
        model: input.defaultModel,
        temperature: undefined,
        allowedTools: ["read_files"],
      },
    };
  }

  if (!input.heart) {
    return {
      ok: true,
      runtime: {
        kind: "normal",
        definition: null,
        execution: null,
        model: input.defaultModel,
        temperature: undefined,
        allowedTools: null,
      },
    };
  }

  const definition = await resolvePublishedHeartDefinition(input.heart.id);
  if (!definition) {
    return { ok: false, error: "Heart no disponible", status: 409 };
  }

  const built = buildHeartExecutionFromDefinition({
    definition,
    actor: input.actor,
    chatId: input.chatId,
    defaultModel: input.defaultModel,
    requestedTools: input.requestedTools,
  });
  if (!built.ok) {
    return { ok: false, error: built.error, status: 409 };
  }

  try {
    await logAudit(
      input.actor.id,
      "heart_execution_started",
      `Heart ${definition.identity.name} (${definition.id}) v${definition.admin.version} · chat ${input.chatId} · exec ${built.execution.executionId} · modelo ${built.execution.model} · temp ${built.execution.temperature} · tools ${built.execution.allowedTools.join(", ") || "ninguna"}`,
    );
  } catch {
    // La auditoría no debe impedir una respuesta válida del Heart.
  }

  return {
    ok: true,
    runtime: {
      kind: "heart",
      definition,
      execution: built.execution,
      model: built.execution.model,
      temperature: built.execution.temperature,
      allowedTools: built.execution.allowedTools,
    },
  };
}

/**
 * Contrato de ejecución de un Heart (Fase 0).
 *
 * Este módulo no ejecuta el modelo ni consulta la base de datos. Define el
 * contexto que `lib/heart-resolver.ts` construye y que las rutas de chat
 * consumen, y fija las reglas de modelo, temperatura, herramientas autorizadas
 * y límites.
 */

import type { HeartTool } from "./heart-config";
import {
  isHeartUsable,
  type HeartDefinition,
} from "./heart-definition";

export type HeartExecutionActor = {
  id: string;
  role: string;
};

export type HeartExecutionLimits = {
  /** Máximo de pasos de razonamiento/tool calling por ejecución. */
  maxSteps: number;
  /** Tiempo máximo total de la ejecución en milisegundos. */
  timeoutMs: number;
  /** Máximo de tokens de salida del modelo. */
  maxOutputTokens: number;
};

export const DEFAULT_HEART_EXECUTION_LIMITS: HeartExecutionLimits = {
  maxSteps: 8,
  timeoutMs: 120_000,
  maxOutputTokens: 4096,
};

export type HeartExecution = {
  executionId: string;
  actor: HeartExecutionActor;
  heart: HeartDefinition;
  chatId: string;
  model: string;
  temperature: number;
  instructions: string;
  allowedTools: HeartTool[];
  knowledge: HeartDefinition["knowledge"];
  limits: HeartExecutionLimits;
  startedAt: string;
};

export type HeartExecutionResult =
  | { ok: true; execution: HeartExecution }
  | { ok: false; error: string };

export type BuildHeartExecutionInput = {
  executionId: string;
  actor: HeartExecutionActor;
  heart: HeartDefinition;
  chatId: string;
  /** Modelo actual del chat, usado cuando el Heart no declara uno. */
  defaultModel: string;
  instructions: string;
  /** Herramientas que el Runtime propone; se intersecan con las del Heart. */
  allowedTools: readonly HeartTool[];
  limits?: Partial<HeartExecutionLimits>;
  startedAt?: string;
};

/**
 * Resuelve el modelo efectivo.
 *
 * Un Heart sin modelo explícito conserva el modelo actual del chat. Esto evita
 * cambiar el comportamiento existente y permite introducir modelos por Heart
 * de forma gradual.
 */
export function resolveHeartModel(
  heart: HeartDefinition,
  defaultModel: string,
): string {
  return heart.model.name?.trim() || defaultModel.trim();
}

/**
 * Intersección entre las herramientas propuestas por el Runtime y las
 * declaradas por el Heart. El orden se conserva y no se permiten duplicados.
 */
export function resolveAllowedHeartTools(
  heart: HeartDefinition,
  requested: readonly HeartTool[],
): HeartTool[] {
  const declared = new Set(heart.capabilities.tools);
  const seen = new Set<HeartTool>();
  const allowed: HeartTool[] = [];

  for (const tool of requested) {
    if (!declared.has(tool) || seen.has(tool)) continue;
    seen.add(tool);
    allowed.push(tool);
  }

  return allowed;
}

function resolveLimits(
  partial?: Partial<HeartExecutionLimits>,
): HeartExecutionLimits | null {
  const merged = { ...DEFAULT_HEART_EXECUTION_LIMITS, ...partial };

  if (!Number.isInteger(merged.maxSteps) || merged.maxSteps < 1) return null;
  if (!Number.isFinite(merged.timeoutMs) || merged.timeoutMs < 1) return null;
  if (
    !Number.isInteger(merged.maxOutputTokens) ||
    merged.maxOutputTokens < 1
  ) {
    return null;
  }

  return merged;
}

/**
 * Construye el contrato de ejecución sin llamar al modelo.
 *
 * Devuelve un resultado discriminado en lugar de lanzar excepciones para que
 * el Runtime pueda responder con un error controlado y auditarlo.
 */
export function buildHeartExecution(
  input: BuildHeartExecutionInput,
): HeartExecutionResult {
  if (!isHeartUsable(input.heart.admin.status)) {
    return {
      ok: false,
      error: `Heart no ejecutable en estado "${input.heart.admin.status}".`,
    };
  }

  const model = resolveHeartModel(input.heart, input.defaultModel);
  if (!model) {
    return {
      ok: false,
      error: "No hay un modelo disponible para ejecutar el Heart.",
    };
  }

  const limits = resolveLimits(input.limits);
  if (!limits) {
    return {
      ok: false,
      error: "Los límites de ejecución no son válidos.",
    };
  }

  return {
    ok: true,
    execution: {
      executionId: input.executionId,
      actor: input.actor,
      heart: input.heart,
      chatId: input.chatId,
      model,
      temperature: input.heart.model.temperature,
      instructions: input.instructions,
      allowedTools: resolveAllowedHeartTools(input.heart, input.allowedTools),
      knowledge: input.heart.knowledge,
      limits,
      startedAt: input.startedAt ?? new Date().toISOString(),
    },
  };
}

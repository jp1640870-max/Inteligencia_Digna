/**
 * Logger estructurado para la aplicación.
 *
 * Uso:
 *   import { log } from "@/lib/logger";
 *   log.info({ userId, chatId }, "Mensaje enviado");
 *   log.warn({ userId }, "Rate limit接近");
 *   log.error({ err }, "Error en chat");
 *
 * Los logs salen en formato JSON → aptos para ingestión en Datadog, Grafana, etc.
 */

import pino from "pino";
import { env } from "@/lib/env";

// Nivel por defecto: info en prod, debug en dev
const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug");

export const log = pino({
  level: LOG_LEVEL,
  transport:
    process.env.NODE_ENV !== "production"
      ? {
          target: "pino/file",
          options: { destination: 1 }, // stdout
        }
      : undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ["req.headers.cookie", "req.headers.authorization", "password", "token", "secret"],
    censor: "[REDACTED]",
  },
});

/**
 * Crea un logger con contexto fijo (útil para agrupar logs de un request).
 *
 * Ejemplo:
 *   const reqLog = childLogger({ userId, chatId, model });
 *   reqLog.info("Inicio de streaming");
 *   reqLog.error({ err }, "Error en streaming");
 */
export function childLogger(bindings: Record<string, unknown>) {
  return log.child(bindings);
}

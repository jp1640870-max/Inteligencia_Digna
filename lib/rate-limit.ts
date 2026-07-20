/**
 * Rate Limiter simple en memoria.
 *
 * Usa ventana deslizante (sliding window) con contador.
 * Por defecto: 30 requests por minuto por usuario.
 *
 * Uso:
 *   import { rateLimit } from "@/lib/rate-limit";
 *
 *   const { allowed, remaining, resetIn } = rateLimit(userId);
 *   if (!allowed) {
 *     return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 });
 *   }
 */

import { log } from "@/lib/logger";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

const DEFAULT_LIMIT = 30;        // requests
const DEFAULT_WINDOW_MS = 60_000; // 1 minuto

// Limpieza periódica cada 5 minutos
const CLEANUP_INTERVAL = 5 * 60 * 1000;

function cleanup() {
  const now = Date.now();
  let deleted = 0;
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt <= now) {
      store.delete(key);
      deleted++;
    }
  }
  if (deleted > 0) {
    log.debug({ deleted }, "Rate limit cleanup");
  }
}

// Iniciar limpieza periódica
setInterval(cleanup, CLEANUP_INTERVAL);

// Limpiar el intervalo si el proceso termina
if (typeof process !== "undefined") {
  process.on("SIGTERM", () => {
    store.clear();
  });
  process.on("SIGINT", () => {
    store.clear();
  });
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number; // milisegundos hasta que se reinicia
  limit: number;
}

/**
 * Verifica rate limit para una clave (userId o IP).
 */
export function rateLimit(
  key: string,
  limit: number = DEFAULT_LIMIT,
  windowMs: number = DEFAULT_WINDOW_MS,
): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    // Nueva ventana
    store.set(key, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      remaining: limit - 1,
      resetIn: windowMs,
      limit,
    };
  }

  entry.count++;

  if (entry.count > limit) {
    log.warn({ key, count: entry.count, limit }, "Rate limit excedido");
    return {
      allowed: false,
      remaining: 0,
      resetIn: entry.resetAt - now,
      limit,
    };
  }

  return {
    allowed: true,
    remaining: limit - entry.count,
    resetIn: entry.resetAt - now,
    limit,
  };
}

/**
 * Middleware helper para API routes de Next.js.
 *
 * Uso:
 *   const rateCheck = checkRateLimit(userId);
 *   if (!rateCheck.allowed) {
 *     return NextResponse.json(
 *       { error: "Demasiadas solicitudes" },
 *       { status: 429, headers: rateCheck.headers }
 *     );
 *   }
 */
export function checkRateLimit(key: string, limit?: number, windowMs?: number) {
  const result = rateLimit(key, limit, windowMs);
  return {
    ...result,
    headers: {
      "X-RateLimit-Limit": String(result.limit),
      "X-RateLimit-Remaining": String(result.remaining),
      "X-RateLimit-Reset": String(Math.ceil(result.resetIn / 1000)),
      "Retry-After": String(Math.ceil(result.resetIn / 1000)),
    },
  };
}

/**
 * Rate limiting persistente para login y registro.
 *
 * El estado vive en la tabla `auth_rate_limits` (migración 012) y no en
 * memoria: así los bloqueos sobreviven a un reinicio y se comparten entre
 * instancias. Las funciones de este módulo son las únicas que deben tocar esa
 * tabla; las rutas solo preguntan si pueden pasar y registran el resultado.
 */

import { isIP } from "node:net";
import { query } from "@/lib/db-connection";

export type AuthRateLimitScope =
  | "login_ip"
  | "login_account"
  | "register_ip"
  | "register_email";

export type LoginRateLimitScope = Extract<AuthRateLimitScope, `login_${string}`>;
export type RegistrationRateLimitScope = Extract<AuthRateLimitScope, `register_${string}`>;

/** Tras una hora sin fallos, el contador de login vuelve a cero. */
export const LOGIN_RESET_MS = 60 * 60 * 1000;

/** Ventana fija de los límites de registro. */
export const REGISTER_WINDOW_MS = 60 * 60 * 1000;

/** Intentos de registro permitidos por IP y por email dentro de la ventana. */
export const REGISTER_IP_LIMIT = 5;
export const REGISTER_EMAIL_LIMIT = 3;

/**
 * Escalones del bloqueo progresivo de login.
 *
 * Se declaran de mayor a menor para que la búsqueda de duración sea directa.
 * El último escalón (40 fallos) es el tope de una hora.
 */
export const LOGIN_BLOCK_STEPS: ReadonlyArray<{ failures: number; blockMs: number }> = [
  { failures: 40, blockMs: 60 * 60 * 1000 },
  { failures: 20, blockMs: 15 * 60 * 1000 },
  { failures: 10, blockMs: 5 * 60 * 1000 },
  { failures: 5, blockMs: 60 * 1000 },
];

/** Primer umbral que bloquea una cuenta o una IP. */
export const LOGIN_FIRST_THRESHOLD = 5;

/** Escalones ordenados de menor a mayor, para construir la política SQL. */
const LOGIN_BLOCK_STEPS_ASC = [...LOGIN_BLOCK_STEPS].sort(
  (left, right) => left.failures - right.failures,
);

export type RateLimitState = {
  allowed: boolean;
  scope: AuthRateLimitScope;
  limit: number;
  remaining: number;
  /** Segundos que hay que esperar antes de reintentar (0 si está permitido). */
  retryAfterSeconds: number;
  /** Segundos hasta que la ventana o el bloqueo actual se reinician. */
  resetInSeconds: number;
};

type Timestamp = Date | string;

type LoginRow = {
  failures: number;
  level: number;
  last_failure_at: Timestamp;
  blocked_until: Timestamp | null;
};

type RegistrationRow = {
  failures: number;
  window_started_at: Timestamp;
  blocked_until: Timestamp | null;
};

function timestampMs(value: Timestamp | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function secondsUntil(targetMs: number, now: number): number {
  return Math.max(0, Math.ceil((targetMs - now) / 1000));
}

/** Normaliza la clave de cuenta igual que `getUserByEmail` (trim + minúsculas). */
export function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Duración del bloqueo de login para un número de fallos.
 *
 * 5/10/20 fallos → 1/5/15 min; a partir de 40 el tope es 1 h.
 */
export function loginBlockDurationMs(failures: number): number {
  for (const step of LOGIN_BLOCK_STEPS) {
    if (failures >= step.failures) return step.blockMs;
  }
  return 0;
}

/** Número de escalones superados; se guarda en `level` para diagnóstico. */
export function loginBlockLevel(failures: number): number {
  return LOGIN_BLOCK_STEPS.filter((step) => failures >= step.failures).length;
}

function normalizeIp(value: string): string | null {
  let candidate = value.trim().toLowerCase();
  if (!candidate) return null;

  if (candidate.startsWith("[")) {
    const end = candidate.indexOf("]");
    if (end !== -1) candidate = candidate.slice(1, end);
  } else if (isIP(candidate) === 0) {
    // IPv4 con puerto (`1.2.3.4:443`). En IPv6 hay más de un `:` y no se toca.
    const firstColon = candidate.indexOf(":");
    const lastColon = candidate.lastIndexOf(":");
    if (firstColon !== -1 && firstColon === lastColon) {
      candidate = candidate.slice(0, firstColon);
    }
  }

  const zone = candidate.indexOf("%");
  if (zone !== -1) candidate = candidate.slice(0, zone);

  return isIP(candidate) ? candidate : null;
}

/**
 * Extrae la IP de `X-Forwarded-For`.
 *
 * Se toma el último valor válido, no el primero: el proxy inmediato (Caddy en
 * el compose del proyecto) añade la IP real al final de la cabecera, así que
 * un valor inventado por el cliente al principio no puede elegir la clave.
 * La aplicación debe seguir escuchando solo en loopback o detrás del proxy;
 * si se expone directamente, esta cabecera deja de ser confiable.
 */
export function getClientIpFromForwardedFor(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const parts = value.split(",");
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const ip = normalizeIp(parts[index]);
    if (ip) return ip;
  }
  return null;
}

/** IP del cliente con fallback a `X-Real-IP`; `unknown` si no hay ninguna. */
export function getClientIp(headers: Headers): string {
  const forwarded = getClientIpFromForwardedFor(headers.get("x-forwarded-for"));
  if (forwarded) return forwarded;
  return normalizeIp(headers.get("x-real-ip") ?? "") ?? "unknown";
}

export function rateLimitErrorMessage(retryAfterSeconds: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  if (seconds < 60) {
    return `Demasiados intentos. Inténtalo de nuevo en ${seconds} s.`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `Demasiados intentos. Inténtalo de nuevo en ${minutes} min.`;
}

export function rateLimitHeaders(state: RateLimitState): Record<string, string> {
  return {
    "Retry-After": String(Math.max(0, state.retryAfterSeconds)),
    "X-RateLimit-Limit": String(state.limit),
    "X-RateLimit-Remaining": String(state.remaining),
    "X-RateLimit-Reset": String(Math.max(0, state.resetInSeconds)),
  };
}

/** Devuelve el bloqueo más largo entre varios estados, si hay alguno. */
export function mostRestrictiveBlock(
  ...states: Array<RateLimitState | null | undefined>
): RateLimitState | null {
  let blocked: RateLimitState | null = null;
  for (const state of states) {
    if (!state || state.allowed) continue;
    if (!blocked || state.retryAfterSeconds > blocked.retryAfterSeconds) {
      blocked = state;
    }
  }
  return blocked;
}

/**
 * ¿Puede intentarse un login con esta IP o esta cuenta?
 *
 * No incrementa contadores: eso ocurre solo cuando el intento falla.
 */
export async function checkLoginLimit(
  scope: LoginRateLimitScope,
  identifier: string,
): Promise<RateLimitState> {
  const result = await query<LoginRow>(
    `SELECT failures, level, last_failure_at, blocked_until
       FROM auth_rate_limits
      WHERE scope = $1 AND identifier = $2
      LIMIT 1`,
    [scope, identifier],
  );
  const row = result.rows[0];
  const now = Date.now();
  const blockedUntil = timestampMs(row?.blocked_until);

  if (blockedUntil !== null && blockedUntil > now) {
    const retryAfterSeconds = secondsUntil(blockedUntil, now);
    return {
      allowed: false,
      scope,
      limit: LOGIN_FIRST_THRESHOLD,
      remaining: 0,
      retryAfterSeconds,
      resetInSeconds: retryAfterSeconds,
    };
  }

  if (!row) {
    return {
      allowed: true,
      scope,
      limit: LOGIN_FIRST_THRESHOLD,
      remaining: LOGIN_FIRST_THRESHOLD,
      retryAfterSeconds: 0,
      resetInSeconds: 0,
    };
  }

  const lastFailure = timestampMs(row.last_failure_at);
  const inactive =
    lastFailure !== null && now - lastFailure >= LOGIN_RESET_MS;
  const failures = inactive ? 0 : row.failures;

  return {
    allowed: true,
    scope,
    limit: LOGIN_FIRST_THRESHOLD,
    remaining: Math.max(0, LOGIN_FIRST_THRESHOLD - failures),
    retryAfterSeconds: 0,
    resetInSeconds:
      !inactive && lastFailure !== null
        ? secondsUntil(lastFailure + LOGIN_RESET_MS, now)
        : 0,
  };
}

/**
 * Registra un fallo de login y aplica el bloqueo progresivo.
 *
 * Todo se escribe en el mismo `INSERT ... ON CONFLICT`: un `UPDATE` posterior
 * sobre la misma fila vería el snapshot anterior al upsert y revertiría el
 * incremento de `failures`/`last_failure_at`.
 */
export async function recordLoginFailure(
  scope: LoginRateLimitScope,
  identifier: string,
): Promise<RateLimitState> {
  const policyValues: string[] = [];
  const policyParams: number[] = [];
  LOGIN_BLOCK_STEPS_ASC.forEach((step, index) => {
    policyValues.push(
      `($${4 + index * 2}::int, $${5 + index * 2}::int, ${index + 1})`,
    );
    policyParams.push(step.failures, step.blockMs);
  });

  const result = await query<{
    failures: number;
    level: number;
    blocked_until: Timestamp | null;
  }>(
    `WITH policy(failures_threshold, block_ms, level) AS (
       VALUES ${policyValues.join(", ")}
     )
     INSERT INTO auth_rate_limits
       (scope, identifier, failures, level, window_started_at, last_failure_at, blocked_until, updated_at)
     VALUES ($1, $2, 1, 0, NOW(), NOW(), NULL, NOW())
     ON CONFLICT (scope, identifier) DO UPDATE SET
       failures = CASE
         WHEN auth_rate_limits.last_failure_at <= NOW() - ($3::int * INTERVAL '1 millisecond')
           THEN 1
         ELSE auth_rate_limits.failures + 1
       END,
       window_started_at = CASE
         WHEN auth_rate_limits.last_failure_at <= NOW() - ($3::int * INTERVAL '1 millisecond')
           THEN NOW()
         ELSE auth_rate_limits.window_started_at
       END,
       last_failure_at = NOW(),
       level = COALESCE(
         (
           SELECT MAX(p.level)
             FROM policy p
            WHERE (
              CASE
                WHEN auth_rate_limits.last_failure_at <= NOW() - ($3::int * INTERVAL '1 millisecond')
                  THEN 1
                ELSE auth_rate_limits.failures + 1
              END
            ) >= p.failures_threshold
         ),
         0
       ),
       blocked_until = (
         SELECT NOW() + (p.block_ms * INTERVAL '1 millisecond')
           FROM policy p
          WHERE (
            CASE
              WHEN auth_rate_limits.last_failure_at <= NOW() - ($3::int * INTERVAL '1 millisecond')
                THEN 1
              ELSE auth_rate_limits.failures + 1
            END
          ) >= p.failures_threshold
          ORDER BY p.failures_threshold DESC
          LIMIT 1
       ),
       updated_at = NOW()
     RETURNING failures, level, blocked_until`,
    [scope, identifier, LOGIN_RESET_MS, ...policyParams],
  );

  void cleanupIfDue();

  const row = result.rows[0];
  const failures = row?.failures ?? 1;
  const blockedUntil = timestampMs(row?.blocked_until);
  const now = Date.now();
  const blocked = blockedUntil !== null && blockedUntil > now;
  const retryAfterSeconds =
    blocked && blockedUntil !== null ? secondsUntil(blockedUntil, now) : 0;

  return {
    allowed: !blocked,
    scope,
    limit: LOGIN_FIRST_THRESHOLD,
    remaining: Math.max(0, LOGIN_FIRST_THRESHOLD - failures),
    retryAfterSeconds,
    resetInSeconds: blocked ? retryAfterSeconds : Math.ceil(LOGIN_RESET_MS / 1000),
  };
}

/** Un login correcto limpia los contadores de IP y cuenta. */
export async function recordLoginSuccess(
  scope: LoginRateLimitScope,
  identifier: string,
): Promise<void> {
  await query(
    "DELETE FROM auth_rate_limits WHERE scope = $1 AND identifier = $2",
    [scope, identifier],
  );
}

/**
 * ¿Queda cupo en la ventana de registro?
 *
 * No consume el intento; el consumo atómico lo hace
 * {@link consumeRegistrationAttempt} después de validar el cuerpo.
 */
export async function checkRegistrationLimit(
  scope: RegistrationRateLimitScope,
  identifier: string,
  limit: number,
  windowMs: number = REGISTER_WINDOW_MS,
): Promise<RateLimitState> {
  const result = await query<RegistrationRow>(
    `SELECT failures, window_started_at, blocked_until
       FROM auth_rate_limits
      WHERE scope = $1 AND identifier = $2
      LIMIT 1`,
    [scope, identifier],
  );
  const row = result.rows[0];
  const now = Date.now();

  if (!row) {
    return {
      allowed: true,
      scope,
      limit,
      remaining: limit,
      retryAfterSeconds: 0,
      resetInSeconds: 0,
    };
  }

  const blockedUntil = timestampMs(row.blocked_until);
  if (blockedUntil !== null && blockedUntil > now) {
    const retryAfterSeconds = secondsUntil(blockedUntil, now);
    return {
      allowed: false,
      scope,
      limit,
      remaining: 0,
      retryAfterSeconds,
      resetInSeconds: retryAfterSeconds,
    };
  }

  const windowStart = timestampMs(row.window_started_at) ?? now;
  const windowEnd = windowStart + windowMs;
  const windowExpired = windowEnd <= now;
  const used = windowExpired ? 0 : row.failures;
  const allowed = used < limit;

  return {
    allowed,
    scope,
    limit,
    remaining: Math.max(0, limit - used),
    retryAfterSeconds: allowed ? 0 : secondsUntil(windowEnd, now),
    resetInSeconds: windowExpired ? 0 : secondsUntil(windowEnd, now),
  };
}

/**
 * Consume un intento de registro de forma atómica.
 *
 * El primer intento de una ventana crea la fila; los siguientes incrementan el
 * contador. Al superar `limit` se fija `blocked_until` hasta el final de la
 * ventana. Devuelve `allowed: false` para el intento que cruza el límite.
 */
export async function consumeRegistrationAttempt(
  scope: RegistrationRateLimitScope,
  identifier: string,
  limit: number,
  windowMs: number = REGISTER_WINDOW_MS,
): Promise<RateLimitState> {
  const result = await query<{
    failures: number;
    blocked_until: Timestamp | null;
    window_started_at: Timestamp;
  }>(
    `INSERT INTO auth_rate_limits
       (scope, identifier, failures, level, window_started_at, last_failure_at, blocked_until, updated_at)
     VALUES ($1, $2, 1, 0, NOW(), NOW(), NULL, NOW())
     ON CONFLICT (scope, identifier) DO UPDATE SET
       failures = CASE
         WHEN auth_rate_limits.window_started_at <= NOW() - ($3::int * INTERVAL '1 millisecond')
           THEN 1
         ELSE auth_rate_limits.failures + 1
       END,
       window_started_at = CASE
         WHEN auth_rate_limits.window_started_at <= NOW() - ($3::int * INTERVAL '1 millisecond')
           THEN NOW()
         ELSE auth_rate_limits.window_started_at
       END,
       last_failure_at = NOW(),
       blocked_until = CASE
         WHEN auth_rate_limits.blocked_until IS NOT NULL
              AND auth_rate_limits.blocked_until > NOW()
           THEN auth_rate_limits.blocked_until
         WHEN (
           CASE
             WHEN auth_rate_limits.window_started_at <= NOW() - ($3::int * INTERVAL '1 millisecond')
               THEN 1
             ELSE auth_rate_limits.failures + 1
           END
         ) > $4
           THEN (
             CASE
               WHEN auth_rate_limits.window_started_at <= NOW() - ($3::int * INTERVAL '1 millisecond')
                 THEN NOW()
               ELSE auth_rate_limits.window_started_at
             END
           ) + ($3::int * INTERVAL '1 millisecond')
         ELSE NULL
       END,
       updated_at = NOW()
     RETURNING failures, blocked_until, window_started_at`,
    [scope, identifier, windowMs, limit],
  );

  void cleanupIfDue();

  const row = result.rows[0];
  const failures = row?.failures ?? 1;
  const blockedUntil = timestampMs(row?.blocked_until);
  const now = Date.now();
  const blocked = blockedUntil !== null && blockedUntil > now;
  const windowStart = timestampMs(row?.window_started_at) ?? now;
  const windowEnd = windowStart + windowMs;

  return {
    allowed: !blocked,
    scope,
    limit,
    remaining: Math.max(0, limit - failures),
    retryAfterSeconds:
      blocked && blockedUntil !== null ? secondsUntil(blockedUntil, now) : 0,
    resetInSeconds: secondsUntil(windowEnd, now),
  };
}

/**
 * Borra contadores viejos que ya no bloquean a nadie.
 *
 * No hay cron: se llama como máximo una vez por hora desde las funciones que
 * registran intentos. Un fallo de limpieza nunca debe romper la autenticación.
 */
export async function cleanupAuthRateLimits(
  retentionMs: number = 24 * 60 * 60 * 1000,
): Promise<number> {
  const result = await query(
    `DELETE FROM auth_rate_limits
      WHERE updated_at <= NOW() - ($1::int * INTERVAL '1 millisecond')
        AND (blocked_until IS NULL OR blocked_until <= NOW())`,
    [retentionMs],
  );
  return result.rowCount ?? 0;
}

let lastCleanupAt = 0;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

async function cleanupIfDue(): Promise<void> {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;
  try {
    await cleanupAuthRateLimits();
  } catch {
    // La limpieza es best-effort: no debe afectar al login ni al registro.
  }
}

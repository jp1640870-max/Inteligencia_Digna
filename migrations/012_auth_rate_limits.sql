-- Estado persistente para el rate limiting de autenticación.
--
-- Vive en PostgreSQL y no en memoria para que los bloqueos sobrevivan a un
-- reinicio y se compartan entre instancias. Cada fila es un contador por
-- `scope` + `identifier`:
--   login_ip / login_account      fallos progresivos de inicio de sesión
--   register_ip / register_email  ventana fija de intentos de registro
--
-- `blocked_until` es la única fuente de verdad para responder 429. Las filas
-- vencidas se limpian de forma oportunista desde `lib/auth-rate-limit.ts`.

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  scope TEXT NOT NULL
    CHECK (scope IN ('login_ip', 'login_account', 'register_ip', 'register_email')),
  identifier TEXT NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
  level INTEGER NOT NULL DEFAULT 0 CHECK (level >= 0),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_failure_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, identifier)
);

CREATE INDEX IF NOT EXISTS auth_rate_limits_blocked_until_idx
  ON auth_rate_limits (blocked_until)
  WHERE blocked_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS auth_rate_limits_updated_at_idx
  ON auth_rate_limits (updated_at);

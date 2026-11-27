-- Fase 1: definición tipada, ciclo de vida y versionado de Hearts.
--
-- Migración aditiva y idempotente. Los Hearts existentes quedan publicados en
-- la versión 1 para que el comportamiento observable no cambie. El runtime no
-- lee estas columnas todavía: su aplicación se reserva para fases posteriores.

ALTER TABLE hearts
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

ALTER TABLE hearts
  ADD COLUMN IF NOT EXISTS model TEXT;

ALTER TABLE hearts
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published';

ALTER TABLE hearts
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE hearts
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'hearts_status_check'
       AND conrelid = 'hearts'::regclass
  ) THEN
    ALTER TABLE hearts
      ADD CONSTRAINT hearts_status_check
      CHECK (status IN ('draft', 'published', 'paused', 'revoked', 'archived'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'hearts_version_check'
       AND conrelid = 'hearts'::regclass
  ) THEN
    ALTER TABLE hearts
      ADD CONSTRAINT hearts_version_check
      CHECK (version >= 1);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'hearts_description_check'
       AND conrelid = 'hearts'::regclass
  ) THEN
    ALTER TABLE hearts
      ADD CONSTRAINT hearts_description_check
      CHECK (char_length(description) <= 500);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'hearts_model_check'
       AND conrelid = 'hearts'::regclass
  ) THEN
    ALTER TABLE hearts
      ADD CONSTRAINT hearts_model_check
      CHECK (model IS NULL OR char_length(model) <= 120);
  END IF;
END $$;

-- Backfill defensivo: los defaults cubren las filas nuevas, pero la migración
-- debe ser idempotente si alguna fila se insertó con NULL.
UPDATE hearts SET description = '' WHERE description IS NULL;
UPDATE hearts SET status = 'published' WHERE status IS NULL;
UPDATE hearts SET version = 1 WHERE version IS NULL;

-- Un Heart publicado necesita una fecha de publicación coherente. Las filas
-- anteriores a esta migración se tratan como publicadas desde su creación.
UPDATE hearts
   SET published_at = COALESCE(published_at, created_at)
 WHERE status = 'published';

-- El agente oficial queda publicado y versionado. No se duplica: el índice
-- único de agent_key de la migración 011 sigue vigente.
UPDATE hearts
   SET status = 'published',
       version = GREATEST(version, 1),
       published_at = COALESCE(published_at, created_at)
 WHERE agent_key = 'soporte-tecnico-oficial';

CREATE INDEX IF NOT EXISTS hearts_status_idx
  ON hearts (status);

CREATE INDEX IF NOT EXISTS hearts_scope_status_idx
  ON hearts (scope, status);

-- Snapshots inmutables. `author_id` es texto a propósito: la auditoría debe
-- conservar el identificador del autor aunque el usuario se elimine después.
CREATE TABLE IF NOT EXISTS heart_versions (
  heart_id UUID NOT NULL REFERENCES hearts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  snapshot JSONB NOT NULL,
  author_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_summary TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (heart_id, version),
  CONSTRAINT heart_versions_author_id_check CHECK (char_length(author_id) > 0),
  CONSTRAINT heart_versions_change_summary_check CHECK (char_length(change_summary) <= 500)
);

CREATE INDEX IF NOT EXISTS heart_versions_author_idx
  ON heart_versions (author_id);

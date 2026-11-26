-- Separación explícita entre Hearts personales y Hearts de empresa.
--
-- `is_preset`/`is_public` se conservan por compatibilidad y para reportes, pero
-- la fuente de verdad de permisos y visibilidad pasa a ser `scope`.
-- Los chats de agentes usan `chats.heart_id`; `chats.agent_key` se mantiene
-- para el comportamiento especial de agentes oficiales y compatibilidad.

ALTER TABLE hearts
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'personal';

ALTER TABLE hearts
  ADD COLUMN IF NOT EXISTS agent_key TEXT;

ALTER TABLE hearts
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'hearts_scope_check'
       AND conrelid = 'hearts'::regclass
  ) THEN
    ALTER TABLE hearts
      ADD CONSTRAINT hearts_scope_check
      CHECK (scope IN ('personal', 'company'));
  END IF;
END $$;

-- Los Hearts que ya eran presets o públicos son de empresa.
UPDATE hearts
   SET scope = 'company'
 WHERE is_preset = TRUE OR is_public = TRUE;

-- Vincular el Heart de Soporte existente con el agente oficial. Se elige el
-- preset más reciente que parezca de soporte para no duplicar la tarjeta.
UPDATE hearts
   SET scope = 'company',
       agent_key = 'soporte-tecnico-oficial',
       is_preset = TRUE
 WHERE id = (
   SELECT id
     FROM hearts
    WHERE is_preset = TRUE
      AND (
        name ILIKE '%soporte%'
        OR role ILIKE '%soporte%'
        OR instructions ILIKE '%soporte%'
      )
    ORDER BY updated_at DESC
    LIMIT 1
 )
   AND NOT EXISTS (
     SELECT 1
       FROM hearts
      WHERE agent_key = 'soporte-tecnico-oficial'
   );

-- Si el vínculo ya existía, asegurar que sea de empresa.
UPDATE hearts
   SET scope = 'company',
       is_preset = TRUE
 WHERE agent_key = 'soporte-tecnico-oficial';

CREATE UNIQUE INDEX IF NOT EXISTS hearts_agent_key_uidx
  ON hearts (agent_key)
  WHERE agent_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS hearts_scope_idx
  ON hearts (scope);

CREATE INDEX IF NOT EXISTS hearts_is_featured_idx
  ON hearts (is_featured)
  WHERE is_featured = TRUE;

CREATE TABLE IF NOT EXISTS user_heart_pins (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  heart_id UUID NOT NULL REFERENCES hearts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, heart_id)
);

CREATE INDEX IF NOT EXISTS user_heart_pins_heart_id_idx
  ON user_heart_pins (heart_id);

-- Los chats existentes de Soporte pasan a estar vinculados al Heart.
UPDATE chats c
   SET heart_id = h.id
  FROM hearts h
 WHERE h.agent_key = 'soporte-tecnico-oficial'
   AND c.agent_key = 'soporte-tecnico-oficial'
   AND c.heart_id IS NULL;

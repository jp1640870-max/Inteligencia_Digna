# 03 — Estrategia de migración (Fase 1)

> **Aplicada en Fase 1.** La migración `013` quedó reservada en Fase 0 y se
> ejecutó con `npm run db:migrate` durante la Fase 1. El SQL completo vive en
> `migrations/013_heart_definition.sql`; aquí se resume su contrato.

## 1. Objetivo

Añadir a `hearts` los campos que el contrato `HeartDefinition` ya tipa, sin
romper filas existentes ni cambiar el comportamiento actual:

| Campo | Tipo | Default | Uso |
| --- | --- | --- | --- |
| `description` | `TEXT` | `''` | Identidad del Heart. |
| `model` | `TEXT NULL` | `NULL` | Modelo local; `NULL` = modelo actual del chat. |
| `status` | `TEXT` | `'published'` | Ciclo de vida. |
| `version` | `INTEGER` | `1` | Versión de la definición. |
| `published_at` | `TIMESTAMPTZ NULL` | `NULL` | Última publicación; se rellena al publicar. |

Además se crea `heart_versions`, con clave primaria `(heart_id, version)`,
`snapshot JSONB`, `author_id`, `created_at` y `change_summary`, y borrado en
cascada al eliminar el Heart.

No se introduce un JSON monolítico. La definición sigue siendo una vista tipada
sobre columnas planas para mantener consultas, índices y compatibilidad.

## 2. SQL aplicado (extracto)

```sql
-- 013_heart_definition.sql
-- Fase 1: campos de definición, ciclo de vida y versionado.

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

-- Backfill defensivo. Los defaults ya cubren filas nuevas, pero la migración
-- debe ser idempotente si alguna fila se insertó con NULL.
UPDATE hearts SET description = '' WHERE description IS NULL;
UPDATE hearts SET status = 'published' WHERE status IS NULL;
UPDATE hearts SET version = 1 WHERE version IS NULL;

-- Los Hearts ya publicados se tratan como publicados desde su creación.
UPDATE hearts
   SET published_at = COALESCE(published_at, created_at)
 WHERE status = 'published';

-- El agente oficial queda publicado y versionado.
UPDATE hearts
   SET status = 'published',
       version = GREATEST(version, 1),
       published_at = COALESCE(published_at, created_at)
 WHERE agent_key = 'soporte-tecnico-oficial';

CREATE INDEX IF NOT EXISTS hearts_status_idx
  ON hearts (status);

CREATE INDEX IF NOT EXISTS hearts_scope_status_idx
  ON hearts (scope, status);

-- Snapshots inmutables; `author_id` es texto para conservar la auditoría aunque
-- el usuario se elimine después.
CREATE TABLE IF NOT EXISTS heart_versions (
  heart_id UUID NOT NULL REFERENCES hearts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  snapshot JSONB NOT NULL,
  author_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_summary TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (heart_id, version)
);
```

## 3. Compatibilidad

- Las filas existentes quedan en `status = 'published'`, así que el
  comportamiento actual no cambia.
- `model = NULL` conserva el modelo actual del chat.
- `description = ''` no altera el prompt actual.
- `version = 1` es solo metadato; no cambia la ejecución.
- `is_preset`, `is_public`, `scope`, `agent_key` e `is_featured` se mantienen.
- No se toca `chats.heart_id` ni `chats.agent_key`.
- No se toca KB, RAG, ACL ni embeddings.

## 4. Orden de despliegue

1. **Backup** de `hearts` y `chats` (o snapshot de base).
2. Ejecutar `npm run db:migrate` con la migración `013` aprobada.
3. Verificar conteos y constraints:
   ```sql
   SELECT status, COUNT(*) FROM hearts GROUP BY status;
   SELECT COUNT(*) FROM hearts WHERE version < 1;
   SELECT COUNT(*) FROM hearts WHERE agent_key = 'soporte-tecnico-oficial' AND status <> 'published';
   ```
4. Desplegar el código que lee `description`, `model`, `status` y `version`.
5. Mantener el fallback de `toHeartDefinition` para filas antiguas o entornos
   que aún no hayan migrado.

## 5. Rollback

El rollback de esquema es destructivo si ya hay datos en las columnas nuevas.
Antes de revertir:

1. Exportar `description`, `model`, `status`, `version`, `published_at` y
   `heart_versions`.
2. Revertir el código al punto anterior.
3. Solo entonces eliminar columnas, si es imprescindible:
   ```sql
   ALTER TABLE hearts DROP CONSTRAINT IF EXISTS hearts_status_check;
   ALTER TABLE hearts DROP CONSTRAINT IF EXISTS hearts_version_check;
   ALTER TABLE hearts DROP CONSTRAINT IF EXISTS hearts_description_check;
   ALTER TABLE hearts DROP CONSTRAINT IF EXISTS hearts_model_check;
   DROP INDEX IF EXISTS hearts_status_idx;
   DROP INDEX IF EXISTS hearts_scope_status_idx;
   ALTER TABLE hearts DROP COLUMN IF EXISTS description;
   ALTER TABLE hearts DROP COLUMN IF EXISTS model;
   ALTER TABLE hearts DROP COLUMN IF EXISTS status;
   ALTER TABLE hearts DROP COLUMN IF EXISTS version;
   ALTER TABLE hearts DROP COLUMN IF EXISTS published_at;
   DROP TABLE IF EXISTS heart_versions;
   ```

## 6. Qué no incluye `013`

- No crea `heart_tools` normalizada. Las tools siguen en `tools` JSONB.
- No crea `heart_knowledge_sources`. El conocimiento sigue siendo
  `platform_acl`.
- No crea permisos por área ni `hearts.use`.
- No cambia el catálogo de tools ni el Tool Gateway.
- No cambia el runtime en la migración: el resolver de Fase 2 consume `model`,
  `status` y `version` después de aplicarla.
- No crea tickets reales ni integración con ServiceDesk.

## 7. Pruebas de migración

Ejecutadas en Fase 1 y Fase 2 con la base migrada:

1. `npm test`: 350 pruebas unitarias, 0 fallos.
2. `npm run test:db`: 386 pruebas (unitarias + base de datos), 0 fallos.
3. `tests/hearts-db.test.ts` sigue verificando la separación personal/empresa.
4. `toHeartDefinition` lee filas anteriores y nuevas con defaults seguros.
5. El agente oficial sigue siendo `company`, `published` y único.
6. Expansión de Fase 1: verificado que un Heart `paused` o `archived` no se
   lista ni resuelve para usuarios (`tests/hearts-db.test.ts`), y que un
   `archived` puede reactivarse a `draft` y republicarse sin repetir versión.
7. Fase 2: verificado que el resolver usa el snapshot publicado y no la edición
   sin publicar, que aplica modelo/temperatura/tools y que Soporte conserva su
   runtime (`tests/heart-resolver.test.ts`, `tests/heart-registry-db.test.ts`).

## 8. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Migración aplicada sin backup | Backup obligatorio y ventana de mantenimiento. |
| Código nuevo lee columnas antes de migrar | `toHeartDefinition` usa defaults; desplegar después de migrar. |
| Filas con `status` inválido | Constraint + backfill + verificación. |
| Duplicación del agente oficial | Índice único existente `hearts_agent_key_uidx`. |
| Rollback con pérdida de datos | Exportar columnas nuevas antes de revertir. |
| Divergencia chat/regenerate | Resuelta en Fase 2 con `lib/heart-resolver.ts`; ambas rutas comparten resolución. |

-- RBAC de Knowledge Base.
--
-- Ejes separados a propósito:
--   Rol   -> qué se puede hacer en el sistema (capacidades).
--   Área  -> dónde está la persona en la organización (acceso KB por defecto).
--   Grupo -> con quién comparte por excepción, aunque sea de otra área.
--
-- Los grupos y áreas SOLO otorgan acceso a la KB. Nunca capacidades.
-- El acceso a un archivo es explícito (fail closed): sin grant, nadie lo lee.
-- `kb_categories` queda fuera de la decisión de acceso: es clasificación para
-- el dashboard y el vocabulario de las acciones en lote.

-- ─── Áreas ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  parent_id UUID REFERENCES areas(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','google')),
  external_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS areas_parent_id_idx ON areas (parent_id);
-- Habilita la sincronización futura con Google sin cambiar el esquema.
CREATE UNIQUE INDEX IF NOT EXISTS areas_external_id_uidx
  ON areas (source, external_id) WHERE external_id IS NOT NULL;

-- Un usuario puede pertenecer a varias áreas (p. ej. una matriz).
CREATE TABLE IF NOT EXISTS area_members (
  area_id UUID NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (area_id, user_id)
);

--índice inverso: "en qué áreas está este usuario?"
CREATE INDEX IF NOT EXISTS area_members_user_id_idx ON area_members (user_id);

-- ─── Grupos ──────────────────────────────────────────────────────────────────
--
-- Se llaman `user_groups` y no `groups` porque GROUPS es palabra clave en
-- PostgreSQL (window frames) y genera ambigüedad y comillas en cada consulta.

CREATE TABLE IF NOT EXISTS user_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','google')),
  external_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_groups_external_id_uidx
  ON user_groups (source, external_id) WHERE external_id IS NOT NULL;

-- La relación N:N que permite compartir permisos entre áreas distintas.
CREATE TABLE IF NOT EXISTS user_group_members (
  group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS user_group_members_user_id_idx ON user_group_members (user_id);

-- ─── Grants de acceso a la Knowledge Base ────────────────────────────────────
--
-- `principal_id` no lleva foreign key porque es polimórfico (area o group) y
-- PostgreSQL no admite FK polimórfica. El precio es que borrar un área deja
-- filas huérfanas; por eso áreas y grupos se desactivan (is_active=false) en
-- lugar de borrarse, conservando el rastro de auditoría.

CREATE TABLE IF NOT EXISTS kb_access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_type TEXT NOT NULL CHECK (principal_type IN ('area','group')),
  principal_id UUID NOT NULL,
  kb_file_id UUID NOT NULL REFERENCES kb_files(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'read' CHECK (permission IN ('read')),
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (principal_type, principal_id, kb_file_id)
);

CREATE INDEX IF NOT EXISTS kb_access_grants_file_idx ON kb_access_grants (kb_file_id);
CREATE INDEX IF NOT EXISTS kb_access_grants_principal_idx
  ON kb_access_grants (principal_type, principal_id);

-- ─── Cola de revisión de documentos ──────────────────────────────────────────
--
-- Un archivo recién subido no es buscable hasta que alguien lo aprueba. Esto
-- reduce la superficie de inyección de prompt y da el control de gestión de
-- cambios (CC8.1).

ALTER TABLE kb_files DROP CONSTRAINT IF EXISTS kb_files_status_check;
ALTER TABLE kb_files ADD CONSTRAINT kb_files_status_check
  CHECK (status IN ('processing','pending_review','active','hold'));

-- ─── Recorte de roles ───────────────────────────────────────────────────────
--
-- viewer, power_user y restricted prometen controles que el código nunca
-- implementó. Un tipo que miente es peor que un tipo que no existe.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users
              WHERE role IN ('viewer','power_user','restricted')) THEN
    RAISE EXCEPTION
      'Hay usuarios con roles que esta migración elimina (viewer, power_user, restricted). '
      'Reasígnalos a super_admin, admin, editor o user antes de aplicar 003_rbac.sql.';
  END IF;
END $$;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('super_admin','admin','editor','user'));

-- ─── Área General de arranque ────────────────────────────────────────────────
--
-- Migración sin sorpresas: antes de este trabajo `getKbScopeIdsForUser()`
-- devolvía TODAS las categorías sin filtro. Activar el ACL sin sembrar esto
-- dejaría a los usuarios sin Knowledge Base de golpe.
--
-- El área General contendrá a todos los usuarios actuales y tendrá grant sobre
-- los archivos ya activos, de modo que el comportamiento tras migrar es
-- idéntico al previo. A partir de aquí el administrador recorta.

INSERT INTO areas (key, name, description, is_active)
VALUES (
  'general',
  'General',
  'Área por defecto de arranque. Da acceso a la Knowledge Base a todos los usuarios actuales. Reducir su alcance desde el panel de accesos.',
  TRUE
)
ON CONFLICT (key) DO NOTHING;

-- super_admin entra también: tiene bypass en código, pero el grant lo mantiene
-- seguro si alguna vez se retira ese bypass.
INSERT INTO area_members (area_id, user_id)
SELECT a.id, u.id
  FROM areas a
  CROSS JOIN users u
 WHERE a.key = 'general'
ON CONFLICT DO NOTHING;

INSERT INTO kb_access_grants (principal_type, principal_id, kb_file_id, permission)
SELECT 'area', a.id, f.id, 'read'
  FROM areas a
  CROSS JOIN kb_files f
 WHERE a.key = 'general'
   AND f.status = 'active'
ON CONFLICT DO NOTHING;
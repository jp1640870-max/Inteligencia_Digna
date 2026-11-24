-- Acceso por defecto a la Knowledge Base General.
--
-- El área `general` es la puerta de entrada de los usuarios nuevos: migrar no
-- basta, porque la 003 solo agregó a quienes ya existían. Esta regla vive en la
-- base de datos para cubrir TODAS las vías de alta (registro, panel, callback,
-- scripts e inserciones directas) y no depender de que cada una recuerde el
-- paso adicional.
--
-- No crea grants: el ACL sigue siendo fail-closed y los documentos necesitan
-- su grant explícito al área. Solo garantiza que el usuario nuevo pertenezca
-- al principio que el administrador ya usa para repartir acceso general.

CREATE OR REPLACE FUNCTION assign_new_user_to_general_area()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO area_members (area_id, user_id)
  SELECT a.id, NEW.id
    FROM areas a
   WHERE a.key = 'general'
     AND a.is_active = TRUE
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_default_general_area ON users;

CREATE TRIGGER trg_users_default_general_area
AFTER INSERT ON users
FOR EACH ROW
EXECUTE FUNCTION assign_new_user_to_general_area();

-- Backfill de usuarios creados desde la 003 sin pertenencia al área general.
INSERT INTO area_members (area_id, user_id)
SELECT a.id, u.id
  FROM areas a
  CROSS JOIN users u
 WHERE a.key = 'general'
   AND a.is_active = TRUE
ON CONFLICT DO NOTHING;

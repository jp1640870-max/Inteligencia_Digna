-- Quita banderas de configuración que ningún código leía.
--
-- `allow_registration`, `allow_guest_access`, `default_user_role` y
-- `maintenance_mode` se sembraban en `config` y se pintaban en el panel como si
-- fueran interruptores, pero ninguna ruta las consultaba:
--
--   - `POST /api/auth/register` nunca miró `allow_registration` y asignó siempre
--     el rol `user` con literales.
--   - No hay modo invitado en ninguna parte del código.
--   - No hay comprobación de mantenimiento que responda 503.
--
-- Un interruptor que no hace nada en la interfaz es peor que no tenerlo: quien
-- lo ve asume que está activo, y en caso de incidente se pierde tiempo
-- depurando un control que no existe.
--
-- El registro público sigue abierto. Eso ya no es una bandera configurable sino
-- una decisión del código, documentada en `docs/SERVIDOR.md`. Si algún día se
-- quiere cerrar, es un cambio en la ruta de registro, no un interruptor que ya
-- estaba puesto.

DELETE FROM config
 WHERE key IN (
   'allow_registration',
   'allow_guest_access',
   'default_user_role',
   'maintenance_mode'
 );

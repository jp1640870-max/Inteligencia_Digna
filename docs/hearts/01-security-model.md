# 01 — Modelo de seguridad y ACL

## 1. Principios

1. **Denegar por defecto.** Un rol sin capability no entra; un Heart sin
   visibilidad no se lee; una tool no declarada no se ejecuta.
2. **`scope` es la fuente de verdad.** `personal` y `company` deciden propiedad,
   visibilidad y quién puede escribir.
3. **La autorización se aplica en el servidor.** El cliente puede enviar
   `heartId`, `agentId`, `scope` o `isFeatured`, pero el backend decide.
4. **La KB se resuelve por intersección con el ACL.** Ningún Heart, tool o
   prompt puede ampliar los archivos que el usuario puede leer.
5. **La moderación no cambia la propiedad.** Un admin puede editar o eliminar un
   Heart personal, pero no puede transferirlo ni convertirlo en empresa.
6. **El agente oficial está protegido.** No se elimina y su comportamiento vive
   en el backend.
7. **La vista previa no es una integración.** El escalamiento de Soporte no crea
   tickets ni escribe en ServiceDesk.

## 2. Actores

| Actor | Descripción |
| --- | --- |
| Anónimo | Sin sesión válida. |
| `user` | Usuario autenticado sin capabilities de panel. |
| `editor` | Rol de panel con `admin.access`, KB y usuarios; **no** tiene `hearts.manage`. |
| `admin` | Tiene `hearts.manage`, KB con bypass de lectura y resto del panel salvo `config.destroy` e `impersonate`. |
| `super_admin` | Igual que `admin` más `config.destroy` e `impersonate`. |
| Sistema | Rutas internas, seeds y tareas de mantenimiento. |

La matriz de capabilities vive en `lib/permissions.ts`. La política de filas
vive en `lib/hearts.ts`, `lib/kb-access.ts` y las rutas.

## 3. Matriz de acciones sobre Hearts

| Acción | `user` | `admin` / `super_admin` | `editor` |
| --- | --- | --- | --- |
| Ver Hearts visibles (propios + empresa) | Sí | Sí | No por API de usuario; el panel no tiene `hearts.manage` |
| Leer Heart personal propio | Sí | Sí | No |
| Leer Heart personal ajeno | No | Sí, vía panel | No |
| Leer Heart de empresa | Sí | Sí | No |
| Crear Heart personal | Sí | Sí | No |
| Editar Heart personal propio | Sí | Sí | No |
| Eliminar Heart personal propio | Sí | Sí | No |
| Editar Heart personal ajeno | No | Sí, moderación | No |
| Eliminar Heart personal ajeno | No | Sí, moderación | No |
| Cambiar propietario de un Heart | No | No | No |
| Cambiar `scope` de un Heart | No | No | No |
| Crear Heart de empresa | No | Sí | No |
| Editar Heart de empresa | No | Sí | No |
| Eliminar Heart de empresa | No | Sí | No |
| Fijar globalmente (`is_featured`) | No | Solo empresa | No |
| Fijar para sí mismo (`user_heart_pins`) | Sí, si el Heart es visible | Sí | No |
| Eliminar el agente oficial | No | No (409) | No |
| Cambiar instrucciones/tools del oficial | No | No (solo presentación y temperatura) | No |
| Usar un Heart visible en un chat | Sí | Sí | Sí, si entra a la app como usuario |

> `editor` no tiene `hearts.manage`, así que no puede abrir las rutas
> administrativas de Hearts aunque tenga `admin.access`.

## 4. Puntos de aplicación

### 4.1 Rutas de usuario

- `GET /api/hearts`: requiere sesión y lista solo Hearts visibles para el
  usuario.
- `POST /api/hearts`: requiere sesión; `insertHeart` fuerza `scope =
  'personal'` e `is_preset = FALSE`.
- `GET /api/hearts/[id]`: requiere sesión y `readHeartForUser`.
- `PATCH /api/hearts/[id]`: requiere sesión y `canEditHeart` (personal propio).
- `DELETE /api/hearts/[id]`: requiere sesión y `canEditHeart`; `removeOwnedHeart`
  exige `user_id` y `scope = 'personal'`.

### 4.2 Rutas administrativas

- `GET /api/admin/hearts`: `requireCapability("hearts.manage")`.
- `POST /api/admin/hearts`: `requireCapability("hearts.manage")`; crea empresa.
- `GET /api/admin/hearts/user`: `requireCapability("hearts.manage")`; lista
  personales para moderación.
- `GET /api/admin/hearts/[id]`: `hearts.manage`; permite empresa y personal.
- `PATCH /api/admin/hearts/[id]`: `hearts.manage`; `sanitizeHeartInput` ignora
  `user_id`, `scope`, `agent_key`, `is_preset`, `is_public` y `is_featured` en
  personales.
- `DELETE /api/admin/hearts/[id]`: `hearts.manage`; rechaza `agent_key` con 409.

### 4.3 Visibilidad de lectura

`readHeartForUser` y `listHeartsForUser` aplican:

```sql
h.scope = 'company'
OR (h.scope = 'personal' AND h.user_id = $userId)
```

`getHeartByAgentKeyForUser` aplica la misma regla para el agente oficial.

### 4.4 Pins

`setHeartPinnedForUser` primero llama a `readHeartForUser`; si el Heart no es
visible, devuelve `null`. El pin se guarda en `user_heart_pins` y no modifica el
Heart ni su `is_featured`.

### 4.5 Chat

- `chat/route.ts` verifica que el chat existente pertenezca al usuario.
- Un `agentId` desconocido devuelve 400.
- Un `heartId` no visible devuelve 404.
- Un `agentId` que no corresponde al Heart devuelve 403.
- Un Heart con `agent_key` desconocido devuelve 409.
- `regenerate` verifica propiedad del chat y visibilidad del Heart.
- `support/escalation` verifica propiedad del chat y que sea de Soporte.

### 4.6 KB y RAG

- `retrieveKb` y `retrieveAccessibleChunks` aplican el ACL del usuario.
- El Heart no recibe un bypass de KB.
- El contexto recuperado se inyecta en el mensaje del usuario; el prompt del
  Heart no puede ampliar el conjunto de archivos.
- Los tests de `kb-access` y `kb-access-db` caracterizan esta política.

## 5. Casos de amenaza y comportamiento esperado

| Caso | Comportamiento esperado |
| --- | --- |
| Usuario envía `scope: "company"` al crear un Heart | Se ignora; se crea personal. |
| Usuario envía `isFeatured: true` en su Heart personal | Se ignora; no hay fijado global. |
| Usuario intenta editar un Heart de empresa | 403 por `canEditHeart`. |
| Usuario intenta leer un Heart personal ajeno | 404 por `readHeartForUser`. |
| Usuario intenta fijar un Heart personal ajeno | `setHeartPinnedForUser` devuelve `null`. |
| Admin intenta cambiar el propietario de un Heart personal | Se ignora; `updateHeart` no recibe `user_id`. |
| Admin intenta convertir un personal en empresa | Se ignora; `scope` no está en `HEART_UPDATE_FIELDS` de la ruta. |
| Admin intenta destacar un Heart personal | Se ignora; `is_featured` solo se escribe para empresa. |
| Admin intenta borrar el agente oficial | 409. |
| Admin intenta cambiar instrucciones/tools del oficial | Se ignora; solo presentación y temperatura. |
| Usuario intenta usar un Heart de empresa | Permitido por diseño actual; no existe `hearts.use` todavía. |
| Usuario intenta leer KB no autorizada desde un Heart | El ACL la filtra. |
| Usuario intenta regenerar un chat ajeno | 403. |
| Usuario intenta escalar un chat que no es de Soporte | 403. |
| Usuario intenta escalar un chat sin consulta | 400. |
| Cliente intenta inyectar un `agentId` en un chat existente | 403 si no coincide con el agente del chat/Heart. |

## 6. Cobertura de pruebas

| Área | Pruebas |
| --- | --- |
| Visibilidad y propiedad | `tests/hearts.test.ts`, `tests/hearts-db.test.ts` |
| Permisos de panel | `tests/permissions.test.ts` |
| Prompt de Heart/Soporte | `tests/prompt-builder.test.ts`, `tests/support-agent.test.ts` |
| ACL de KB | `tests/kb-access.test.ts`, `tests/kb-access-db.test.ts` |
| Contratos de Fase 0 | `tests/heart-definition.test.ts`, `tests/heart-execution.test.ts`, `tests/tool-contract.test.ts` |

## 7. Brechas conocidas

1. **No existe `hearts.use`.** Cualquier usuario autenticado puede usar
   cualquier Heart de empresa. Es el comportamiento actual y debe decidirse en
   Fase 1 si se quiere restringir por área, grupo o rol.
2. **No hay alcance por departamento.** `scope` distingue personal/empresa, pero
   no áreas.
3. **No hay ciclo de vida.** No se puede pausar, revocar o archivar un Heart
   desde la UI; el contrato de Fase 0 lo prepara.
4. **El gating de tools es booleano.** `heartToolAllowed` vive en el route; no
   hay Tool Gateway ni auditoría por tool.
5. **La moderación de personales es deliberada.** El admin puede editar/eliminar
   sin cambiar propietario ni `scope`; se audita como “Heart de usuario”.
6. **No hay RLS de base de datos.** La autorización se aplica en la aplicación.
7. **La duplicación chat/regenerate puede divergir.** Fase 1 debe extraer la
   resolución compartida.
8. **El agente oficial permite ajustes de presentación.** Nombre, rol, tono y
   temperatura se pueden cambiar desde el panel; instrucciones, límites y tools
   no. Cualquier ampliación debe auditarse.

## 8. Invariantes para fases siguientes

- Ningún Heart puede leer KB fuera del ACL del usuario.
- Ningún usuario puede cambiar `scope`, `user_id`, `agent_key` o `is_featured`
  desde una ruta de usuario.
- Ningún admin puede transferir un Heart personal.
- El agente oficial no se elimina ni se reescribe desde la UI.
- Un Heart no ejecutable (`draft`, `paused`, `revoked`, `archived`) no debe
  iniciar una ejecución normal.
- Un Tool Gateway debe validar la definición y el ACL antes de ejecutar.
- Toda acción administrativa sobre Hearts debe quedar auditada.

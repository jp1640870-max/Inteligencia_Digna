# Hearts — Fase 2: runtime configurable por definición

> Documentación de implementación de Hearts. La visión de producto sigue en
> [`../HEARTS.md`](../HEARTS.md). El roadmap estratégico completo vive en el
> plan de trabajo de OpenCode (`hearts-roadmap.md`).

## Estado

- **Fase activa:** 2, con la expansión de enforcement y reactivación de Fase 1
  ya incluida (entregable técnico completo; pendiente validación manual).
- **Runtime:** `/api/chat` y `/api/chat/regenerate` resuelven el Heart con
  `lib/heart-resolver.ts`. Un Heart publicado ejecuta su **snapshot publicado**
  vigente; las ediciones sin publicar no cambian a los usuarios. El chat normal
  y Soporte conservan su comportamiento.
- **Esquema:** migración `013` aplicada (`description`, `model`, `status`,
  `version`, `published_at` y tabla `heart_versions`).
- **Panel admin:** formulario con descripción y modelo, badges de estado/versión,
  filtros por estado y búsqueda, acciones de ciclo de vida e historial de snapshots.
- **Validación manual:** pendiente de que el usuario pruebe la interfaz.

## Entregables Fase 0 (base)

| ID  | Entregable                    | Estado                                                                                                                      |
| --- | ---------------------------   | --------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | Inventario del flujo actual   | [00-current-state.md](00-current-state.md)                                                                                  |
| 0.2 | Matriz de seguridad y ACL     | [01-security-model.md](01-security-model.md)                                                                                |
| 0.3 | Contratos puros               | [02-contracts.md](02-contracts.md) + `lib/heart-definition.ts`, `lib/heart-execution.ts`, `lib/tool-contract.ts`            |
| 0.4 | Pruebas de caracterización    | `tests/heart-definition.test.ts`, `tests/heart-execution.test.ts`, `tests/tool-contract.test.ts`, `tests/hearts-db.test.ts` |
| 0.5 | Estrategia de migración       | [03-migration-plan.md](03-migration-plan.md)                                                                                |
| 0.6 | Catálogo base de herramientas | [04-tool-catalog.md](04-tool-catalog.md) + `lib/tool-contract.ts`                                                           |
| 0.7 | Checklist de revisión         | [05-phase-0-review.md](05-phase-0-review.md)                                                                                |
| 0.8 | Riesgos y decisiones          | [06-decisions.md](06-decisions.md)                                                                                          |

## Entregables Fase 1

| ID | Entregable | Ubicación |
| --- | --- | --- |
| 1.1 | Migración aditiva 013 | `migrations/013_heart_definition.sql` |
| 1.2 | Definición tipada y parser consolidado | `lib/heart-definition.ts`, `lib/heart-config.ts`, `types/index.ts` |
| 1.3 | Servicio de registro | `lib/heart-registry.ts`, `lib/heart-registry-rules.ts` |
| 1.4 | Ciclo de vida | `lib/heart-lifecycle.ts`, `app/api/admin/hearts/[id]/status/route.ts` |
| 1.5 | Versionado | `lib/heart-versions.ts`, `app/api/admin/hearts/[id]/versions/route.ts` |
| 1.6 | UI admin | `app/admin/hearts/page.tsx`, rutas `/api/admin/hearts` |
| 1.7 | Soporte sembrado con fallback | `lib/hearts.ts`, `lib/heart-registry.ts` |
| 1.8 | Pruebas | `tests/heart-definition.test.ts`, `tests/heart-registry.test.ts`, `tests/heart-registry-db.test.ts` |

## Entregables Fase 2

| ID | Entregable | Ubicación |
| --- | --- | --- |
| 2.1 | Resolver compartido y ejecución tipada | `lib/heart-resolver.ts`, `lib/heart-execution.ts` |
| 2.2 | Prompt desde la definición publicada | `lib/prompt-builder.ts` |
| 2.3 | Modelo y temperatura efectivos | `lib/heart-resolver.ts`, `app/api/chat/route.ts`, `app/api/chat/regenerate/route.ts` |
| 2.4 | Tools declaradas mapeadas a las ramas actuales | `lib/heart-resolver.ts`, rutas de chat |
| 2.5 | Límites y timeout del contrato | `lib/heart-execution.ts`, `doStream` |
| 2.6 | Auditoría de ejecución | `lib/heart-resolver.ts` (`heart_execution_started`) |
| 2.7 | Cableado de ambas rutas | `app/api/chat/route.ts`, `app/api/chat/regenerate/route.ts` |
| 2.8 | Pruebas y documentación | `tests/heart-resolver.test.ts`, `tests/heart-registry-db.test.ts`, `tests/hearts-db.test.ts`, este documento |

## Reglas de Fase 2

1. El runtime de un Heart usa el **snapshot de la versión publicada vigente**.
   Editar en el panel no cambia la ejecución hasta publicar una nueva versión.
2. `model.name = NULL` cae al modelo actual del chat (`getChatModel()`).
3. La temperatura se toma de la definición publicada y se aplica al stream
   principal; los chats normal y Soporte conservan la configuración actual.
4. Las tools efectivas son la intersección entre las declaradas por el Heart y
   las ramas deterministas existentes. No hay Tool Gateway ni tool calling.
5. Los límites del contrato (`maxSteps`, `timeoutMs`, `maxOutputTokens`) se
   resuelven en el `HeartExecution`. `maxSteps` queda reservado porque el
   runtime actual no ejecuta un bucle de tools.
6. El conocimiento sigue siendo `platform_acl`: el snapshot no amplía el ACL.
7. Soporte conserva su prompt oficial, su modelo actual y solo `read_files`.
8. Cada ejecución de Heart deja un registro `heart_execution_started` con
   Heart, versión, chat, modelo, temperatura y tools.

## Reglas de Fase 1

1. `version` aumenta solo al publicar. Editar un Heart publicado no cambia su
   versión ni crea un snapshot; ilustrará la versión vigente hasta la siguiente
   publicación.
2. La primera publicación desde `draft` conserva la v1. Publicar desde
   `published` o `paused` crea una versión nueva y un snapshot atómico.
3. `revoked` es terminal salvo a `archived`; `archived` puede reactivarse a
   `draft` de forma administrativa y auditada.
4. Solo `published` es visible y usable por los usuarios. `paused`, `revoked` y
   `archived` se ocultan de `/api/hearts` y no pueden resolver un Heart en
   `/api/chat` ni en `regenerate`; el panel admin los sigue mostrando.
5. `model` y `temperature` se persisten en Fase 1 y los aplica el resolver de
   Fase 2. `model = NULL` significa «modelo actual del chat».
6. El conocimiento sigue siendo `platform_acl`: `declaredFiles` es informativo,
   nunca un ACL.
7. El agente oficial de Soporte no se elimina ni cambia de estado desde el
   panel; su comportamiento permanece en `lib/official-agents.ts` y las ramas
   actuales del chat.
8. La UI muestra las herramientas de plataforma de Soporte como etiquetas, sin
   tool calling ni tickets reales.

## Expansión de Fase 1: enforcement y reactivación

| Cambio | Ubicación |
| --- | --- |
| Los listados y lecturas de usuario solo devuelven Hearts `published` | `lib/hearts.ts` |
| `/api/chat` y `regenerate` heredan el filtro al resolver el Heart | `lib/hearts.ts`; Fase 2 añadió el resolver compartido |
| `archived → draft` como transición administrativa auditada | `lib/heart-definition.ts`, `lib/heart-registry-rules.ts`, `lib/heart-lifecycle.ts` |
| Botón «Reactivar» para Hearts archivados | `app/admin/hearts/page.tsx` |
| Publicar tras reactivar crea versión nueva, nunca repite snapshot | `lib/heart-lifecycle.ts` |
| Pruebas de visibilidad y reactivación | `tests/hearts-db.test.ts`, `tests/heart-registry-db.test.ts` |

Esta expansión no extrajo el Runtime en su momento; la extracción y aplicación
de `model`/`temperature` llegaron con la Fase 2. No cambia KB/RAG/ACL y no
introduce Tool Gateway.

## Puerta de fase

La Fase 2 se considera técnicamente cerrada cuando:

- [x] `/api/chat` y `/api/chat/regenerate` usan el mismo resolver.
- [x] Un Heart publicado ejecuta su snapshot publicado, no la edición sin
      publicar.
- [x] Modelo, temperatura, prompt y tools declaradas llegan al runtime.
- [x] Chat normal y Soporte conservan su comportamiento.
- [x] Los Hearts pausados/archivados siguen bloqueados para usuarios.
- [x] `tsc`, ESLint dirigido, `npm test` y `npm run test:db` pasan.
- [ ] El usuario valida la interfaz y el funcionamiento en el entorno real.

La Fase 3 no comienza hasta que el usuario apruebe explícitamente este entregable.

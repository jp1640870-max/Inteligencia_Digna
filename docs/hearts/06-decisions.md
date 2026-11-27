# 06 — Decisiones, riesgos y deuda

## 1. Decisiones de arquitectura

### ADR-001 — `scope` es la fuente de verdad

**Decisión:** `hearts.scope` (`personal` | `company`) decide propiedad,
visibilidad y escritura. `is_preset` e `is_public` se conservan por
compatibilidad, pero no gobiernan la separación.

**Motivo:** la separación ya existe en la migración `011` y en las consultas;
duplicarla en otra bandera crearía dos verdades.

**Consecuencia:** cualquier nueva regla de visibilidad debe partir de `scope` y
de `user_id`, no de `is_public`.

### ADR-002 — Definición tipada sobre columnas planas

**Decisión:** `HeartDefinition` es una vista tipada sobre columnas de `hearts`,
no un JSON monolítico nuevo.

**Motivo:** mantener consultas, índices, migraciones incrementales y
compatibilidad con el código actual.

**Consecuencia:** la migración `013` añade columnas pequeñas y verificables.

### ADR-003 — Extracción incremental del runtime

**Decisión:** no reescribir `/api/chat` de una vez. Extraer resolución, gating y
prompt por pasos, con pruebas de caracterización.

**Motivo:** el route es grande, tiene ramas de KB/RAG/documentos/imágenes/web y
duplica lógica con `regenerate`.

**Consecuencia:** la resolución compartida sigue pendiente y se mueve a Fase 2.
Fase 1 solo persistió y administró definiciones sin tocar el runtime.

### ADR-004 — Conocimiento siempre por ACL

**Decisión:** ningún Heart, tool o prompt puede ampliar el ACL. El conocimiento
se resuelve por intersección con el usuario autenticado.

**Motivo:** evitar duplicar RAG/ACL y evitar fugas por configuración.

**Consecuencia:** `knowledge.mode = "platform_acl"` es el único modo de Fase 0.
Las fuentes explícitas se decidirán después, sin bypass.

### ADR-005 — IDs canónicos con compatibilidad histórica

**Decisión:** el catálogo usa `read_files`, `generate_docs`, `web_search`,
`analyze_images`, `kb_search` y `prepare_escalation`. Los IDs del agente oficial
se resuelven con un mapa de compatibilidad.

**Motivo:** Soporte ya usa `knowledge_base`, `conversation_files` y
`prepare_escalation`; romperlos cambiaría el comportamiento.

**Consecuencia:** `resolveToolId` es la puerta de entrada para datos históricos.

### ADR-006 — `model = null` conserva el modelo actual

**Decisión:** un Heart sin modelo explícito usa el modelo actual del chat.

**Motivo:** no hardcodear un modelo y no cambiar el comportamiento de los
Hearts existentes.

**Consecuencia:** la temperatura se guarda en el contrato, pero su aplicación a
Ollama se decide en Fase 2.

### ADR-007 — Tool calling detrás de una fase posterior

**Decisión:** Fase 0 solo define contratos y catálogo. No hay Tool Gateway, tool
calling estructurado, MCP, Tasks ni Workflows.

**Motivo:** el runtime actual usa ramas deterministas; introducir autonomía sin
gateway ni auditoría debilitaría el control.

**Consecuencia:** el catálogo es documentación ejecutable, no una autorización
de ejecución.

### ADR-008 — Soporte como definición con fallback

**Decisión:** Soporte se migrará a una definición persistida con fallback
temporal al código actual.

**Motivo:** hoy vive en `lib/official-agents.ts` y tiene ramas propias. Migrarlo
de golpe rompería el agente oficial.

**Consecuencia:** en Fase 1 la tarjeta se siembra como definición publicada v1 y
`getOfficialSupportDefinition()` valida la fila, con fallback al código si no es
utilizable. `SUPPORT_AGENT.id`, sus instrucciones y su gating se conservan.

### ADR-009 — No adelantar MCP, Tasks ni Workflows

**Decisión:** no se implementan antes de sus fases.

**Motivo:** requieren permisos, credenciales, aislamiento, aprobaciones y
auditoría que aún no existen.

**Consecuencia:** cualquier propuesta de “agente autónomo” en Fase 1 debe
rechazarse o replantearse como fase posterior.

### ADR-010 — Puertas de fase

**Decisión:** cada fase termina con entregables, pruebas y aprobación explícita.

**Motivo:** evitar que el roadmap se convierta en una implementación monolítica
sin control.

**Consecuencia:** Fase 0 no autoriza Fase 1 por sí sola.

## 2. Riesgos

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| Duplicación chat/regenerate | Divergencia de permisos o prompt | Resuelta en Fase 2 con `lib/heart-resolver.ts`. |
| Gating booleano en el route | Dificulta auditar tools | Tool Gateway en Fase 3; pruebas de caracterización. |
| Soporte hardcodeado | Cambios de definición rompen el agente | Fallback y pruebas de `support-agent`. |
| `temperature` no aplicada | Expectativa incorrecta del usuario | Resuelta en Fase 2 para el stream principal del Heart. |
| `knowledge_files`/`agent_memory` inertes | Confusión de configuración | No prometer su uso hasta implementarlo. |
| Sin `hearts.use` | Cualquier usuario usa empresa | Decidir alcance por área/rol en Fase 3. |
| Sin RLS | Dependencia de la app | Mantener autorización server-side y tests DB. |
| Migración sin backup | Pérdida de datos | Backup y rollback documentados. |
| Moderación de personales | Expectativa de privacidad | Documentar que el admin puede moderar sin cambiar propiedad. |
| Crecimiento del route | Mantenibilidad | Extracción incremental, no reescritura. |

## 3. Deuda técnica

1. ~~`chat/route.ts` y `regenerate/route.ts` resuelven Heart/Soporte por
   separado~~: resuelto en Fase 2 con `lib/heart-resolver.ts`.
2. ~~`heartToolAllowed` es local y no reutilizable~~: resuelto en Fase 2; el
   resolver entrega `allowedTools`.
3. ~~`parseHeartTools` duplicado~~: resuelto en Fase 1 (`lib/heart-config.ts`).
4. `getAgentModel()` existe, pero el chat usa `getChatModel()`.
5. ~~`temperature` no se pasa a Ollama~~: resuelto en Fase 2 para el stream
   principal del Heart.
6. `knowledge_files` y `agent_memory` no participan en la ejecución.
7. `is_public` e `is_preset` siguen existiendo por compatibilidad.
8. ~~Sin historial de versiones~~: `heart_versions` creado en Fase 1, sin
   snapshot para los Hearts anteriores a la migración.
9. No hay auditoría de CRUD de Hearts personales desde la vista de usuario.
10. No hay `hearts.use` ni alcance por área.
11. ~~El runtime no aplica `status`, `model` ni temperatura~~: resuelto en Fase 2.

## 4. Decisiones resueltas en Fase 1

### ADR-011 — `heart_versions` vive en la migración 013

**Decisión:** la tabla de snapshots se crea en la misma migración que las
columnas de definición, no en una `014` separada.

**Motivo:** el versionado es parte del entregable 1.5 y publicar ya debe escribir
un snapshot atómico en la misma transacción.

**Consecuencia:** un solo paso de `db:migrate` deja el esquema completo; el
rollback documentado elimina también la tabla.

### ADR-012 — La versión solo aumenta al publicar

**Decisión:** editar un Heart no cambia `version`. La primera publicación desde
`draft` mantiene v1; publicar desde `published` o `paused` crea la versión
siguiente y un snapshot.

**Motivo:** la versión identifica definiciones publicadas, no ediciones
intermedias. Publicar de nuevo es una acción explícita y auditable.

**Consecuencia:** un Heart publicado editado muestra la versión vigente hasta
que se republica. Esto se explica en el panel.

### ADR-013 — `publishedAt` entra en el contrato

**Decisión:** `HeartDefinition.admin.publishedAt` es `string | null` y se mapea
desde `hearts.published_at`.

**Motivo:** el historial necesita saber cuándo se fijó la versión vigente.

**Consecuencia:** los Hearts anteriores a la migración usan `created_at` como
fecha de publicación; los borradores tienen `null`.

### ADR-014 — Estado enforceado en la lectura de usuario

**Decisión:** solo `published` es visible y usable por usuarios. `paused`,
`revoked` y `archived` se filtran en `lib/hearts.ts`, que es la puerta que ya
usan `/api/hearts`, `/api/chat`, `regenerate` y escalamiento de Soporte.

**Motivo:** marcar el estado sin impedir el uso era engañoso desde el panel.
Filtrar en la capa de lectura evita duplicar reglas en cada ruta y no requiere
extraer el Runtime.

**Consecuencia:** los chats existentes siguen legibles por su historial; el
envío de nuevos mensajes con un Heart no publicado responde «Heart no
disponible». El panel admin conserva la vista completa.

### ADR-015 — Republicar no es una transición de estado

**Decisión:** `published → published` y `paused → published` se resuelven como
acciones de versión en `resolveHeartStatusAction`, sin ampliar la tabla de
transiciones de Fase 0.

**Motivo:** mantener el contrato puro intacto y separar «cambiar estado» de
«fijar una nueva versión».

**Consecuencia:** `revoked` sigue siendo terminal salvo a `archived`; `archived`
puede reactivarse a `draft` con la acción administrativa de ADR-017.

### ADR-016 — Soporte no se modifica desde el panel

**Decisión:** el agente oficial se siembra como definición publicada v1, pero el
panel solo permite editar su presentación: no se elimina ni cambia de estado.

**Motivo:** su comportamiento vive en `lib/official-agents.ts` y en ramas
específicas del chat; cambiarlo desde la definición lo rompería.

**Consecuencia:** las herramientas de plataforma se muestran como etiquetas en
la UI, sin tool calling real ni tickets.

### ADR-017 — Reactivación administrativa de archivados

**Decisión:** `archived → draft` es una transición permitida solo para el
perímetro, auditada como `heart_status_changed`. No hay salto directo a
`published`; el administrador debe publicar explícitamente después.

**Motivo:** el usuario reportó que un Heart archivado no podía volver a usarse
sin recreatearlo, lo que perdía su historial.

**Consecuencia:** publicar tras reactivar incrementa la versión aunque el estado
sea `draft`, porque ya existe `published_at`; así no se repite un snapshot vN.

### ADR-018 — El runtime ejecuta el snapshot publicado

**Decisión:** un Heart `published` se ejecuta desde el snapshot de su versión
vigente (`heart_versions`). La fila editable de `hearts` sirve para el panel y
para la próxima publicación.

**Motivo:** el versionado solo tiene sentido si publicar controla lo que reciben
los usuarios. Ejecutar la fila editada haría que cambios no publicados afectaran
producción.

**Consecuencia:** editar un Heart publicado no cambia la ejecución hasta
publicar. Los Hearts históricos sin snapshot caen a su fila actual para no
romperse.

### ADR-019 — Modelo, temperatura y límites efectivos

**Decisión:** el resolver construye un `HeartExecution` con el modelo del Heart
o `getChatModel()` como fallback, la temperatura validada de la definición y los
límites del contrato. El stream principal recibe temperatura, timeout y
`num_predict`.

**Motivo:** la configuración del panel debe gobernar la ejecución real sin
duplicar reglas en cada ruta.

**Consecuencia:** `maxSteps` queda reservado hasta que exista un bucle de tools.
Las llamadas auxiliares usan el modelo del Heart, pero conservan su temperatura
actual.

### ADR-020 — Soporte conserva su runtime

**Decisión:** el resolver trata a Soporte como caso propio: prompt oficial,
modelo actual del chat y solo `read_files`. No construye `HeartExecution` para
Soporte.

**Motivo:** su comportamiento depende de `official-agents.ts` y de ramas
específicas; aplicar la definición genérica cambiaría sus respuestas.

**Consecuencia:** la definición sembrada de Soporte sigue siendo la tarjeta y el
fallback del Registry, pero no altera su ejecución.

## 5. Decisiones pendientes para Fase 3

1. ¿Se introduce `hearts.use` y por qué criterio (rol, área, grupo)?
2. ¿`knowledge_files` se convierte en fuentes explícitas o se elimina?
3. ¿Cómo mostrar en la vista de usuario el motivo de bloqueo de un Heart
   pausado sin filtrar información administrativa?
4. ¿El Tool Gateway autoriza por operación, por tool o por ambas?
5. ¿Qué tools requieren confirmación humana antes de ejecutarse?

## 6. Registro de cambios

### Fase 0

- Se crearon contratos puros sin cableado.
- Se agregaron pruebas de caracterización.
- Se documentó el flujo actual, la seguridad, la migración y el catálogo.
- No se modificó el runtime, el esquema ni la UI.

### Fase 1

- Se aplicó la migración `013` y se creó `heart_versions`.
- Se amplió `HeartDefinition` con `publishedAt` y se consolidó el parser de tools.
- Se crearon Registry, reglas puras, ciclo de vida y persistencia de snapshots.
- Se adaptaron las rutas admin y la UI con estados, versiones y filtros.
- Se sembró Soporte como definición con fallback al código.
- Se añadieron pruebas unitarias y de base de datos (345 unitarias + 7 de BD).
- No se modificó `/api/chat` ni `/api/chat/regenerate`.
- No se aplicó `model` ni `temperature` al runtime.

### Expansión de Fase 1

- Se filtraron los Hearts no publicados de la lectura de usuario.
- Se habilitó `archived → draft` con auditoría y botón «Reactivar».
- Se corrigió el versionado tras reactivación para no repetir snapshots.
- No se extrajo el Runtime ni se cambiaron tools, KB/RAG/ACL.
- No se hizo commit, push, reset, clean ni descarte.

### Fase 2

- Se creó `lib/heart-resolver.ts` y ambas rutas de chat lo consumen.
- El runtime ejecuta el snapshot publicado vigente; la edición sin publicar no
  cambia a los usuarios.
- Se aplican modelo, temperatura y límites del `HeartExecution`.
- Las tools declaradas se mapean a las ramas deterministas existentes.
- Soporte y el chat normal conservan su comportamiento.
- Se añadió auditoría `heart_execution_started`.
- No se introdujo Tool Gateway, tool calling, MCP ni tickets reales.
- No se cambió RAG/embeddings/chunking/umbrales/ACL.

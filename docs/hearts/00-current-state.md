# 00 — Estado actual del flujo de Hearts

## 1. Resumen ejecutivo

Hoy Hearts funciona como una capa de configuración sobre un runtime monolítico.
La separación personal/empresa ya existe y está reflejada en:

- `hearts.scope` (`personal` | `company`) como fuente de verdad.
- `hearts.agent_key` para vincular la tarjeta oficial de Soporte.
- `hearts.is_featured` para el fijado global de empresa.
- `user_heart_pins` para el fijado por usuario.
- `chats.heart_id` para vincular un chat con su Heart.
- `chats.agent_key` para compatibilidad con chats de Soporte anteriores.

El runtime sigue concentrado en `app/api/chat/route.ts` (aproximadamente 1.400
líneas) y `app/api/chat/regenerate/route.ts` duplica parte de la resolución.
Soporte sigue hardcodeado en `lib/official-agents.ts` y tiene ramas propias en
el chat.

Fase 0 no cambia nada de esto. Solo lo documenta, fija contratos y agrega
pruebas de caracterización.

## 2. Mapa de archivos

| Archivo | Responsabilidad actual |
| --- | --- |
| `app/api/chat/route.ts` | Resolución de Heart/Soporte, gating de tools, KB/RAG, archivos, imágenes, documentos, web y prompt. |
| `app/api/chat/regenerate/route.ts` | Resolución de Heart/Soporte, KB, prompt e imágenes para regenerar. |
| `app/api/support/escalation/route.ts` | Vista previa de escalamiento de Soporte. |
| `app/api/hearts/route.ts` | Listado y creación de Hearts personales del usuario. |
| `app/api/hearts/[id]/route.ts` | Lectura, edición y borrado de Hearts personales propios. |
| `app/api/admin/hearts/route.ts` | Listado y creación de Hearts de empresa. |
| `app/api/admin/hearts/[id]/route.ts` | Edición/borrado de empresa y moderación de personales. |
| `app/api/admin/hearts/user/route.ts` | Listado de Hearts personales para el panel admin. |
| `app/admin/hearts/page.tsx` | Panel con tabs “Hearts de Empresa” y “Hearts de Usuarios”. |
| `lib/hearts.ts` | Visibilidad, propiedad, pins, normalización, `ensureOfficialSupportHeart`. |
| `lib/heart-config.ts` | `HEART_TOOLS`, límites y borrador compartido con cliente. |
| `lib/official-agents.ts` | Soporte hardcodeado y `getSupportInstructions`. |
| `lib/prompt-builder.ts` | `buildHeartInstructions` y `buildMessages`. |
| `lib/kb.ts` | Recuperación de KB con ACL. |
| `lib/kb-access.ts` | `retrieveAccessibleChunks` y política de acceso. |
| `lib/rag.ts` | Retrieval de documentos por chat y umbrales. |
| `lib/db.ts` | CRUD de Hearts, chats, listados administrativos y pins. |
| `migrations/011_company_hearts.sql` | `scope`, `agent_key`, `is_featured`, `user_heart_pins`. |

## 3. Flujo de resolución

### 3.1 Chat normal

Un chat sin `heartId` ni `agentId`:

- `heart = null`, `supportAgent = null`.
- `heartToolAllowed` devuelve `true` para todas las tools.
- `allowImageGeneration = true`.
- Se recuperan KB y RAG.
- Se usan las notas genéricas de `buildMessages` (`DOC_NOTE`, `WEB_SEARCH_NOTE`,
  `KB_NOTE`).
- Se habilitan archivos, documentos, web, imágenes y generación de imágenes.

### 3.2 Chat con Heart personal o de empresa

Un chat con `heartId`:

- `readHeartForUser(heartId, userId)` aplica visibilidad:
  - personal propio;
  - cualquier Heart de empresa.
- Si el Heart tiene `agent_key`, se resuelve el agente oficial.
- `heartToolAllowed` solo permite las tools declaradas en `heart.tools`.
- `allowImageGeneration = false`.
- KB y RAG se siguen recuperando.
- `buildHeartInstructions(heart)` reemplaza las notas genéricas.
- Las herramientas no declaradas se ignoran aunque el cliente las pida.

### 3.3 Chat de Soporte

Un chat con `agentId = soporte-tecnico-oficial` o un Heart con
`agent_key = soporte-tecnico-oficial`:

- Se resuelve `supportAgent` desde `lib/official-agents.ts`.
- `heartToolAllowed` solo permite `read_files`; KB y escalamiento son ramas
  oficiales, no tools declaradas en `heart.tools`.
- `allowDocs`, `allowWebSearch`, `allowImages` y `allowImageGeneration` quedan
  en `false`.
- Se usa `getSupportInstructions(hasEvidence)`.
- El escalamiento es una vista previa determinista; no crea ticket ni escribe
  en ServiceDesk.
- `ensureOfficialSupportHeart` garantiza la tarjeta de Soporte en Hearts.

### 3.4 Regeneración

`/api/chat/regenerate`:

- Resuelve `heart` desde `chat.heart_id` y `supportAgent` desde
  `chat.agent_key ?? heart.agent_key`.
- Mantiene compatibilidad con chats de Soporte sin `heart_id`.
- Recupera KB, pero no vuelve a ejecutar RAG ni las ramas de documentos, web,
  archivos o imágenes.
- Solo decide si conserva imágenes en el historial:
  - Soporte: no.
  - Heart: solo si declara `analyze_images`.
  - Chat normal: sí.
- Usa `buildHeartInstructions` o `getSupportInstructions` según corresponda.

### 3.5 Escalamiento de Soporte

`/api/support/escalation`:

- Requiere usuario autenticado y chat propio.
- Solo acepta chats de Soporte, ya sea por `chat.agent_key` o por
  `heart.agent_key`.
- Exige al menos un mensaje de usuario con texto.
- Construye una solicitud determinista con `buildSupportEscalation`.
- Devuelve `preview: true` y `ticketCreated: false`.
- No persiste, no envía y no integra ServiceDesk.

## 4. Matriz actual de herramientas

| Contexto | Archivos | Documentos | Web | Imágenes | Generar imágenes | KB | RAG | Escalamiento |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Chat normal | Sí | Sí | Sí | Sí | Sí | Sí | Sí | No |
| Heart con tool | Solo si está declarada | Solo si está declarada | Solo si está declarada | Solo si está declarada | No | Sí | Sí | No |
| Heart sin tool | No | No | No | No | No | Sí | Sí | No |
| Soporte | Sí | No | No | No | No | Sí | Sí | Vista previa |

La KB y el RAG siempre se resuelven con el ACL del usuario. La diferencia es si
el contexto recuperado se inyecta en el prompt y si la rama de la tool se
ejecuta.

## 5. Persistencia y datos

- `hearts.scope` es la fuente de verdad de la separación.
- `hearts.is_preset` e `hearts.is_public` se conservan por compatibilidad.
- `hearts.is_featured` solo tiene efecto global en Hearts de empresa.
- `user_heart_pins` es por usuario y por Heart.
- `chats.heart_id` vincula el chat con el Heart.
- `chats.agent_key` se conserva para Soporte y chats antiguos.
- `knowledge_files` y `agent_memory` se persisten, pero no participan en la
  ejecución actual.
- `temperature` se guarda y se muestra, pero el chat usa el modelo actual sin
  aplicar esa temperatura a Ollama.
- `getAgentModel()` existe, pero el chat usa `getChatModel()`.

## 6. Duplicaciones y hardcodeos

- `chat/route.ts` y `chat/regenerate/route.ts` resuelven Heart/Soporte por
  separado.
- `buildHeartInstructions` y `getSupportInstructions` son dos caminos de prompt.
- Soporte vive en código (`lib/official-agents.ts`) y tiene ramas propias en el
  chat.
- `heartToolAllowed` es una función local del route.
- `HEART_TOOLS` es una lista fija en `lib/heart-config.ts`.
- La generación de imágenes no es una tool de Heart; se desactiva con
  `allowImageGeneration = !supportAgent && !heart`.
- `knowledge_files` y `agent_memory` no se usan en ejecución.

## 7. Hallazgos que alimentan Fase 1

1. Extraer la resolución de Heart/Soporte a un módulo compartido, sin cambiar
   comportamiento.
2. Introducir `HeartDefinition` como vista tipada de la fila actual.
3. Introducir `HeartExecution` como contrato del contexto de ejecución.
4. Unificar el gating de tools en una función pura y testeable.
5. Migrar Soporte a una definición con fallback temporal al código actual.
6. Resolver modelo y temperatura con fallback explícito.
7. Decidir el ciclo de vida (`draft`, `published`, `paused`, `revoked`,
   `archived`) antes de agregar columnas.
8. No conectar Tool Gateway, MCP, Tasks ni Workflows antes de sus fases.

## 8. Pruebas de referencia

Las pruebas existentes que caracterizan el comportamiento son:

- `tests/hearts.test.ts`
- `tests/prompt-builder.test.ts`
- `tests/support-agent.test.ts`
- `tests/permissions.test.ts`
- `tests/kb-access.test.ts`
- `tests/kb-access-db.test.ts`

Fase 0 agrega:

- `tests/heart-definition.test.ts`
- `tests/heart-execution.test.ts`
- `tests/tool-contract.test.ts`
- `tests/hearts-db.test.ts`

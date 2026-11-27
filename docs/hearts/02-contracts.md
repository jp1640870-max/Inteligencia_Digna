# 02 — Contratos puros de Fase 0

## 1. Propósito

Fase 0 fija tres contratos que las siguientes fases usarán sin reescribir el
runtime de golpe:

| Contrato | Archivo | Responsabilidad |
| --- | --- | --- |
| `HeartDefinition` | `lib/heart-definition.ts` | Forma tipada de un Heart sobre las columnas actuales. |
| `HeartVersion` | `lib/heart-definition.ts` | Snapshot versionado y su validación. |
| `HeartExecution` | `lib/heart-execution.ts` | Contexto de una ejecución: modelo, temperatura, tools, conocimiento y límites. |
| `ToolContract` | `lib/tool-contract.ts` | Catálogo canónico de herramientas, riesgo, permisos e integración. |

Los tres módulos son puros:

- no importan `lib/db`, `lib/ollama`, `lib/kb` ni rutas de Next.js;
- no abren conexiones;
- no ejecutan modelos;
- no están conectados a `/api/chat` ni a la UI.

`lib/tool-contract.ts` importa el tipo `Capability` y `ALL_CAPABILITIES` de
`lib/permissions.ts`, que es seguro para cliente y servidor.

## 2. `HeartDefinition`

### 2.1 Forma

```ts
type HeartDefinition = {
  id: string;
  ownerId: string;
  identity: {
    name: string;
    description: string;
    role: string;
  };
  behavior: {
    tone: string;
    instructions: string;
    limitations: string;
  };
  model: {
    name: string | null; // null = modelo actual del chat
    temperature: number;
  };
  knowledge: {
    mode: "platform_acl";
    declaredFiles: string[];
  };
  capabilities: {
    tools: HeartTool[];
  };
  admin: {
    scope: "personal" | "company";
    status: HeartStatus;
    version: number;
    publishedAt: string | null; // Fase 1: última publicación
  };
  timestamps: {
    createdAt: string;
    updatedAt: string;
  };
};
```

### 2.2 Mapeo desde la fila actual

`toHeartDefinition(row)` acepta `HeartRow` y campos futuros opcionales:

```ts
type HeartDefinitionSource = HeartRow & {
  description?: string | null;
  model?: string | null;
  status?: string | null;
  version?: number | string | null;
  published_at?: string | Date | null;
};
```

Defaults para filas anteriores a la migración 013:

| Campo | Default |
| --- | --- |
| `identity.description` | `""` |
| `model.name` | `null` |
| `admin.status` | `"published"` |
| `admin.version` | `1` |
| `admin.publishedAt` | `null` (o `created_at` si el Heart está publicado) |
| `knowledge.mode` | `"platform_acl"` |
| `knowledge.declaredFiles` | parseo de `knowledge_files` sin duplicados |
| `capabilities.tools` | parseo de `tools`, solo IDs conocidos, sin duplicados |

`toHeartDefinition` normaliza temperatura inválida a `0.7` y versión inválida a
`1`. La validación estricta se hace en `validateHeartDefinition`, no en el
mapeo, para que una fila antigua nunca rompa la lectura.

### 2.3 Invariantes de validación

`validateHeartDefinition(input)` comprueba:

- `id` y `ownerId` no vacíos;
- `identity.name` no vacío y dentro de `HEART_LIMITS.name`;
- `identity.description` dentro de `HEART_DEFINITION_LIMITS.description` (500);
- `identity.role` dentro de `HEART_LIMITS.role`;
- `behavior.tone` dentro de `HEART_LIMITS.tone`;
- `behavior.instructions` y `behavior.limitations` dentro de sus límites;
- `model.name` es `string | null`, máximo 120;
- `model.temperature` entre `HEART_LIMITS.temperatureMin` y
  `temperatureMax`;
- `knowledge.mode === "platform_acl"`;
- `knowledge.declaredFiles` es un arreglo de strings;
- `capabilities.tools` solo contiene `HeartTool` conocidas y sin duplicados;
- `admin.scope` es `personal` o `company`;
- `admin.status` es un `HeartStatus` válido;
- `admin.version` es entero `>= 1`;
- `admin.publishedAt` es `null` o texto de hasta 100 caracteres (Fase 1);
- `timestamps.createdAt` y `updatedAt` son strings.

El resultado es discriminado:

```ts
type ValidationResult =
  | { ok: true; value: HeartDefinition }
  | { ok: false; error: string };
```

### 2.4 Ciclo de vida

```ts
type HeartStatus = "draft" | "published" | "paused" | "revoked" | "archived";
```

Transiciones:

| Desde | Hacia |
| --- | --- |
| `draft` | `published`, `archived` |
| `published` | `paused`, `revoked`, `archived` |
| `paused` | `published`, `revoked`, `archived` |
| `revoked` | `archived` |
| `archived` | `draft` (reactivación administrativa) |

Solo `published` es usable por `isHeartUsable`. `draft` queda para revisión
administrativa; `paused`, `revoked` y `archived` no inician ejecuciones
normales. La tabla se implementó en Fase 1; la reactivación de `archived` se
añadió como expansión de Fase 1, siempre auditada y con autorización de
perímetro.

### 2.5 Conocimiento

En Fase 0 el único modo es `platform_acl`:

- el Heart no aporta una lista de archivos con bypass;
- `declaredFiles` es una declaración informativa, no un ACL;
- la recuperación real siempre pasa por `retrieveKb` /
  `retrieveAccessibleChunks` con el usuario autenticado.

Esto evita duplicar RAG/ACL y deja la ampliación de fuentes para una fase
posterior.

### 2.6 `HeartVersion`

```ts
type HeartVersion = {
  heartId: string;
  version: number;
  snapshot: HeartDefinition;
  authorId: string;
  createdAt: string;
  changeSummary: string;
};
```

`validateHeartVersion` exige:

- `heartId` no vacío;
- `version` entero `>= 1`;
- `snapshot` válido según `validateHeartDefinition`;
- `snapshot.id === heartId`;
- `snapshot.admin.version === version`;
- `authorId` y `createdAt` no vacíos;
- `changeSummary` máximo 500 caracteres.

La tabla `heart_versions` existe desde la migración `013` y persiste snapshots
completos. El resolver de Fase 2 ejecuta el snapshot de la versión vigente.

## 3. `HeartExecution`

### 3.1 Forma

```ts
type HeartExecution = {
  executionId: string;
  actor: { id: string; role: string };
  heart: HeartDefinition;
  chatId: string;
  model: string;
  temperature: number;
  instructions: string;
  allowedTools: HeartTool[];
  knowledge: HeartDefinition["knowledge"];
  limits: {
    maxSteps: number;
    timeoutMs: number;
    maxOutputTokens: number;
  };
  startedAt: string;
};
```

### 3.2 Construcción

`buildHeartExecution(input)` no llama al modelo. Devuelve:

```ts
type HeartExecutionResult =
  | { ok: true; execution: HeartExecution }
  | { ok: false; error: string };
```

Reglas:

1. Si `heart.admin.status` no es `published`, devuelve error.
2. `model = heart.model.name?.trim() || defaultModel.trim()`.
3. Si el modelo resultante está vacío, devuelve error.
4. `temperature = heart.model.temperature`.
5. `allowedTools` es la intersección entre las tools propuestas por el runtime y
   las declaradas por el Heart; conserva orden y elimina duplicados.
6. Los límites se mezclan con `DEFAULT_HEART_EXECUTION_LIMITS` y se validan.
7. `startedAt` se puede inyectar para pruebas; por defecto es la hora actual.

### 3.3 Límites por defecto

```ts
{
  maxSteps: 8,
  timeoutMs: 120_000,
  maxOutputTokens: 4096
}
```

Los límites son un contrato. Fase 2 aplica `timeoutMs` y `maxOutputTokens` al
stream principal; `maxSteps` queda reservado porque el runtime actual no ejecuta
un bucle de tools.

### 3.4 Modelo y temperatura

- `model = null` conserva el modelo actual del chat (`getChatModel()`), sin
  hardcodear un modelo en el Heart.
- La temperatura del Heart se aplica al stream principal del Heart. El chat
  normal y Soporte conservan la configuración actual del entorno.
- Las llamadas auxiliares (decisión de búsqueda y generación de documentos)
  usan el modelo resuelto del Heart, pero no fuerzan temperatura.

### 3.5 Resolver de runtime

`lib/heart-resolver.ts` construye el `HeartExecution` compartido por
`/api/chat` y `/api/chat/regenerate`:

```ts
type ChatHeartRuntime = {
  kind: "normal" | "support" | "heart";
  definition: HeartDefinition | null;
  execution: HeartExecution | null;
  model: string;
  temperature: number | undefined;
  allowedTools: HeartTool[] | null;
};
```

- `heart`: resuelve el snapshot publicado vigente y construye la ejecución.
- `support`: conserva prompt oficial, modelo actual y solo `read_files`.
- `normal`: no tiene ejecución y conserva todas las ramas.
- Si el Heart no está publicado o no existe, devuelve `409`.

## 4. `ToolContract`

### 4.1 Forma

```ts
type ToolContract = {
  id: ToolId;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  requiredCapabilities: readonly Capability[];
  risk: "low" | "medium" | "high";
  integration: string | null;
  version: number;
  status: "active" | "disabled";
  requiresApproval: boolean;
};
```

### 4.2 IDs

```ts
type ToolId =
  | "read_files"
  | "generate_docs"
  | "web_search"
  | "analyze_images"
  | "kb_search"
  | "prepare_escalation";
```

Las cuatro primeras son seleccionables por un Heart. `kb_search` y
`prepare_escalation` son herramientas de plataforma.

IDs históricos del agente oficial:

| Histórico | Canónico |
| --- | --- |
| `knowledge_base` | `kb_search` |
| `conversation_files` | `read_files` |
| `prepare_escalation` | `prepare_escalation` |

`resolveToolId` acepta ambos; `isToolId` solo acepta el canónico.

### 4.3 Riesgo y aprobación

| Tool | Riesgo | Aprobación | Integración |
| --- | --- | --- | --- |
| `kb_search` | `low` | No | Ninguna; ACL de plataforma |
| `read_files` | `low` | No | Archivos de la conversación |
| `generate_docs` | `medium` | No | Generación local de PDF/DOCX/XLSX |
| `web_search` | `medium` | No | Búsqueda externa |
| `analyze_images` | `low` | No | Modelo de visión |
| `prepare_escalation` | `low` | No | Vista previa; sin ServiceDesk |

`requiresApproval` queda en el contrato para herramientas futuras que escriban
en sistemas externos. En Fase 0 ninguna lo requiere.

### 4.4 Validación

`validateToolContract(input)` comprueba:

- `id` canónico;
- nombre y descripción no vacíos;
- `inputSchema` y `outputSchema` son objetos;
- `requiredCapabilities` solo contiene `Capability` conocidas;
- `risk` y `status` válidos;
- `integration` es `string | null`;
- `version` entero `>= 1`;
- `requiresApproval` booleano.

## 5. Qué no hace Fase 0

- No crea la migración `013`.
- No añade columnas `description`, `model`, `status`, `version` ni
  `heart_versions`.
- No conecta `HeartDefinition` a `readHeartForUser`.
- No conecta `HeartExecution` a `/api/chat`.
- No crea Tool Registry ni Tool Gateway.
- No implementa MCP, Tasks, Workflows, credenciales, autonomía ni integraciones.
- No cambia la UI ni el comportamiento de Soporte.

## 6. Ejemplo de uso futuro (no conectado)

```ts
const definition = toHeartDefinition(heartRow);
const validation = validateHeartDefinition(definition);
if (!validation.ok) throw new Error(validation.error);

const execution = buildHeartExecution({
  executionId: crypto.randomUUID(),
  actor: { id: user.id, role: user.role },
  heart: validation.value,
  chatId,
  defaultModel: getChatModel(),
  instructions: buildHeartInstructions(validation.value),
  allowedTools: ["read_files", "generate_docs"],
});
```

Este ejemplo documenta la intención. No debe copiarse al runtime hasta que la
Fase 2 esté aprobada.

## 7. Decisiones pendientes

1. ¿`draft` es visible para el propietario o solo para administración?
2. ¿`revoked` permite reactivación administrativa o es terminal?
3. ¿La temperatura se aplica a todos los modelos locales o solo a los que la
   soportan?
4. ¿`declaredFiles` se convierte en una selección real de fuentes o desaparece
   en favor de políticas por área?
5. ¿`version` incrementa en cada edición o solo en publicaciones?
6. ¿Las tools de plataforma (`kb_search`, `prepare_escalation`) se muestran en
   la UI o quedan implícitas por tipo de Heart?

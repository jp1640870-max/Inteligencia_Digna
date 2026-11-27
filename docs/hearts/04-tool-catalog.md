# 04 — Catálogo base de herramientas

## 1. Propósito

Fijar el vocabulario de herramientas antes de introducir un Tool Registry o un
Tool Gateway. El catálogo vive en `lib/tool-contract.ts` y no está conectado al
runtime.

Una herramienta es una capacidad declarada por la plataforma. Un usuario no
puede registrar herramientas, instalar código ni definir integraciones
arbitrarias.

## 2. Catálogo canónico

| ID | Nombre | Riesgo | Aprobación | Integración | Seleccionable por Heart |
| --- | --- | --- | --- | --- | --- |
| `kb_search` | Buscar en la base de conocimiento | `low` | No | ACL de plataforma | No (implícita) |
| `read_files` | Leer archivos de la conversación | `low` | No | Archivos del chat | Sí |
| `generate_docs` | Generar documentos | `medium` | No | PDF/DOCX/XLSX local | Sí |
| `web_search` | Buscar en internet | `medium` | No | Búsqueda externa | Sí |
| `analyze_images` | Analizar imágenes | `low` | No | Modelo de visión | Sí |
| `prepare_escalation` | Preparar escalamiento | `low` | No | Vista previa; sin ServiceDesk | No (implícita en Soporte) |

`HEART_SELECTABLE_TOOLS` coincide hoy con `HEART_TOOLS`:

```ts
["read_files", "generate_docs", "web_search", "analyze_images"]
```

## 3. IDs históricos

El agente oficial usa IDs propios. Se mantienen para compatibilidad:

| Histórico | Canónico |
| --- | --- |
| `knowledge_base` | `kb_search` |
| `conversation_files` | `read_files` |
| `prepare_escalation` | `prepare_escalation` |

`resolveToolId` acepta ambos. `isToolId` solo acepta el canónico. La migración de
Soporte a una definición persistida debe usar `resolveToolId` para no romper
`OfficialAgent.allowedTools`.

## 4. Contrato

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

Campos:

- `requiredCapabilities`: capabilities de panel necesarias para ejecutar la tool.
  En Fase 0 todas están vacías porque el acceso se decide por contexto de chat y
  ACL. `hearts.manage` no es un permiso de ejecución de chat.
- `risk`: clasificación para UI, auditoría y futuras aprobaciones.
- `integration`: `null` mientras no haya conector externo.
- `version`: versión del contrato, no del Heart.
- `status`: permite deshabilitar una tool sin borrarla del catálogo.
- `requiresApproval`: reservado para tools que escriban en sistemas externos.

## 5. Gating actual

Hoy el gating no usa `ToolContract`. Vive en `app/api/chat/route.ts`:

```ts
const heartToolAllowed = (tool: HeartTool): boolean => {
  if (supportAgent) return tool === "read_files";
  if (!heart) return true;
  return heart.tools.includes(tool);
};
```

Consecuencias:

- Chat normal: todas las tools.
- Heart: solo las declaradas.
- Soporte: solo `read_files`; KB y escalamiento son ramas oficiales.
- Generación de imágenes: `!supportAgent && !heart`.
- KB y RAG: siempre se recuperan con ACL; el gating decide si se inyectan y si
  se ejecuta la rama.

## 6. Comportamiento esperado por tool

### `kb_search`

- Recupera fragmentos autorizados por el ACL.
- No acepta un `userId` del cliente.
- No permite bypass por Heart.
- Devuelve fuentes para la UI.
- Si no hay evidencia, Soporte debe decirlo explícitamente.

### `read_files`

- Lee archivos adjuntos a la conversación actual.
- No accede a archivos de otros chats.
- En Soporte es la única tool de Heart permitida.
- El contenido se inyecta en el mensaje del usuario, no en el system prompt.

### `generate_docs`

- Genera PDF, DOCX o XLSX reales.
- No está disponible en Hearts que no la declaren.
- No está disponible en Soporte.
- No debe confundirse con generación de imágenes.

### `web_search`

- Consulta fuentes externas.
- No está disponible en Hearts que no la declaren.
- No está disponible en Soporte.
- Las citas deben corresponder a resultados reales.

### `analyze_images`

- Analiza imágenes adjuntas con el modelo de visión.
- No está disponible en Hearts que no la declaren.
- No está disponible en Soporte.
- La generación de imágenes no es esta tool.

### `prepare_escalation`

- Prepara una vista previa determinista.
- No crea tickets, no persiste y no escribe en ServiceDesk.
- Solo aplica a chats de Soporte.
- El cliente solo puede enviar un motivo opcional; el resto se deriva del chat.

## 7. Matriz de contexto

| Contexto | `kb_search` | `read_files` | `generate_docs` | `web_search` | `analyze_images` | `prepare_escalation` |
| --- | --- | --- | --- | --- | --- | --- |
| Chat normal | Implícita | Sí | Sí | Sí | Sí | No |
| Heart con tool | Implícita | Declarada | Declarada | Declarada | Declarada | No |
| Heart sin tool | Implícita | No | No | No | No | No |
| Soporte | Implícita | Sí | No | No | No | Vista previa |

“Implícita” significa que la plataforma la ejecuta sin que aparezca en
`heart.tools`.

## 8. Qué no hace Fase 0

- No crea Tool Registry ni Tool Gateway.
- No ejecuta tools desde el modelo.
- No añade tool calling estructurado.
- No añade MCP.
- No añade credenciales por tool.
- No añade aprobaciones humanas.
- No añade integraciones externas.
- No cambia la UI de selección de tools.

## 9. Camino a Fase 3

1. Validar `ToolContract` al arranque.
2. Resolver `ToolId` canónico desde IDs históricos.
3. Construir `HeartExecution.allowedTools` por intersección.
4. Validar entrada/salida contra `inputSchema`/`outputSchema`.
5. Aplicar timeout, límites y auditoría.
6. Introducir `requiresApproval` solo cuando exista una tool de escritura.
7. Mantener `kb_search` siempre subordinada al ACL.

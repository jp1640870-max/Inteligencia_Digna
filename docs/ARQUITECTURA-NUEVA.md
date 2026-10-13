# Arquitectura del backend nuevo

## Objetivo

El backend de desarrollo usa una base PostgreSQL consultable directamente, pgvector para RAG, MinIO para archivos y Ollama nativo en la DGX. La aplicación conserva la lógica de negocio existente, pero la inferencia y la persistencia ya no dependen de SGLang ni de SQLite en el runtime nuevo. Node.js 22 LTS está fijado en `.nvmrc`.

| Componente | Responsabilidad |
|---|---|
| Next.js/Node.js | API, autenticación, streaming, RAG y orquestación |
| PostgreSQL 16 + pgvector | Datos relacionales, configuración, auditoría y vectores |
| MinIO | Archivos originales, documentos y adjuntos |
| Ollama | Inferencia local en la DGX |
| DBeaver/VS Code | Consulta y manipulación directa de PostgreSQL |

## Diagrama

```text
┌──────────────────────────────────────────┐
│ Navegador                                  │
│ Frontend + API /api/*                      │
└────────────────────┬─────────────────────┘
                     │ cookies / HTTP
┌────────────────────▼─────────────────────┐
│ Backend Node.js                           │
│                                          │
│ Auth · RBAC · chat · RAG · agentes       │
│ PostgreSQL client · S3 client             │
└──────────────┬───────────────┬───────────┘
               │               │
               │               └──────────────► MinIO :9000
               │                              objetos S3
               │
               ├────────────────────────────────► PostgreSQL :5432
               │                                  pgvector
               │
               └────────────────────────────────► Ollama :51234
                                                      │
                                         ┌────────────┼────────────┐
                                         │            │            │
                                      Qwen3.8      Qwen3.6      BGE-M3
                                        chat        agentes     embeddings
```

El navegador nunca conoce `DATABASE_URL`, `MINIO_ENDPOINT` ni `OLLAMA_URL`. Esas credenciales viven en el servidor.

## File tree

```text
.
├── .env.example
├── Dockerfile
├── compose.yaml
├── docs/
│   ├── ARQUITECTURA-NUEVA.md
│   ├── COMANDOS.md
│   └── SERVIDOR.md
├── migrations/
│   ├── 001_initial.sql
│   ├── 002_legacy_and_embedding_metadata.sql
│   └── 003_rbac.sql           áreas, grupos, grants y pending_review
├── deploy/
│   └── pgadmin/
│       └── servers.json        conexión precargada (sin secretos)
├── scripts/
│   ├── db-migrate.ts
│   ├── db-seed.ts
│   ├── db-smoke.ts
│   ├── db-import-sqlite.ts
│   ├── db-reindex-embeddings.ts
│   ├── db-query.ts
│   └── storage-init.ts
├── app/
│   ├── api/
│   ├── admin/
│   └── ...
├── lib/
│   ├── db-connection.ts       Pool pg y transacciones
│   ├── db.ts                  acceso a datos
│   ├── projects.ts            acceso a proyectos
│   ├── ollama.ts              chat, NDJSON, embeddings y health
│   ├── storage.ts             cliente S3/MinIO
│   ├── rag.ts                 chunking y retrieval
│   ├── permissions.ts         matriz rol → capacidad (fuente única)
│   ├── kb-access.ts           política de lectura (fuente única)
│   └── kb.ts                  Knowledge Base
├── tests/
│   ├── ollama.test.ts
│   ├── rag.test.ts
│   ├── permissions.test.ts    matriz de capacidades, sin base de datos
│   ├── kb-access.test.ts      política, sin base de datos
│   ├── kb-access-db.test.ts   resolución real contra Postgres
│   └── ...
└── package.json
```

## Puesta en marcha

### 1. Configurar variables

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Completar `JWT_SECRET`, `DATABASE_URL`, las credenciales de MinIO y los tags reales de Ollama.

### 2. Levantar servicios locales

```bash
docker compose up -d --build
docker compose ps
```

Servicios:

- Aplicación: `http://127.0.0.1:3000`.
- PostgreSQL: `127.0.0.1:5433` en el host y `postgres:5432` dentro de Docker.
- MinIO local, mediante el perfil `local-storage`: API `http://127.0.0.1:9000` y consola `http://127.0.0.1:9001`.
- Bucket inicial: `MINIO_BUCKET`, `attachments` por defecto.

### 3. Crear el esquema

```bash
npm run db:migrate
npm run db:seed
npm run storage:init
npm run smoke:db
```

El esquema se aplica desde `migrations/`. `schema_migrations` registra versión, nombre, checksum y fecha. La aplicación ya no crea tablas durante cada request.

### 4. Configurar Ollama

```bash
curl "$OLLAMA_URL/api/tags"
```

La API nativa que consume el backend es:

```text
POST /api/chat
POST /api/embed
GET  /api/tags
```

Variables de modelos:

| Variable | Valor inicial |
|---|---|
| `OLLAMA_URL` | `http://<IP-DGX>:51234` |
| `OLLAMA_CHAT_MODEL` | Tag exacto de Qwen3.8 Q4 |
| `OLLAMA_AGENT_MODEL` | Tag exacto de Qwen3.6 Q4 |
| `OLLAMA_EMBEDDING_MODEL` | `inteligencia-digna:bge-m3-rag` |
| `OLLAMA_CHAT_CONTEXT_LENGTH` | `32768` |
| `OLLAMA_AGENT_CONTEXT_LENGTH` | `49152` |
| `OLLAMA_CHAT_KEEP_ALIVE` | `-1` o duración larga |
| `OLLAMA_AGENT_KEEP_ALIVE` | `5m` inicialmente |
| `OLLAMA_EMBEDDING_KEEP_ALIVE` | `0` |

`OLLAMA_NUM_PARALLEL`, `OLLAMA_MAX_LOADED_MODELS` y la memoria de la DGX son configuración del servidor Ollama, no variables que el backend manipule por request.

## PostgreSQL y pgvector

Las columnas de embeddings usan `vector(1024)`:

- `rag_chunks.embedding`.
- `kb_chunks.embedding`.

Los índices HNSW permiten búsqueda coseno. El retrieval de RAG sigue aplicando el top-k y el umbral para no cambiar el comportamiento del producto durante la transición.

La conexión usa un pool `pg` y consultas parametrizadas. Las operaciones que modifican varios registros usan transacciones. Las funciones de acceso son asíncronas porque PostgreSQL no es síncrono.

### Importar la base actual

```bash
SQLITE_PATH=data/app.db npm run db:import
```

El importador:

1. Lee SQLite en modo read-only.
2. Mapea identificadores heredados a UUID.
3. Importa usuarios, chats, mensajes, proyectos, KB y auditoría.
4. Convierte timestamps a `TIMESTAMPTZ` y JSON a `JSONB`.
5. Convierte embeddings JSON a vectores de 1024 dimensiones.
6. Reporta y conserva los chunks RAG cuyo `chat_id` no existe; los importa con `chat_id NULL` para no perder el texto y permite reindexarlos o asociarlos posteriormente.
7. No modifica `data/app.db`.

Después se debe ejecutar:

```bash
npm run db:reindex
```

El comando recalcula los embeddings con el `OLLAMA_EMBEDDING_MODEL` actual y verifica la dimensión. La fuente SQLite permanece intacta hasta validar el corte.

El importador no interpreta automáticamente `data/chats.json` ni `data/projects.json`; esos archivos quedan como archivo legacy y requieren una migración de producto específica.

## MinIO/S3

Los archivos de Knowledge Base se guardan como objetos MinIO. PostgreSQL guarda únicamente la metadata en `attachments`:

- `bucket`.
- `object_key`.
- nombre original.
- MIME y extensión.
- tamaño.
- SHA-256.
- usuario que subió el archivo.
- estado de la carga.

La aplicación usa `lib/storage.ts` con `S3Client`, por lo que el mismo código funciona con MinIO local o un proveedor S3 compatible.

```text
Upload KB
   │
   ├── extraer texto
   ├── subir binario a MinIO
   ├── registrar attachment en PostgreSQL
   └── generar embeddings
```

La eliminación de un archivo KB elimina primero el objeto y después sus metadatos. La ruta `GET /api/admin/knowledge/files/:id/download` descarga el objeto almacenado.

## Acceso directo desde el editor

### pgAdmin 4

Es la herramienta de gestión del proyecto y el equivalente de SSMS para PostgreSQL. Vive en el perfil `db-tools` de `compose.yaml`:

```bash
docker compose --profile db-tools up -d pgadmin
xdg-open http://127.0.0.1:5050
```

| Aspecto | Decisión |
|---|---|
| Acceso | `127.0.0.1:5050` únicamente |
| Perfil | `db-tools`, no arranca con la app |
| Persistencia | volumen `pgadmin_data` (`/var/lib/pgadmin`) |
| Configuración | `SERVER_MODE=1` para cifrar el config store |
| Servidor precargado | `deploy/pgadmin/servers.json` |
| Cookie | `ENHANCED_COOKIE_PROTECTION=True` |

El usuario `inteligencia_digna` es superusuario, por lo que pgAdmin permite crear extensiones (incluida `vector`), roles y bases sin restricciones. Como el DDL no tiene reversión, toma un `pg_dump` antes de cambios estructurales.

`deploy/pgadmin/servers.json` no contiene secretos y sí se versiona. pgAdmin no admite exportar contraseñas, así que la de PostgreSQL se pega una vez y queda en el volumen.

### DBeaver

1. Crear conexión PostgreSQL.
2. Host `127.0.0.1` y puerto `5433` (o el valor de `POSTGRES_PORT`).
3. Usar `POSTGRES_DB`, `POSTGRES_USER` y `POSTGRES_PASSWORD`.
4. Desactivar SSL para el Compose local.
5. Abrir el esquema `public`.

Consultas iniciales:

```sql
SELECT version, name, applied_at
FROM schema_migrations
ORDER BY version;

SELECT extname, extversion
FROM pg_extension
WHERE extname IN ('vector', 'pgcrypto');

SELECT id, filename, status, created_at
FROM kb_files
ORDER BY created_at DESC;
```

### VS Code

1. Instalar la extensión PostgreSQL de Microsoft.
2. Abrir la raíz del repositorio.
3. Crear una conexión con los valores de `.env`.
4. No guardar la contraseña en un archivo versionado.
5. Ejecutar las consultas de `schema_migrations` y `pg_extension`.

También se puede usar `psql` con `DATABASE_URL` sin modificar la configuración del proyecto.

Desde la terminal del proyecto también se puede consultar o modificar SQL explícitamente:

```bash
npm run db:query -- "SELECT COUNT(*) FROM users"
npm run db:query -- "UPDATE config SET value = '32768' WHERE key = 'ollama_context_length'"
```

Las sentencias `SELECT`, `SHOW`, `EXPLAIN` y `WITH` se ejecutan dentro de una transacción de solo lectura.

## RAG y bajo demanda

`retrieveRelevantChunks` y `retrieveKb` consultan primero si existen chunks. Si no hay documentos, no generan embeddings y no cargan BGE-M3.

La indexación utiliza batches y `/api/embed`. Un cambio de modelo de embeddings exige reindexar ambos conjuntos y revisar la dimensión de las columnas vectoriales.

## Control de acceso a la base de conocimiento

La Knowledge Base no se protege por categoría sino por archivo. El identificador que decide es `kb_files.id`: un grant lo nombra de forma explícita y, sin ese grant, nadie lo lee. Las categorías solo clasifican y `kb_chunks.category_id` no autoriza nada.

### Roles

| Rol | Lee la KB | Sube | Aprueba | Reparte grants |
|---|---|---|---|---|
| `super_admin` | Todo (bypass) | Sí | Sí | Sí |
| `admin` | Todo (bypass) | Sí | Sí | Sí |
| `editor` | Lo concedido **y lo que él sube** | Sí | No | No |
| `user` | Solo lo concedido | No | No | No |

El bypass de `admin` y `super_admin` es deliberado: son el perímetro. El control sobre ellos es detective, no preventivo, y por eso las dos acciones quedan registradas: `audit_log` y revisión mensual de la pantalla de Accesos.

`editor` es un segundo control. Puede subir, reclasificar y mover contenido, pero no decide ni la publicación ni quién lo lee. Si pudiera otorgar, su propia subida quedaría accesible por su decisión sin que nadie más la validara.

Las capacidades por rol viven en `lib/permissions.ts` como una matriz explícita, y las rutas las piden con `requireCapability("kb.publish")` en vez de declarar roles. Lo que la tabla de arriba significa en el código es: `editor` tiene `kb.read`, pero la capability solo abre la puerta al endpoint; qué archivos salen lo decide el ACL.

### Lo que ve el `editor`

Ver sus propias subidas no es una excepción al modelo, es lo que hace que `editor` sea un rol útil, y conviene decir por qué no abre nada:

- Un archivo recién subido vive en `pending_review`: no está indexado y a un solo grant de ser visible. Verlo desde el panel es comprobar que la extracción funcionó; verlo desde el chat saltaría la cola de revisión.
- Verlo no lo aprueba. La aprobación sigue siendo del perímetro, y sin grants sigue sin ser legible para nadie más.
- `preview` y `download` exigen lo mismo que el listado, así que un `editor` no puede abrir el contenido de un documento ajeno aunque conozca su identificador.

Antes, `preview` y `download` admitían `editor` sin mirar el ACL, y `GET /knowledge/files` filtraba por el contenido completo: un `editor` podía leer cualquier documento, incluidos los no publicados, y usar el buscador para confirmar si un texto arbitrario estaba dentro de uno ajeno. Esa ruta es `kb.read` **más** `userCanReadKbFile`, nunca solo la capability.

### Principios

Un grant apunta a un área o a un grupo. No hay grants por usuario: si una persona necesita leer un documento que su área no concede, la vía es un grupo con esa concesión. Las áreas son la vía normal de trabajo: cada usuario tiene al menos una y hereda todo lo que el área tenga concedido. Los grupos sirven para afinar permisos sin crear áreas.

Desactivar un área **conserva** los grants, de modo que reactivar devuelve el acceso exactamente como estaba y sirve como mecanismo reversible ante una urgencia. Desactivar un grupo, en cambio, **revoca** sus grants: un grupo es una decisión de permisos activa, no un contenedor de historial.

La asimetría se sostiene en la capa de datos, no en las rutas: `is_active` no está entre los campos que `updateUserGroup` acepta, así que la única forma de desactivar un grupo es la que revoca. Un `PATCH` con `is_active` devuelve 400 en vez de ignorar el campo.

### Publicación

Una subida nueva nace `pending_review`: el texto se extrae y se guarda, pero no se indexa ni es buscable. El chunking y los embeddings se ejecutan al aprobar, no antes, para no gastar cómputo ni embeddings en un documento que se iba a rechazar.

Aprobar y conceder acceso son dos decisiones separadas y auditables. Aprobar no otorga acceso por sí mismo.

Los grants solo pueden concederse sobre archivos `active`. Conceder acceso a un documento pendiente de aprobación lo volvería legible sin pasar por la cola de revisión.

### Reglas que sostienen el modelo

- **Fail closed**: sin grant explícito no hay lectura.
- **Sin caché de permisos**: cada consulta revalida, así una revocación surte efecto en la siguiente petición. Si se añadiera caché, tendría que invalidarse en cada cambio de grant o área.
- **Aprobar sin texto extraído falla**: un documento que no produce fragmentos no se marca activo, porque el estado mentiría sobre su disponibilidad.
- **El listado de la KB no devuelve contenido**: solo metadatos. El texto llega por el endpoint de preview, que se audita y comprueba el ACL.
- **La capability no es el acceso**: `kb.read` dice que el rol entra al endpoint; el predicado de ACL dice de qué archivo se trata. Un endpoint que devuelve contenido sin el predicado es un agujero, aunque la capability sea correcta.
- **Los grants solo salen hacia el perímetro**: el detalle de un área o de un grupo incluye la ACL y es `org.read.detail`. El catálogo (`org.read`) no la incluye y sí lo ve `editor`.
- **El último `super_admin` no se puede degradar ni borrar**, con un guard transaccional que serializa las operaciones concurrentes.

### Límite de responsabilidad

Las APIs revalidan el rol en cada petición. Ocultar un enlace en el panel es solo experiencia de usuario: no es un control de seguridad. Si alguien llama al endpoint directamente, la autorización se decide en el servidor.

`app/admin/layout.tsx` cierra `/admin/*` en el servidor: resuelve la sesión y comprueba `admin.access` antes de renderizar. Sin eso, el árbol de las páginas del panel se servía a cualquiera y solo los datos quedaban protegidos, ruta por ruta. El `useEffect` de `AdminShell` sigue ahí para cuando la sesión caduca con el panel abierto, y eso es experiencia de usuario, no control.

### Recuperación

`npm run db:create-admin` crea un `super_admin` con la contraseña de `ADMIN_PASSWORD`. Es el mecanismo de ruptura previsto cuando no queda ninguno accesible, por ejemplo tras un bloqueo de la cuenta. El rol por defecto es `super_admin` porque un `admin` no puede crear ni administrar super_admins: si el valor por defecto fuera más bajo, el comando de recuperación crearía una cuenta sin la capacidad que existe para recuperar. `ADMIN_ROLE=admin` lo pide explícitamente.

## Seguridad de la fase de desarrollo

- Mantener PostgreSQL, MinIO y Ollama en red local.
- No exponer el puerto `51234` a Internet.
- No enviar `OLLAMA_URL` al navegador.
- Mantener `.env` fuera de Git.
- Usar el cliente SQL con una cuenta de desarrollo separada de la cuenta de migración.
- Antes de producción, agregar firewall, TLS, respaldos gestionados y control de acceso.

## Verificación

```bash
npm run lint
npx tsc --noEmit
npm test
npm run smoke:db
npm run build
```

El smoke de PostgreSQL sólo consulta el esquema. El smoke de Ollama es opt-in:

```bash
SMOKE_LIVE=1 npm test
```

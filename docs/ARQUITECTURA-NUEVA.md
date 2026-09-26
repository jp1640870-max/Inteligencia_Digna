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
│   └── 002_legacy_and_embedding_metadata.sql
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
│   └── kb.ts                  Knowledge Base
├── tests/
│   ├── ollama.test.ts
│   ├── rag.test.ts
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

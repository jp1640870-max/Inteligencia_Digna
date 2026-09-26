# Comandos y flujo de desarrollo

La documentación de arquitectura está en [`ARQUITECTURA-NUEVA.md`](./ARQUITECTURA-NUEVA.md).

## Requisitos

- Node.js 22 LTS (`.nvmrc`).
- Docker Compose v2.
- Ollama nativo accesible desde el backend, normalmente en `http://<IP-DGX>:51234`.
- Modelos Ollama instalados: Qwen3.8, Qwen3.6 y BGE-M3.

## Configurar el entorno

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Completa `JWT_SECRET`, `DATABASE_URL`, las credenciales de MinIO y los tags exactos de Ollama en `.env`. `.env` está ignorado por Git.

## Levantar PostgreSQL, la aplicación y MinIO

El Compose principal levanta PostgreSQL, ejecuta las migraciones y arranca la aplicación:

```bash
docker compose up -d --build
docker compose ps
```

PostgreSQL queda disponible en `localhost:5433` en este entorno y la aplicación en `http://127.0.0.1:3000`.

MinIO local es un perfil opcional porque la imagen puede no estar disponible en todos los registros:

```bash
docker compose --profile local-storage up -d --build
docker compose --profile local-storage run --rm storage-init
```

Si MinIO no está disponible, el chat y la base pueden funcionar, pero las operaciones de archivos de Knowledge Base quedarán desactivadas hasta configurar un S3/MinIO externo.

## Crear el esquema y los datos iniciales

```bash
npm run db:migrate
npm run db:seed
npm run storage:init
npm run smoke:db
```

`db:migrate` aplica `migrations/*.sql` en orden y registra checksum en `schema_migrations`. `db:seed` es idempotente y no crea usuarios ni contraseñas. Para crear el primer administrador usa `npm run db:create-admin` con `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` y `ADMIN_ROLE`. Para resetear una contraseña usa `npm run db:reset-password -- email nueva-password`.

## Ollama

El backend usa la API nativa, no SGLang:

```text
POST /api/chat
POST /api/embed
GET  /api/tags
```

Variables principales:

| Variable | Uso |
|---|---|
| `OLLAMA_URL` | URL del servidor Ollama |
| `OLLAMA_CHAT_MODEL` | Qwen3.8 para chat |
| `OLLAMA_AGENT_MODEL` | Qwen3.6 para agentes/edición |
| `OLLAMA_EMBEDDING_MODEL` | BGE-M3 para RAG |
| `OLLAMA_CHAT_CONTEXT_LENGTH` | Contexto del chat, inicialmente `32768` |
| `OLLAMA_AGENT_CONTEXT_LENGTH` | Contexto de agentes, inicialmente `49152` |
| `OLLAMA_CHAT_KEEP_ALIVE` | Política de permanencia del chat |
| `OLLAMA_AGENT_KEEP_ALIVE` | Política de permanencia de agentes |
| `OLLAMA_EMBEDDING_KEEP_ALIVE` | `0` para carga bajo demanda |

Verificar modelos sin iniciar una inferencia:

```bash
curl "$OLLAMA_URL/api/tags"
```

El smoke opcional contra Ollama real se ejecuta con:

```bash
SMOKE_LIVE=1 npm test
```

## Ejecutar la aplicación

```bash
npm run dev
```

El lanzador usa HTTPS experimental para el flujo OAuth local. Para iniciar Next.js directamente:

```bash
npm run dev:next
```

## Migrar datos desde SQLite

El importador es explícito y no modifica `data/app.db`:

```bash
SQLITE_PATH=data/app.db npm run db:import
```

Después se deben reindexar los embeddings contra el modelo BGE-M3 instalado:

```bash
npm run db:reindex
```

El importador conserva la base SQLite como fuente de rollback. No se debe apuntar `DATABASE_URL` a producción sin snapshot y validación.

## Acceder directamente a la base

### pgAdmin 4 (equivalente a SSMS para PostgreSQL)

Arranca el perfil `db-tools` y abre el navegador:

```bash
docker compose --profile db-tools up -d pgadmin
xdg-open http://127.0.0.1:5050
```

1. Inicia sesión con `PGADMIN_EMAIL` y `PGADMIN_PASSWORD` de `.env`.
2. El servidor **Inteligencia Digna (Docker)** ya aparece precargado en el árbol.
3. En el diálogo de password pega `POSTGRES_PASSWORD` de `.env`. pgAdmin no permite precargar contraseñas en `servers.json`, pero la guarda en el volumen `pgadmin_data`, así que solo se escribe una vez.
4. Desde ahí puedes editar datos, esquemas, usuarios, extensiones y hacer backups.

pgAdmin queda ligado solo a `127.0.0.1:5050` y vive en un perfil aparte: no arranca con `docker compose up -d` y no es accesible desde la red. El rol `inteligencia_digna` es superusuario, así que todo está disponible sin excepciones.

Para detenerlo:

```bash
docker compose --profile db-tools stop pgadmin
```

### DBeaver

1. Crear una conexión PostgreSQL.
2. Host `127.0.0.1`, puerto `5433` (o el valor de `POSTGRES_PORT`).
3. Base, usuario y contraseña de `POSTGRES_*` o `DATABASE_URL`.
4. SSL desactivado para el Compose local.
5. Abrir el esquema `public`.

También se puede usar la terminal:

```bash
npm run db:query -- "SELECT COUNT(*) FROM users"
```

### VS Code

1. Instalar la extensión PostgreSQL de Microsoft.
2. Abrir la carpeta del proyecto.
3. Crear una conexión con los valores de `.env`.
4. No guardar contraseñas en un archivo versionado.
5. Ejecutar:

```sql
SELECT version, name, applied_at
FROM schema_migrations
ORDER BY version;
```

## Verificación

```bash
npm run lint
npx tsc --noEmit
npm test
npm run smoke:db
npm run build
```

`smoke:db` sólo consulta la base configurada; no crea ni modifica datos.

## Respaldo

El endpoint de backup usa `pg_dump` y almacena el archivo en `data/backups`. El archivo debe estar en un volumen persistente y fuera del repositorio. Para una instalación real, complétalo con PITR/WAL archiving del servidor PostgreSQL y backup separado de MinIO.

## Nota de seguridad

El entorno nuevo no debe exponer PostgreSQL, MinIO ni Ollama a Internet sin autenticación, firewall y TLS. Durante desarrollo, mantén el acceso limitado a la red local y no subas `.env` al repositorio.

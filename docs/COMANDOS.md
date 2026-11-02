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

En PowerShell:

```powershell
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Para generar una contraseña de servicio de 48 caracteres hex (PostgreSQL/MinIO/pgAdmin):

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Completa `JWT_SECRET`, `DATABASE_URL`, las credenciales de MinIO y los tags exactos de Ollama en `.env`. `.env` está ignorado por Git.

Verifica la configuración:

```bash
npm run env:check
npm run env:show
```

`env:check` valida contraseñas, URLs y variables obligatorias; `npm run env:check:strict` convierte las advertencias en errores. `env:show` imprime las credenciales de servicio y la contraseña del admin (`ADMIN_PASSWORD` en `.env`, o `..\Inteligencia_Digna.local\CREDENTIALS.md` como respaldo).

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

### Google OAuth con ngrok

El servidor de desarrollo acepta localhost, la LAN y los dominios de ngrok sin cambiar `NEXTAUTH_URL`. En producción solo se confía en `NEXTAUTH_URL`.

1. Configura el authtoken una sola vez:

   ```bash
   ngrok config add-authtoken <token>
   ```

2. Ponte el dominio fijo en `.env` (sin `https://`):

   ```env
   NGROK_DOMAIN=mi-dominio.ngrok-free.dev
   ```

3. Arranca Next y el túnel juntos:

   ```bash
   npm run dev:tunnel
   ```

   O en dos terminales:

   ```bash
   npm run dev
   npm run tunnel
   ```

4. En Google Cloud Console, en el cliente OAuth de tipo **Web application**, agrega los redirect URI:

   ```text
   https://localhost:3000/api/auth/google/callback
   https://mi-dominio.ngrok-free.dev/api/auth/google/callback
   ```

5. Completa `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en `.env`, y reinicia el dev server.

El callback de ngrok aparece en la salida de `npm run dev` y en `npm run env:show`. El login con Google crea un rol `user` si el correo es nuevo; para probar un admin con Google, crea primero el usuario con ese correo usando `db:create-admin`.

## Acceder directamente a la base

### pgAdmin 4 (equivalente a SSMS para PostgreSQL)

Arranca el perfil `db-tools` y abre el navegador:

```bash
docker compose --profile db-tools up -d pgadmin
xdg-open http://127.0.0.1:5050
```

En Windows:

```powershell
docker compose --profile db-tools up -d pgadmin
Start-Process http://127.0.0.1:5050
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
npm run env:check
npm test
npm run smoke:db
npm run build
```

`smoke:db` sólo consulta la base configurada; no crea ni modifica datos.

`npm test` funciona en Windows y ejecuta los tests unitarios. `tests/kb-access-db.test.ts` requiere fixtures de una base limpia y queda excluido por defecto; cuando existan los fixtures, usa `npm run test:db`. En PowerShell, para el smoke live de Ollama: `$env:SMOKE_LIVE=1; npm test`.

## Despliegue en Windows Server

El flujo completo está en [`SERVIDOR.md`](./SERVIDOR.md). Resumen:

```powershell
.\deploy\check-server.ps1
.\deploy\bootstrap-server.ps1 -Branch experimental
.\deploy\deploy.ps1
```

- `bootstrap-server.ps1`: primera instalación (genera `.env`, migra, arranca, crea admin).
- `deploy.ps1`: actualización con backup, `git pull --ff-only`, build, migraciones y health check.
- `backup.ps1` / `restore.ps1`: respaldo y restauración.
- `check-server.ps1`: diagnóstico de Docker, Git, disco, puertos y firewall.

## Respaldo

El endpoint de backup usa `pg_dump` y almacena el archivo en `data/backups`. El archivo debe estar en un volumen persistente y fuera del repositorio. Para una instalación real, complétalo con PITR/WAL archiving del servidor PostgreSQL y backup separado de MinIO.

En Windows Server, `.\deploy\backup.ps1` y `.\deploy\restore.ps1` automatizan PostgreSQL + MinIO y dejan los archivos en `deploy\backups` (ignorado por Git). Copia esos backups fuera del servidor; no sustituyen un backup offsite.

## Nota de seguridad

El entorno nuevo no debe exponer PostgreSQL, MinIO ni Ollama a Internet sin autenticación, firewall y TLS. Durante desarrollo, mantén el acceso limitado a la red local y no subas `.env` al repositorio.

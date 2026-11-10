# Inteligencia Digna

Backend y frontend de Inteligencia Digna con Next.js, PostgreSQL/pgvector, MinIO y Ollama nativo.

## Inicio rápido con Docker

```bash
cp .env.example .env
# completa .env con secretos y valores del servidor
docker compose up -d --build
docker compose ps
```

El servicio `migrate` crea el esquema y ejecuta el seed antes de iniciar la aplicación. La base de datos conserva sus datos en el volumen `postgres_data`.

Consulta `docs/SERVIDOR.md` para la instalación completa, backups y MinIO.

## Desarrollo en el host

```bash
cp .env.example .env
npm ci
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev
```

El host usa `127.0.0.1` y el puerto definido en `POSTGRES_PORT`. Dentro de los contenedores se usan los nombres internos `postgres:5432` y `minio:9000`.

### Generación de PDFs

La conversión DOCX → PDF usa LibreOffice headless. La imagen Docker ya lo incluye. En el host hay que instalarlo y, si `soffice` no está en el `PATH`, definir `LIBREOFFICE_BIN` en `.env`:

```env
LIBREOFFICE_BIN=C:\Program Files\LibreOffice\program\soffice.exe
```

Verifica la instalación con:

```bash
npm run doc:check
```

Los documentos generados se guardan en MinIO/S3 bajo `documents/{userId}/{chatId}/` y la base solo conserva metadatos. Aplica la migración antes de desplegar:

```bash
npm run db:migrate
```

#### Timeouts de generación de documentos

- `OLLAMA_STREAM_IDLE_TIMEOUT_MS` (default `120000`): tiempo máximo sin recibir tokens antes de abortar el stream. Se reinicia cada vez que llega un token, así que un documento largo no se corta si el modelo sigue escribiendo.
- `DOC_OLLAMA_TIMEOUT_MS` (default `300000`): tope total de seguridad para generar un documento. Si se alcanza y hay contenido parcial, se guarda lo generado y se avisa al usuario.

Cuando un documento se detiene por tiempo, el usuario puede pedir "continúa el documento" para seguir desde donde se quedó.

#### Continuación de documentos parciales

Si un documento se corta por tiempo límite, se guarda el Markdown fuente como sidecar en MinIO (`documents/{userId}/{chatId}/{documentId}.md`). El usuario puede pedir "continúa el documento" para generar una nueva versión (1.1, 1.2, …) sin empezar desde cero. Para empezar de cero, use "desde cero" o "hazlo de nuevo".

`GET /api/documents/{id}` descarga el archivo; con `?inline=1` se sirve para la vista previa. `POST /api/documents/from-message` exporta una respuesta existente sin llamar al modelo.

## Desarrollo de datos

PostgreSQL es una dependencia real y consultable, no una base oculta detrás de la aplicación.

La herramienta de gestión es **pgAdmin 4**, el equivalente de SSMS para PostgreSQL. Está en un perfil aparte para no exponer acceso de superusuario al arrancar la app:

```bash
docker compose --profile db-tools up -d pgadmin
xdg-open http://127.0.0.1:5050
```

Se inicia sesión con `PGADMIN_EMAIL` y `PGADMIN_PASSWORD` de `.env`. El servidor **Inteligencia Digna (Docker)** ya aparece precargado; solo hay que pegar `POSTGRES_PASSWORD` una vez, porque pgAdmin no permite precargar contraseñas.

También puedes conectarte con DBeaver (`127.0.0.1:5433`) o la extensión PostgreSQL de VS Code usando los valores de `.env`.

```bash
npm run smoke:db
```

Consulta `docs/ARQUITECTURA-NUEVA.md` para el diagrama, file tree, MinIO, Ollama y migraciones.

## Comandos principales

```bash
npm run db:migrate
npm run db:seed
npm run db:reindex
npm run db:create-admin
npm run db:query -- "SELECT 1"
npm run lint
npx tsc --noEmit
npm test
npm run build
```

## Seguridad

No subas `.env` a Git. En desarrollo mantén PostgreSQL, MinIO y Ollama en la red local. Antes de producción agrega firewall, TLS, secretos gestionados, respaldos y control de acceso.

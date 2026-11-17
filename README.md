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

### Generación de imágenes

La generación y edición conversacional usan FLUX.2 Klein 4B en un ComfyUI externo. La app solo crea el trabajo en PostgreSQL; un worker separado lo reclama con `FOR UPDATE SKIP LOCKED`, llama a ComfyUI y sube el resultado a MinIO. El endpoint `/api/chat` es el único punto de entrada, tanto para el botón **Crear imagen** como para las peticiones en lenguaje natural.

Aplica la migración antes de iniciar el worker:

```bash
npm run db:migrate
```

El grafo FLUX.2 Klein se construye en código y encadena `ReferenceLatent` para las imágenes de referencia. `COMFYUI_WORKFLOW` es opcional: si se define, debe ser una ruta local legible por el worker; la ruta del workflow en la DGX no es visible desde el contenedor.

#### Red hacia ComfyUI

- En el host, con el túnel SSH activo: `COMFYUI_URL=http://127.0.0.1:8188`.
- En Docker, `127.0.0.1` apunta al propio contenedor. Usa `COMFYUI_URL_DOCKER=http://host.docker.internal:8188` (Compose ya lo aplica a `app` e `image-worker`) o la IP/VPN de la DGX.
- El túnel o ComfyUI debe escuchar en el host Docker; `extra_hosts` ya resuelve `host.docker.internal:host-gateway`.
- ComfyUI no se expone públicamente. Mantén el puerto en la red local o detrás del túnel.

Variables principales (detalle en `.env.example`):

```env
IMAGE_ENABLED=true
IMAGE_BACKEND=flux2-klein       # mock para pruebas sin GPU
COMFYUI_URL=http://127.0.0.1:8188
COMFYUI_URL_DOCKER=http://host.docker.internal:8188
COMFYUI_STEPS=4
COMFYUI_SEED=42
IMAGE_MAX_PIXELS=1100000
COMFYUI_TARGETED_CANCEL=false   # true solo si ComfyUI soporta cancelación por prompt_id
```

#### Worker

En el host:

```bash
npm run image:worker
# o con supervisor y reinicio con backoff:
npm run image:worker:supervisor
```

Con Docker Compose:

```bash
docker compose up -d --build image-worker
docker compose logs -f image-worker
```

Diagnóstico:

```bash
npm run image:health
npm run image:health -- --worker-only
```

También existe `GET /api/admin/images/health` para el panel (requiere autenticación y `panel.read`). Muestra la conexión con ComfyUI, los workers con heartbeat fresco y los trabajos por estado.

Los estados persistidos son `preparing`, `queued`, `generating`, `saving`, `completed`, `failed` y `cancelled`. Si el worker cae, la recuperación no reencola a ciegas: consulta el `prompt_id` persistido en `/queue` y `/history`. Un trabajo cancelado borra su prompt de la cola; `/interrupt` solo se usa con `COMFYUI_TARGETED_CANCEL=true` y siempre con `prompt_id`.

#### Pruebas

```bash
npm test                 # unitarias, incluye intención, grafo, errores y mock
npm run test:db          # requiere PostgreSQL y MinIO de prueba aislados
```

Para la integración define `IMAGE_TEST_DATABASE_URL` y `IMAGE_TEST_BUCKET` (el test crea el bucket si no existe). No uses la base ni el bucket de producción:

```powershell
$env:IMAGE_TEST_DATABASE_URL = "postgresql://usuario:clave@127.0.0.1:5433/inteligencia_digna_test?sslmode=disable"
$env:IMAGE_TEST_BUCKET = "inteligencia-digna-test"
npm run test:db
```

No dejes un `image:worker` apuntando a esa misma base mientras corre la integración: reclamaría los trabajos que crea el test. Detén el worker o usa otra base.

Las pruebas con `IMAGE_BACKEND=mock` validan el pipeline pero **no** demuestran que la GPU, los modelos o el ComfyUI real funcionen.

#### Verificación real en GPU

Con ComfyUI accesible:

```powershell
Invoke-RestMethod http://127.0.0.1:8188/system_stats
npm run image:health
```

Después genera una imagen desde la UI y confirma el trabajo persistido:

```bash
npm run db:query -- "SELECT id, status, seed, width, height, error_code FROM image_jobs ORDER BY created_at DESC LIMIT 5"
```

Revisa también que el PNG descargado desde la tarjeta sea válido y que edición, variante (semilla nueva) y recuperación tras reiniciar el worker funcionen contra ComfyUI real. Esa verificación queda pendiente si no hay acceso a la DGX o al túnel en el entorno de despliegue.

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

# Instalación reproducible en servidor

Esta guía deja el servidor en un estado conocido después de `git pull`. Git transporta el código, las migraciones y la configuración de ejemplo; no transporta secretos, volúmenes Docker ni datos reales.

## Requisitos

- Docker Engine con Compose v2.
- Node.js 22 si se ejecuta la aplicación fuera de Docker.
- Acceso de red a Ollama.
- Disco persistente para los volúmenes `postgres_data` y `minio_data`.
- Un dominio/TLS si se usará Google OAuth.

## Primer despliegue

```bash
git clone <url-del-repositorio> /opt/inteligencia-digna
cd /opt/inteligencia-digna
cp .env.example .env
chmod 600 .env
```

Completa `.env` como mínimo con:

- `JWT_SECRET` nuevo.
- `POSTGRES_PASSWORD`.
- `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_ACCESS_KEY` y `MINIO_SECRET_KEY` (solo si activas el perfil `local-storage`).
- `DATABASE_URL` y `DATABASE_URL_INTERNAL` usando la misma contraseña.
- `OLLAMA_URL` y los tres tags que existen en `/api/tags`.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `NEXTAUTH_URL` si se usa OAuth.
- `ADMIN_EMAIL` y `ADMIN_PASSWORD` sólo para crear el primer administrador.
- `PGADMIN_EMAIL` y `PGADMIN_PASSWORD` sólo si activas el perfil `db-tools`.

No subes `.env` a Git.

## Base de datos y aplicación

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

El servicio `migrate` se ejecuta antes de `app` y aplica automáticamente:

1. `migrations/001_initial.sql`.
2. `migrations/002_legacy_and_embedding_metadata.sql`.
3. `db-seed.ts`.

El volumen `postgres_data` conserva el esquema y los datos entre reinicios.

No ejecutes en el servidor:

```bash
docker compose down -v
```

El comando `down` normal conserva los volúmenes; `-v` los elimina.

## Migrar los datos actuales

El archivo `data/app.db` está ignorado por Git. Transfiéralo por un canal seguro a `data/app.db` en el servidor y ejecuta una sola vez:

```bash
docker compose run --rm --no-deps app npm run db:import
docker compose run --rm --no-deps app npm run db:reindex
```

`db:import` es transaccional, pero no debe repetirse sobre la misma base porque la auditoría legacy no tiene una clave de idempotencia.

Si se va a crear un administrador nuevo:

```bash
docker compose run --rm --no-deps -e ADMIN_EMAIL=correo -e ADMIN_PASSWORD='contraseña-larga' app npm run db:create-admin
```

Ese comando es también el mecanismo de ruptura para recuperar la instancia cuando no quede ningún `super_admin` accesible, por ejemplo tras un bloqueo de cuenta. Usa `ADMIN_PASSWORD` de `.env` y crea un `super_admin`, que es lo único que puede volver a crear `super_admin`. Para crear un `admin` normal, pásalo explícitamente con `-e ADMIN_ROLE=admin`.

El sistema impide degradar o borrar al último `super_admin` que quede, así que perder el acceso exige que ya no haya ninguno. Si llegas a ese caso, crea uno nuevo con el comando anterior y revisa el `audit_log` para entender cómo se llegó ahí.

### Registro público

`POST /api/auth/register` está abierto: cualquiera que conozca la URL puede crear una cuenta, y nace siempre con rol `user`, sin áreas y sin grupos, es decir sin acceso a la base de conocimiento. No hay bandera que lo desactive.

Antes había una bandera `allow_registration` en el panel que prometía exactamente eso y no la leía nadie. Se borró en la migración `004`, junto con `allow_guest_access`, `default_user_role` y `maintenance_mode`. Si en algún momento hay que cerrar el registro, se toca la ruta, no un interruptor que ya no existe.

### Revisión mensual de accesos

La pantalla **Accesos** del panel es el control detective sobre el bypass de `admin` y `super_admin`. Esos roles leen toda la base de conocimiento sin necesidad de un grant, así que la revisión periódica de quién leyó qué es la que compensa.

Una vez al mes:

1. Abre la sección de grants de cada área y grupo activo y confirma que quien lee algo sigue necesitando leerlo.
2. Quita las membresías de quien cambió de función. Restar un acceso es la operación más rápida en caso de incidente: surte efecto en la siguiente petición.
3. Desactiva las áreas sin uso. Desactivar conserva los grants, así que es reversible; por eso es la vía preferida para silenciar un área sin borrar su configuración.

Cada alta, baja y revocación queda en el `audit_log` con el usuario, el área, el archivo y el motivo.

## MinIO local

MinIO upstream (`minio/minio`) dejó de publicar imágenes en Docker Hub: el repositorio quedó archivado y `docker pull` responde `pull access denied ... repository does not exist`, incluso con `docker login` hecho. Por eso `compose.yaml` usa **`pgsty/minio`**, un fork comunitario con API S3, variables `MINIO_*` y entrypoint compatibles.

El tag está fijo a propósito (`RELEASE.2026-08-04T00-00-00Z`) para que el despliegue sea reproducible. Para actualizarlo, cambia el tag por una release más nueva del fork.

```bash
docker compose --profile local-storage up -d
docker compose --profile local-storage run --rm storage-init
```

`storage-init` es obligatorio: crea el bucket `MINIO_BUCKET`. Sin él, MinIO arranca pero la subida de archivos falla.

Credenciales obligatorias en `.env` (sin valores por defecto, la app falla si faltan):

- `MINIO_ROOT_USER` y `MINIO_ROOT_PASSWORD`: credenciales del servicio MinIO.
- `MINIO_ACCESS_KEY` y `MINIO_SECRET_KEY`: credenciales que usa la app contra el bucket.

Consola web de MinIO: `http://127.0.0.1:9001`.

Si prefieres un S3 externo, no actives el perfil `local-storage` y ajusta `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` y `MINIO_BUCKET`. Sin storage, la base y el chat funcionan, pero las cargas y descargas de Knowledge Base no: la descarga responde `503` con un mensaje explicativo.

## Actualizaciones posteriores

```bash
cd /opt/inteligencia-digna
git pull
docker compose up -d --build
docker compose ps
```

Las migraciones son incrementales y se vuelven a ejecutar de forma idempotente en cada despliegue.

## Comprobaciones

```bash
docker compose exec app npm run smoke:db
curl -fsS http://127.0.0.1:3000/
curl -fsS "$OLLAMA_URL/api/tags"
```

Para consultar la base desde el servidor:

```bash
docker compose exec postgres psql -U inteligencia_digna -d inteligencia_digna
```

## pgAdmin 4 (gestión gráfica)

pgAdmin es la herramienta de gestión del proyecto, el equivalente de SSMS para PostgreSQL. Está en un perfil aparte para no exponer acceso de superusuario al arrancar la app:

```bash
docker compose --profile db-tools up -d pgadmin
```

| Dato | Valor |
|---|---|
| URL | `http://127.0.0.1:5050` |
| Usuario | `PGADMIN_EMAIL` de `.env` |
| Contraseña | `PGADMIN_PASSWORD` de `.env` |
| Servidor precargado | Inteligencia Digna (Docker) |
| Password de la BD | `POSTGRES_PASSWORD` de `.env`, se pega una sola vez |

El servidor queda registrado en `deploy/pgadmin/servers.json` (versionado, sin secretos) y su configuración persiste en el volumen `pgadmin_data`.

En un servidor remoto, `127.0.0.1:5050` no es accesible desde tu navegador. Usa un túnel SSH:

```bash
ssh -L 5050:127.0.0.1:5050 usuario@servidor
```

Para detenerlo:

```bash
docker compose --profile db-tools stop pgadmin
```

Para DBeaver en el host usa `127.0.0.1` y el puerto definido en `POSTGRES_PORT`.

## Backups

Crear un backup de PostgreSQL:

```bash
docker compose exec -T postgres pg_dump -U inteligencia_digna -d inteligencia_digna --format=custom --no-owner --no-acl > inteligencia-$(date -u +%Y%m%dT%H%M%SZ).dump
```

Los objetos de MinIO se respaldan por separado; `pg_dump` no incluye los archivos binarios de Knowledge Base.

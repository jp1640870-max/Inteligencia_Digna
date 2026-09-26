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
- `MINIO_ROOT_USER` y `MINIO_ROOT_PASSWORD`.
- `DATABASE_URL` y `DATABASE_URL_INTERNAL` usando la misma contraseña.
- `OLLAMA_URL` y los tres tags que existen en `/api/tags`.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `NEXTAUTH_URL` si se usa OAuth.
- `ADMIN_EMAIL` y `ADMIN_PASSWORD` sólo para crear el primer administrador.

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

## MinIO local

MinIO requiere que el servidor pueda descargar `minio/minio:latest`. Si la imagen está disponible:

```bash
docker compose --profile local-storage up -d --build
docker compose --profile local-storage run --rm storage-init
```

Si el registro no permite descargar la imagen, configura un S3/MinIO externo y ajusta `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` y `MINIO_BUCKET`. Sin storage, la base y el chat pueden funcionar, pero las cargas/descargas de Knowledge Base no.

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

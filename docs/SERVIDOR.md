# Instalación reproducible en servidor

Esta guía deja el servidor en un estado conocido después de `git pull`. Git transporta el código, las migraciones y la configuración de ejemplo; no transporta secretos, volúmenes Docker ni datos reales.

## Windows Server (RDP) — flujo principal

El servidor de producción es Windows Server con Docker en modo Linux. El servidor no edita código: clona el repositorio, hace `git pull --ff-only` y aplica migraciones. Los secretos viven en `.env`, fuera de Git.

### Requisitos

- Docker con contenedores Linux y Compose v2.
- Git para Windows.
- PowerShell 5.1 ejecutado como Administrador (firewall y ACL).
- RDP al servidor.
- Opcional: dominio DNS y puertos 80/443 para Caddy/TLS.

### Primer despliegue

```powershell
New-Item -ItemType Directory -Force C:\apps | Out-Null
cd C:\apps
git clone https://github.com/jp1640870-max/Inteligencia_Digna.git
cd .\Inteligencia_Digna
git checkout experimental
.\deploy\check-server.ps1
.\deploy\bootstrap-server.ps1 -Branch experimental
```

`bootstrap-server.ps1`:

- Genera `.env` con contraseñas aleatorias para PostgreSQL, MinIO y pgAdmin.
- Pide la URL interna (por defecto `http://<ip>:3000`) y la contraseña del administrador.
- Levanta PostgreSQL, aplica migraciones, arranca MinIO, crea el bucket, arranca la app y crea el super administrador.
- Abre el puerto 3000 en el firewall si se ejecuta como Administrador.
- Guarda las credenciales en `C:\ProgramData\InteligenciaDigna\CREDENTIALS.txt`.
- No borra volúmenes ni datos existentes.
- Se niega a sobrescribir `.env` salvo con `-Force` (eso regenera los secretos).
- `-DryRun` muestra lo que haría sin escribir nada.

Para ver qué haría sin tocar el servidor:

```powershell
.\deploy\bootstrap-server.ps1 -PublicUrl http://192.168.1.50:3000 -DryRun
```

Con Ollama real:

```powershell
.\deploy\bootstrap-server.ps1 -Branch experimental -OllamaUrl http://10.0.201.10:51234
```

Con dominio, TLS automático y Google OAuth:

```powershell
.\deploy\bootstrap-server.ps1 -Branch experimental `
  -PublicDomain digna.midominio.com `
  -EnableCaddy `
  -GoogleClientId "....apps.googleusercontent.com" `
  -GoogleClientSecret "..."
```

En ese caso `NEXTAUTH_URL` queda en `https://digna.midominio.com`, Caddy obtiene el certificado y el callback de Google es `https://digna.midominio.com/api/auth/google/callback`. El DNS debe apuntar al servidor y los puertos 80/443 deben estar abiertos. La app sigue escuchando en `0.0.0.0:3000`; si quieres cerrar el acceso directo, cambia `APP_BIND_ADDRESS=127.0.0.1` y elimina la regla de firewall 3000.

Sin dominio, el primer despliegue usa HTTP interno. El login por email/contraseña funciona; Google OAuth necesita HTTPS (Caddy, un proxy TLS o un túnel).

### Actualizaciones

```powershell
cd C:\apps\Inteligencia_Digna
.\deploy\deploy.ps1
```

El script:

1. Rechaza desplegar si hay cambios locales sin commitear (el servidor no edita código).
2. Hace `git fetch` y `git pull --ff-only` de la rama configurada en `DEPLOY_BRANCH`.
3. Hace backup de PostgreSQL y MinIO (salvo `-SkipBackup`).
4. Construye la imagen, aplica migraciones y seed, y ejecuta `storage-init`.
5. Valida el entorno dentro del contenedor (`npm run env:check`).
6. Reinicia solo la app y comprueba salud.

Para desplegar otra rama:

```powershell
.\deploy\deploy.ps1 -Branch experimental
```

Para saltar el backup en una ventana de mantenimiento controlada:

```powershell
.\deploy\deploy.ps1 -SkipBackup
```

### Backups y restauración

```powershell
.\deploy\backup.ps1
.\deploy\restore.ps1 -PostgresDump .\deploy\backups\postgres-20261101T120000.dump
.\deploy\restore.ps1 `
  -PostgresDump .\deploy\backups\postgres-20261101T120000.dump `
  -MinioArchive .\deploy\backups\minio-20261101T120000.tgz
```

- `backup.ps1` guarda `postgres-*.dump` y `minio-*.tgz` en `deploy\backups` y conserva los últimos 10 de cada tipo.
- `restore.ps1` detiene la app, restaura con `pg_restore --clean`, opcionalmente reemplaza el volumen de MinIO y vuelve a arrancar. Exige escribir `RESTAURAR`.
- Copia los backups fuera del servidor (NAS, OneDrive, etc.). El script no hace backup offsite.
- Prueba una restauración en una instancia que no sea producción antes de confiar en ella.

### pgAdmin y MinIO

Ambos escuchan solo en `127.0.0.1`:

- pgAdmin: `http://127.0.0.1:5050` (por RDP).
- Consola MinIO: `http://127.0.0.1:9001` (por RDP).
- PostgreSQL: `127.0.0.1:5433`.

No los expongas a Internet sin TLS, firewall y autenticación adicional.

### Diagnóstico

```powershell
.\deploy\check-server.ps1
docker compose ps
docker compose logs --tail=200 app
docker compose logs --tail=200 postgres
docker compose run --rm --no-deps app npm run env:check
```

Si `docker` no aparece, agrega `C:\Program Files\Docker\Docker\resources\bin` al `PATH`. Si el daemon no está en modo Linux, la app no arranca: cambia Docker a contenedores Linux.

### Dominio y TLS con Caddy (opcional)

El proxy vive en un compose aparte para que el compose principal no exija `PUBLIC_DOMAIN`:

```powershell
docker compose -f compose.yaml -f compose.proxy.yaml --profile proxy up -d caddy
```

Requiere `PUBLIC_DOMAIN` en `.env`, DNS apuntando al servidor y puertos 80/443 abiertos. Caddy obtiene y renueva el certificado. Si usas Caddy, `NEXTAUTH_URL` debe ser `https://<PUBLIC_DOMAIN>`.

## Linux (alternativa)

Las secciones siguientes describen el flujo equivalente con Docker Engine en Linux. Los scripts de `deploy/` son específicos de Windows; en Linux usa los comandos de esta guía.

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

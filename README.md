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

Para el primer despliegue con los datos existentes, transfiere `data/app.db` al servidor y ejecuta una sola vez:

```bash
docker compose run --rm --no-deps app npm run db:import
docker compose run --rm --no-deps app npm run db:reindex
```

Consulta `docs/SERVIDOR.md` para la instalación completa, backups y MinIO.

## Desarrollo en el host

```bash
cp .env.example .env
cp .env.example .env.local
npm ci
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev
```

El host usa `127.0.0.1` y el puerto definido en `POSTGRES_PORT`. Dentro de los contenedores se usan los nombres internos `postgres:5432` y `minio:9000`.

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

Consulta `docs/ARQUITECTURA-NUEVA.md` para el diagrama, file tree, MinIO, Ollama, migraciones y flujo de importación.

## Comandos principales

```bash
npm run db:migrate
npm run db:seed
npm run db:import
npm run db:reindex
npm run db:create-admin
npm run db:query -- "SELECT 1"
npm run lint
npx tsc --noEmit
npm test
npm run build
```

## Migración desde SQLite

SQLite se conserva únicamente como fuente de migración/rollback. El runtime nuevo utiliza PostgreSQL. El importador no modifica `data/app.db`.

```bash
SQLITE_PATH=data/app.db npm run db:import
npm run db:reindex
```

## Seguridad

No subas `.env` a Git. En desarrollo mantén PostgreSQL, MinIO y Ollama en la red local. Antes de producción agrega firewall, TLS, secretos gestionados, respaldos y control de acceso.

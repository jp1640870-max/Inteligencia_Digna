# Guía de comandos del proyecto

Referencia de los comandos disponibles en `package.json`, qué hace cada uno y cuándo usarlos.
**Ningún comando de verificación corre solo**: se ejecutan explícitamente desde la terminal.

## Resumen rápido

| Comando | Lo que ejecuta | Para qué sirve |
|---|---|---|
| `npm run dev` | `node scripts/dev.js` | Servidor de desarrollo (trabajo diario) |
| `npm run dev:next` | `next dev --experimental-https` | Desarrollo con HTTPS, sin el lanzador propio |
| `npm run dev:login` | desarrollo + abre `/login` en el navegador | Ir directo a la pantalla de login |
| `npm run build` | `next build` | Compilar todo una vez para producción |
| `npm start` | `next start` | Servir lo ya compilado (producción) |
| `npm run lint` | `eslint` | Revisor de estilo y errores obvios |
| `npx tsc --noEmit` | compilador TypeScript sin salida | Verificar que los tipos cuadran |
| `npm test` | `tsx --test --env-file=tests/.env.test "tests/*.test.ts"` | Verificar comportamiento con tests |
| `npm run smoke:db` | `tsx ... scripts/smoke-db.mjs` | Smoke de inicialización de la base de datos |

## Para correr la app

### `npm run dev` — desarrollo

Levanta el servidor de desarrollo (hoy con HTTPS autofirmado).
Compila sobre la marcha y recarga en caliente al guardar: es el modo para trabajar
en el navegador mientras se edita. Más lento, pero flexible.
Abrir en `https://localhost:3000`.

### `npm run build` — compilar para producción

Compila **todo el proyecto una sola vez** hacia archivos optimizados (carpeta `.next`).
No deja recargar a medias: es la "versión final que se publica".

### `npm start` — servir producción

Levanta el servidor sirviendo lo que `npm run build` ya generó. Es el modo que corre
en un servidor real para usuarios de verdad. Flujo completo:

```bash
npm run build   # 1. arma
npm start       # 2. sirve
```

Tip práctico: si algo funciona en `dev` pero falla en `start`, suele ser señal de un
problema importante. Conviene probar con `build` + `start` antes de dar algo por terminado.

Analogía: `dev` es escribir el borrador con autocorrección en vivo;
`build` + `start` es la versión final que se publica.

## Para verificar calidad

### `npm run lint` — NO reconstruye nada

ESLint es un **corrector gramatical del código**: revisa estilo, variables sin usar,
imports mal puestos y trampas típicas de React. No compila ni ejecuta nada.
Estado verificado: **0 problemas (exit 0)**.

### `npx tsc --noEmit` — verificación de tipos

TypeScript añade tipado sobre JavaScript y `tsc` es su compilador.
`--noEmit` significa "compila pero **no escribas archivos de salida**": solo verifica
que los tipos cuadran en todo el proyecto (por ejemplo, que una función que espera
un `UserRow` no reciba otra cosa). No hay script propio en `package.json`; se corre directo.
Estado verificado: **limpio**.

### `npm test` — verifica comportamiento, no compilación

Ejecuta escenarios concretos (resolución "mantener ambos" en la KB, columnas de Excel,
prompts del chatbot, RAG, smoke en vivo opcional) contra una base de datos de prueba
(`tests/.env.test`), sin tocar los datos reales.
Estado verificado: **23/23 en verde**.

### `npm run smoke:db` — inicialización de la base de datos

Levanta el esquema completo (tablas + seeds + migraciones) contra una base de datos
**fresca en un directorio temporal**, sin tocar `data/app.db`. Es el guard de regresión
de la inicialización: si la cadena `getDb → initTables → init*` se rompe, este comando falla.

## Escalera de confianza

| Check          | Qué detecta                                          |
|----------------|------------------------------------------------------|
| `lint`         | estilo + bugs obvios                                 |
| `tsc --noEmit` | tipos / errores de escritura a nivel de compilación  |
| `test` | comportamiento correcto de las funciones                     |
| `build` | compilación completa de producción                          |
| `dev` en vivo | lo único que toca la base de datos y las rutas reales |

Orden recomendado antes de dar algo por terminado:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

## Motores de IA (SGLang, protocolo OpenAI-compatible)

La app usa **cliente único SGLang** (`lib/sglang.ts`). Ya no existe `lib/ollama.ts`
ni la variable `OLLAMA_URL`. Los 3 engines viven en `10.0.201.10`:

| Motor               | Modelo (`served-model-name`) | Variable URL                       | Valor |
|---------------------|------------------------------|------------------------------------|-------|
| Chat "fast"         | `qwen3.6-35b-a3b` (MoE)      | `SGLANG_URL` (required)            | `http://10.0.201.10:8005/v1` |
| Hearts "deep-think" | `qwen3.8-27b` (dense)        | `SGLANG_HEARTS_URL` (opcional)     | `http://10.0.201.10:8006/v1` |
| Embeddings RAG      | `bge-m3`                     | `SGLANG_EMBEDDINGS_URL` (opcional) | `http://10.0.201.10:8007/v1` |

Variables de modelo en `.env.local` (ver `lib/env.ts`):

| Variable | Required | Default si falta | Uso |
|---|---|---|---|
| `SGLANG_URL` | sí | — | chat + fallback de todo |
| `TEXT_MODEL` | sí | — | modelo del chat (`qwen3.6-35b-a3b`) |
| `HEARTS_MODEL` | no | `TEXT_MODEL` | hearts y edición de documentos (`qwen3.8-27b`) |
| `EMBEDDING_MODEL` | no | `bge-m3` | RAG (`generateEmbedding`) |

Notas de la migración Ollama → SGLang:
- El stream cambió de **NDJSON por líneas** (`/api/chat`) a **SSE `data:`**
  (`/v1/chat/completions` con `stream: true`, corte en `[DONE]`).
- `num_predict` (legado) se traduce a `max_tokens` dentro de `lib/sglang.ts`.
- Las imágenes se envían como `content parts` OpenAI (`image_url`); solo funcionan
  si el engine sirve un modelo con visión.
- El enrutamiento por modelo es automático: si el modelo pedido es `HEARTS_MODEL`
  y existe `SGLANG_HEARTS_URL`, se usa el engine de hearts; si no, el de chat.
- El health check (`/api/admin/health`) consulta `GET /v1/models` en vez de `/api/tags`.
- Smoke en vivo (opcional, requiere DGX alcanzable):
  `SMOKE_LIVE=1 SGLANG_URL=http://10.0.201.10:8005 SGLANG_EMBEDDINGS_URL=http://10.0.201.10:8007 npm test`

## Notas

- El navegador puede advertir por el certificado HTTPS autofirmado en desarrollo:
  es esperado, se acepta y se continúa.
- Los tests usan `tests/.env.test`; nunca escriben sobre `data/app.db`.
- El smoke `smoke:db` crea su base de datos en `/tmp` y no deja rastro en el proyecto.

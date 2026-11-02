import { existsSync } from "node:fs";
import { readEffectiveEnv } from "./lib/env-file";

const strict = process.argv.includes("--strict");
const env = readEffectiveEnv();

const errors: string[] = [];
const warnings: string[] = [];

function value(key: string): string | undefined {
  const current = env[key]?.trim();
  return current || undefined;
}

function required(key: string): string | undefined {
  const current = value(key);
  if (!current) errors.push(`${key} está vacío o no existe`);
  return current;
}

function isUrl(input: string): boolean {
  try {
    new URL(input);
    return true;
  } catch {
    return false;
  }
}

function databasePassword(input: string): string | null {
  try {
    const url = new URL(input);
    return decodeURIComponent(url.password);
  } catch {
    return null;
  }
}

// ── Núcleo ────────────────────────────────────────────────────────────────
const jwtSecret = required("JWT_SECRET");
if (jwtSecret && jwtSecret.length < 16) {
  errors.push("JWT_SECRET debe tener al menos 16 caracteres");
}
if (jwtSecret && /cambiar|change[-_]?me|example|test[-_]?secret/i.test(jwtSecret)) {
  warnings.push("JWT_SECRET parece un valor de ejemplo; genera uno aleatorio");
}

const databaseUrl = required("DATABASE_URL");
if (databaseUrl) {
  if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
    errors.push("DATABASE_URL debe empezar con postgresql:// o postgres://");
  } else if (!isUrl(databaseUrl)) {
    errors.push("DATABASE_URL no es una URL válida");
  }
}

const postgresPassword = required("POSTGRES_PASSWORD");
if (databaseUrl && postgresPassword) {
  const urlPassword = databasePassword(databaseUrl);
  if (urlPassword !== null && urlPassword !== postgresPassword) {
    errors.push("La contraseña de DATABASE_URL no coincide con POSTGRES_PASSWORD");
  }
}

const internalUrl = required("DATABASE_URL_INTERNAL");
if (internalUrl) {
  if (!isUrl(internalUrl)) {
    errors.push("DATABASE_URL_INTERNAL no es una URL válida");
  } else {
    const url = new URL(internalUrl);
    if (url.hostname !== "postgres") {
      warnings.push("DATABASE_URL_INTERNAL no apunta al servicio postgres del Compose");
    }
    if (url.port && url.port !== "5432") {
      warnings.push("DATABASE_URL_INTERNAL no usa el puerto 5432");
    }
    if (postgresPassword && decodeURIComponent(url.password) !== postgresPassword) {
      errors.push("La contraseña de DATABASE_URL_INTERNAL no coincide con POSTGRES_PASSWORD");
    }
  }
}

// ── Aplicación ────────────────────────────────────────────────────────────
const nextAuthUrl = required("NEXTAUTH_URL");
if (nextAuthUrl) {
  if (!isUrl(nextAuthUrl)) {
    errors.push("NEXTAUTH_URL no es una URL válida");
  } else if (env.NODE_ENV === "production" && nextAuthUrl.startsWith("http://")) {
    const host = new URL(nextAuthUrl).hostname;
    if (host !== "localhost" && host !== "127.0.0.1") {
      warnings.push(
        "NEXTAUTH_URL usa HTTP en producción; Google OAuth exige HTTPS y la cookie no será Secure"
      );
    }
  }
}

// ── Google OAuth (opcional) ───────────────────────────────────────────────
const googleClientId = value("GOOGLE_CLIENT_ID");
const googleClientSecret = value("GOOGLE_CLIENT_SECRET");
if (googleClientId && !googleClientSecret) {
  warnings.push("GOOGLE_CLIENT_SECRET vacío: el login con Google fallará en el callback");
}
if (!googleClientId && googleClientSecret) {
  warnings.push("GOOGLE_CLIENT_ID vacío: el login con Google no está disponible");
}
if (googleClientId && !googleClientId.endsWith(".apps.googleusercontent.com")) {
  warnings.push("GOOGLE_CLIENT_ID no parece un Client ID de Google");
}
if (!googleClientId) {
  warnings.push("Google OAuth no configurado; solo estará disponible el login por email/contraseña");
}

// ── Storage ───────────────────────────────────────────────────────────────
const minioAccess = required("MINIO_ACCESS_KEY");
const minioSecret = required("MINIO_SECRET_KEY");
required("MINIO_ENDPOINT");
required("MINIO_BUCKET");

const minioRootUser = value("MINIO_ROOT_USER");
const minioRootPassword = value("MINIO_ROOT_PASSWORD");
if (minioRootUser && minioAccess && minioRootUser !== minioAccess) {
  warnings.push("MINIO_ROOT_USER y MINIO_ACCESS_KEY difieren; revisa permisos del bucket");
}
if (minioRootPassword && minioSecret && minioRootPassword !== minioSecret) {
  warnings.push("MINIO_ROOT_PASSWORD y MINIO_SECRET_KEY difieren; revisa permisos del bucket");
}
if (!value("MINIO_ENDPOINT_INTERNAL")) {
  warnings.push("MINIO_ENDPOINT_INTERNAL vacío; el Compose usará http://minio:9000 por defecto");
}

// ── Ollama ────────────────────────────────────────────────────────────────
required("OLLAMA_URL");
required("OLLAMA_CHAT_MODEL");
required("OLLAMA_AGENT_MODEL");
required("OLLAMA_EMBEDDING_MODEL");

// ── Seguridad / despliegue ────────────────────────────────────────────────
const servicePasswords: Record<string, string | undefined> = {
  POSTGRES_PASSWORD: value("POSTGRES_PASSWORD"),
  PGADMIN_PASSWORD: value("PGADMIN_PASSWORD"),
  MINIO_ROOT_PASSWORD: value("MINIO_ROOT_PASSWORD"),
  MINIO_SECRET_KEY: value("MINIO_SECRET_KEY"),
};
const configuredPasswords = Object.entries(servicePasswords).filter(([, v]) => v);
if (
  configuredPasswords.length > 1 &&
  new Set(configuredPasswords.map(([, v]) => v)).size > 1
) {
  warnings.push(
    "Las contraseñas de servicio no son todas iguales (en local se esperaba la misma para PostgreSQL, pgAdmin y MinIO)"
  );
}
const ngrokDomain = value("NGROK_DOMAIN");
if (ngrokDomain) {
  if (ngrokDomain.includes("://")) {
    warnings.push("NGROK_DOMAIN debe ser solo el dominio, sin https://");
  }
  if (!/^[a-z0-9.-]+$/i.test(ngrokDomain)) {
    warnings.push("NGROK_DOMAIN contiene caracteres no válidos");
  }
}

// ── Resultado ─────────────────────────────────────────────────────────────
console.log("\n🔎 Verificando configuración de Inteligencia Digna\n");
console.log(`  .env:       ${existsSync(".env") ? "sí" : "no"}`);
console.log(`  Modo:       ${strict ? "estricto" : "normal"}\n`);

if (errors.length > 0) {
  console.log("❌ Errores:");
  for (const error of errors) console.log(`   - ${error}`);
  console.log("");
}

if (warnings.length > 0) {
  console.log("⚠️  Advertencias:");
  for (const warning of warnings) console.log(`   - ${warning}`);
  console.log("");
}

if (strict && warnings.length > 0) {
  console.log("❌ Modo estricto: las advertencias también fallan.\n");
  process.exit(1);
}

if (errors.length > 0) {
  process.exit(1);
}

console.log(
  warnings.length > 0 ? "✅ Configuración válida (con advertencias)\n" : "✅ Configuración válida\n"
);

/**
 * Validación estricta de variables de entorno.
 * Se ejecuta al importar el módulo. Si falta una variable crítica,
 * la app explota en startup en lugar de fallar silenciosamente.
 */

const REQUIRED_VARS = [
  "JWT_SECRET",
  "OLLAMA_URL",
  "TEXT_MODEL",
] as const;

const OPTIONAL_VARS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "NEXTAUTH_URL",
  "SEARXNG_URL",
] as const;

type EnvVars = Record<string, string>;

function validateEnv(): EnvVars {
  const missing: string[] = [];

  for (const key of REQUIRED_VARS) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    const msg = `❌ Variables de entorno faltantes:\n  ${missing.join("\n  ")}\n\nRevisa tu archivo .env.local`;
    throw new Error(msg);
  }

  // Advertencias para opcionales (no bloquean)
  for (const key of OPTIONAL_VARS) {
    if (!process.env[key]) {
      console.warn(`⚠️  Variable opcional no configurada: ${key}`);
    }
  }

  // Validar que JWT_SECRET no sea el valor hardcodeado por defecto
  const jwt = process.env.JWT_SECRET!;
  if (
    jwt === "dev-secret-change-in-production" ||
    jwt === "mi-ia-seguro-2026-cambiar-en-produccion" ||
    jwt.length < 16
  ) {
    throw new Error(
      "❌ JWT_SECRET es inseguro. Genera uno nuevo con:\n" +
      "  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  return process.env as unknown as EnvVars;
}

export const env = validateEnv();

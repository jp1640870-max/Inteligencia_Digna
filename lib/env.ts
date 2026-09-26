const REQUIRED_VARS = ["JWT_SECRET"] as const;

const OPTIONAL_VARS = [
  "DATABASE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "NEXTAUTH_URL",
  "SEARXNG_URL",
  "OLLAMA_URL",
  "OLLAMA_CHAT_MODEL",
  "OLLAMA_AGENT_MODEL",
  "OLLAMA_EMBEDDING_MODEL",
] as const;

type Env = Record<string, string | undefined> & {
  JWT_SECRET: string;
  OLLAMA_URL: string;
  OLLAMA_CHAT_MODEL: string;
  OLLAMA_AGENT_MODEL: string;
  OLLAMA_EMBEDDING_MODEL: string;
};

function validateEnv(): Env {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Variables de entorno faltantes: ${missing.join(", ")}`);
  }

  const jwt = process.env.JWT_SECRET as string;
  if (jwt.length < 16 || jwt === "dev-secret-change-in-production" || jwt === "mi-ia-seguro-2026-cambiar-en-produccion") {
    throw new Error("JWT_SECRET debe ser un secreto nuevo de al menos 16 caracteres");
  }

  for (const key of OPTIONAL_VARS) {
    if (!process.env[key]) delete process.env[key];
  }

  return {
    ...process.env,
    JWT_SECRET: jwt,
    OLLAMA_URL: process.env.OLLAMA_URL || "",
    OLLAMA_CHAT_MODEL: process.env.OLLAMA_CHAT_MODEL || process.env.TEXT_MODEL || "",
    OLLAMA_AGENT_MODEL: process.env.OLLAMA_AGENT_MODEL || process.env.HEARTS_MODEL || process.env.TEXT_MODEL || "",
    OLLAMA_EMBEDDING_MODEL: process.env.OLLAMA_EMBEDDING_MODEL || process.env.EMBEDDING_MODEL || "inteligencia-digna:bge-m3-rag",
  };
}

export const env = validateEnv();

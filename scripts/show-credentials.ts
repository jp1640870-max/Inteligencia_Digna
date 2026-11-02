import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readEffectiveEnv } from "./lib/env-file";

const env = readEffectiveEnv();
const credentialsPath =
  process.env.CREDENTIALS_FILE ||
  resolve(process.cwd(), "..", "Inteligencia_Digna.local", "CREDENTIALS.md");

let adminPassword = "";
if (existsSync(credentialsPath)) {
  const content = readFileSync(credentialsPath, "utf8");
  const match = content.match(/Admin password:\s*(.+)/i);
  if (match) adminPassword = match[1].trim();
}

function line(label: string, value: string | undefined): string {
  return `  ${label.padEnd(20)} ${value || "(vacío)"}`;
}

function mask(input: string | undefined, visible = 6): string {
  if (!input) return "(vacío)";
  if (input.length <= visible * 2) return "*".repeat(input.length);
  return `${input.slice(0, visible)}…${input.slice(-visible)}`;
}

const pgPort = env.POSTGRES_PORT || "5433";
const pgAdminPort = env.PGADMIN_PORT || "5050";
const minioConsolePort = env.MINIO_CONSOLE_PORT || "9001";

console.log("\n🔐 Credenciales locales de Inteligencia Digna");
console.log("   (solo para desarrollo; no las publiques)\n");

console.log("PostgreSQL");
console.log(line("Host", "127.0.0.1"));
console.log(line("Puerto", pgPort));
console.log(line("Base", env.POSTGRES_DB || "inteligencia_digna"));
console.log(line("Usuario", env.POSTGRES_USER || "inteligencia_digna"));
console.log(line("Contraseña", env.POSTGRES_PASSWORD));
console.log(line("URL", env.DATABASE_URL));

console.log("\npgAdmin");
console.log(line("URL", `http://127.0.0.1:${pgAdminPort}`));
console.log(line("Email", env.PGADMIN_EMAIL || "admin@digna.com"));
console.log(line("Contraseña", env.PGADMIN_PASSWORD));

console.log("\nMinIO");
console.log(line("Consola", `http://127.0.0.1:${minioConsolePort}`));
console.log(line("API", env.MINIO_ENDPOINT || "http://127.0.0.1:9000"));
console.log(line("Usuario", env.MINIO_ROOT_USER || env.MINIO_ACCESS_KEY));
console.log(line("Contraseña", env.MINIO_ROOT_PASSWORD || env.MINIO_SECRET_KEY));
console.log(line("Bucket", env.MINIO_BUCKET || "attachments"));

console.log("\nAplicación");
console.log(line("URL local", "https://localhost:3000"));
console.log(line("Admin email", env.ADMIN_EMAIL || "admin@digna.super"));
console.log(line("Admin password", env.ADMIN_PASSWORD || adminPassword || "(ver CREDENTIALS.md)"));

console.log("\nGoogle OAuth");
console.log(line("Client ID", mask(env.GOOGLE_CLIENT_ID, 12)));
console.log(line("Client Secret", env.GOOGLE_CLIENT_SECRET ? "configurado" : "FALTA"));

console.log("\nngrok");
console.log(line("Dominio", env.NGROK_DOMAIN || "(sin configurar)"));
if (env.NGROK_DOMAIN) {
  console.log(line("Callback", `https://${env.NGROK_DOMAIN}/api/auth/google/callback`));
}

console.log(`\nArchivo de credenciales:\n  ${credentialsPath}`);
console.log("\nJWT_SECRET y GOOGLE_CLIENT_SECRET no se imprimen completos.\n");

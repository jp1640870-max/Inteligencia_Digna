/**
 * Servidor de desarrollo con:
 *  - HTTPS experimental (necesario para Google OAuth local)
 *  - Detección automática de ngrok
 *  - Recordatorio de la URL de callback de Google
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

function readEnvValue(fileName, key) {
  const filePath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) return "";
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    if (line.slice(0, separator).trim() !== key) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return "";
}

// ─── 1. Validar que .env.local existe ───
const envPath = path.join(process.cwd(), ".env.local");
if (!fs.existsSync(envPath)) {
  console.error("\n❌ No se encuentra .env.local");
  console.error("   Cópialo desde .env.example:");
  console.error("   copy .env.example .env.local\n");
  process.exit(1);
}

const ngrokDomain = (
  readEnvValue(".env.local", "NGROK_DOMAIN") ||
  readEnvValue(".env", "NGROK_DOMAIN") ||
  ""
)
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "");

// ─── 2. Arrancar Next.js con HTTPS ───
const next = spawn("npx", ["next", "dev", "--experimental-https"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env },
});

// ─── 3. Detectar ngrok automáticamente ───
const NGROK_API = "http://127.0.0.1:4040/api/tunnels";
const CHECK_INTERVAL = 4000; // 4s
const MAX_RETRIES = 30; // 2 minutos máximo

let attempts = 0;
const checkNgrok = setInterval(async () => {
  attempts++;
  try {
    const res = await fetch(NGROK_API);
    const data = await res.json();
    const url = data.tunnels?.[0]?.public_url?.replace(/\/+$/, "");
    if (url) {
      const host = url.replace(/^https?:\/\//, "");
      console.log(`\n  🔗 Ngrok URL: ${url}`);
      console.log(`  🔗 Login:     ${url}/login`);
      console.log(`  🔑 Callback:  ${url}/api/auth/google/callback`);
      if (ngrokDomain && host !== ngrokDomain) {
        console.warn(`  ⚠️  NGROK_DOMAIN=${ngrokDomain} no coincide con el túnel (${host}).`);
        console.warn("     Actualiza NGROK_DOMAIN en .env/.env.local o reinicia el túnel.");
      }
      console.log("");
      clearInterval(checkNgrok);
    }
  } catch {
    if (attempts >= MAX_RETRIES) {
      console.log("\n  ⚠️  ngrok no detectado (no crítico, el dev corre localmente)\n");
      clearInterval(checkNgrok);
    }
  }
}, CHECK_INTERVAL);

next.on("close", (code) => {
  clearInterval(checkNgrok);
  process.exit(code ?? 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearInterval(checkNgrok);
    next.kill(signal);
  });
}

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

// ─── 1. Validar que .env existe ───
const envPath = path.join(process.cwd(), ".env");
if (!fs.existsSync(envPath)) {
  console.error("\n❌ No se encuentra .env");
  console.error("   Cópialo desde .env.example:");
  console.error("   copy .env.example .env\n");
  process.exit(1);
}

const ngrokDomain = (
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

// ─── 2b. Worker de imágenes ───
// En desarrollo se arranca junto con Next para que los trabajos no queden en
// cola. Se puede desactivar con IMAGE_WORKER_AUTOSTART=0.
let stopping = false;
const imageEnabled =
  (readEnvValue(".env", "IMAGE_ENABLED") || "true").toLowerCase() !== "false";
const workerAutostart =
  (readEnvValue(".env", "IMAGE_WORKER_AUTOSTART") || "true").toLowerCase() !==
  "false";
let imageWorker = null;
if (imageEnabled && workerAutostart) {
  const tsxCli = path.join(
    process.cwd(),
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs",
  );
  if (fs.existsSync(tsxCli)) {
    console.log("  → Iniciando worker de imágenes (IMAGE_WORKER_AUTOSTART=false para omitir)");
    imageWorker = spawn(
      process.execPath,
      [tsxCli, path.join("scripts", "image-worker-supervisor.ts")],
      {
        stdio: "inherit",
        env: { ...process.env, IMAGE_WORKER_AUTOSTART: "0" },
      },
    );
    imageWorker.on("exit", (code, signal) => {
      if (!stopping) {
        console.warn(
          `  ⚠ Worker de imágenes terminó (código ${code ?? "?"}, señal ${signal ?? "?"}).`,
        );
      }
    });
  }
}

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
        console.warn("     Actualiza NGROK_DOMAIN en .env o reinicia el túnel.");
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
  stopping = true;
  clearInterval(checkNgrok);
  imageWorker?.kill("SIGTERM");
  process.exit(code ?? 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    clearInterval(checkNgrok);
    imageWorker?.kill("SIGTERM");
    next.kill(signal);
  });
}

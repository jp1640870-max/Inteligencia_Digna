/**
 * Servidor de desarrollo con:
 *  - HTTPS experimental (necesario para Google OAuth local)
 *  - Detección automática de ngrok (para compartir en redes LAN)
 */
const { spawn } = require("child_process");
const path = require("path");

// ─── 1. Validar que .env.local existe ───
const fs = require("fs");
const envPath = path.join(process.cwd(), ".env.local");
if (!fs.existsSync(envPath)) {
  console.error("\n❌ No se encuentra .env.local");
  console.error("   Cópialo desde .env.example:");
  console.error("   copy .env.example .env.local\n");
  process.exit(1);
}

// ─── 2. Arrancar Next.js con HTTPS ───
const next = spawn("npx", ["next", "dev", "--experimental-https"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env },
});

// ─── 3. Detectar ngrok automáticamente ───
const NGROK_API = "http://127.0.0.1:4040/api/tunnels";
const CHECK_INTERVAL = 4000; // 4s
const MAX_RETRIES = 30;      // 2 minutos máximo

let attempts = 0;
const checkNgrok = setInterval(async () => {
  attempts++;
  try {
    const res = await fetch(NGROK_API);
    const data = await res.json();
    const url = data.tunnels?.[0]?.public_url;
    if (url) {
      console.log(`\n  🔗 Ngrok URL: ${url}`);
      console.log(`  🔗 Login:     ${url}/login\n`);
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

/**
 * Túnel ngrok para desarrollo.
 *
 * Uso:
 *   npm run tunnel        # levanta solo ngrok
 *   npm run dev:tunnel    # levanta Next + ngrok
 *
 * Requiere un authtoken configurado una vez:
 *   ngrok config add-authtoken <token>
 *
 * El dominio fijo se toma de NGROK_DOMAIN en .env.local o .env. Sin dominio,
 * ngrok asigna el dominio de desarrollo de la cuenta.
 */
const { spawn, spawnSync } = require("child_process");
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

const domain = (
  readEnvValue(".env.local", "NGROK_DOMAIN") ||
  readEnvValue(".env", "NGROK_DOMAIN") ||
  ""
)
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "");

const check = spawnSync("ngrok", ["version"], {
  stdio: "ignore",
  shell: process.platform === "win32",
});
if (check.status !== 0) {
  console.error("\n❌ ngrok no está disponible en PATH.");
  console.error("   Windows: instálalo desde Microsoft Store o https://ngrok.com/download");
  console.error("   Luego configura el token: ngrok config add-authtoken <token>\n");
  process.exit(1);
}

const args = ["http", "https://localhost:3000", "--log=stdout"];
if (domain) args.push("--url", `https://${domain}`);

console.log("\n🌐 Iniciando túnel ngrok");
console.log(`   Upstream:  https://localhost:3000`);
console.log(`   Dominio:   ${domain ? `https://${domain}` : "(asignado por ngrok)"}`);
if (domain) {
  console.log(`   Callback:  https://${domain}/api/auth/google/callback`);
}
console.log("");

const child = spawn("ngrok", args, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("error", (error) => {
  console.error(`\n❌ No se pudo iniciar ngrok: ${error.message}\n`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.log(`\n🛑 ngrok detenido (${signal}).\n`);
    process.exit(0);
  }
  process.exit(code ?? 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

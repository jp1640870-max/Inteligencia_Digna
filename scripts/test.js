/**
 * Runner de tests multiplataforma.
 *
 * - Fija NODE_ENV=test y un OLLAMA_URL que falla rápido.
 * - Ejecuta solo los tests unitarios por defecto.
 * - `npm run test:db` (o TEST_INCLUDE_DB=1) incluye la integración con BD.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const testsDir = path.join(process.cwd(), "tests");
const includeDb =
  process.argv.includes("--db") || process.env.TEST_INCLUDE_DB === "1";

const files = fs
  .readdirSync(testsDir)
  .filter((file) => file.endsWith(".test.ts"))
  .filter((file) => includeDb || file !== "kb-access-db.test.ts")
  .sort()
  .map((file) => path.posix.join("tests", file));

if (files.length === 0) {
  console.error("❌ No se encontraron tests.");
  process.exit(1);
}

console.log(
  `\n🧪 Tests ${includeDb ? "incluyendo integración con BD" : "unitarios"}: ${files.length} archivo(s)\n`
);

const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const child = spawn(
  process.execPath,
  [tsxCli, "--test", "--env-file=tests/.env.test", ...files],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "test",
      OLLAMA_URL: process.env.OLLAMA_URL || "http://127.0.0.1:1",
    },
  }
);

child.on("error", (error) => {
  console.error(`❌ No se pudo ejecutar los tests: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`❌ Tests interrumpidos por ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});

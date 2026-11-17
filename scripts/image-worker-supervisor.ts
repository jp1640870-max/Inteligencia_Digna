import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Supervisor mínimo del worker de imágenes.
 *
 * Compose ya reinicia el contenedor, pero durante desarrollo el proceso puede
 * caer por un fallo transitorio (por ejemplo, PostgreSQL arrancando). Este
 * supervisor lo reinicia con backoff exponencial y conserva la señal de parada.
 */

const tsxCli = resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const workerScript = resolve(process.cwd(), "scripts", "image-worker.ts");

if (!existsSync(tsxCli)) {
  console.error("[image-supervisor] No se encontró tsx. Ejecuta npm install.");
  process.exit(1);
}

let child: ChildProcess | null = null;
let stopping = false;
let restarts = 0;
let killTimer: NodeJS.Timeout | null = null;

function start(): void {
  if (stopping) return;
  const startedAt = Date.now();
  console.log(`[image-supervisor] iniciando worker (intento ${restarts + 1})`);

  child = spawn(process.execPath, [tsxCli, workerScript], {
    stdio: "inherit",
    env: { ...process.env, IMAGE_WORKER_SUPERVISED: "1" },
  });

  child.on("error", (error) => {
    console.error("[image-supervisor] no se pudo iniciar el worker:", error);
  });

  child.on("exit", (code, signal) => {
    child = null;
    if (killTimer) {
      clearTimeout(killTimer);
      killTimer = null;
    }
    if (stopping) {
      console.log("[image-supervisor] worker detenido.");
      process.exit(0);
    }

    // Si estuvo sano un rato, el backoff vuelve a empezar.
    if (Date.now() - startedAt > 60_000) restarts = 0;
    restarts += 1;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(restarts - 1, 5));
    console.error(
      `[image-supervisor] worker terminó (código ${code ?? "?"}, señal ${signal ?? "?"}); reinicio en ${delay} ms`,
    );
    setTimeout(start, delay);
  });
}

function stop(signal: string): void {
  if (stopping) return;
  stopping = true;
  console.log(`[image-supervisor] ${signal} recibido; deteniendo worker.`);
  if (!child) {
    process.exit(0);
    return;
  }
  child.kill("SIGTERM");
  killTimer = setTimeout(() => {
    console.error("[image-supervisor] el worker no terminó; forzando salida.");
    child?.kill("SIGKILL");
  }, 25_000);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

start();

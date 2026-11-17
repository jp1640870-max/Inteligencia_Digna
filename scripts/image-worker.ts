import { existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvironment(): void {
  const filePath = resolve(process.cwd(), ".env");
  if (existsSync(filePath)) process.loadEnvFile(filePath);
}

async function main(): Promise<void> {
  // La carga debe ocurrir antes de importar módulos que validan el entorno.
  loadEnvironment();
  const { runImageWorker } = await import("../lib/images/worker");

  const controller = new AbortController();
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(
      `[image-worker] ${signal} recibido; se dejan terminar los trabajos en curso.`,
    );
    controller.abort();
  };

  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  await runImageWorker(controller.signal);
}

main().catch((error) => {
  console.error(
    "[image-worker] error fatal:",
    error instanceof Error ? error.stack || error.message : error,
  );
  process.exitCode = 1;
});

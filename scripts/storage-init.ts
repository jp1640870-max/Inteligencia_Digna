import { existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvironment(): void {
  for (const fileName of [".env"]) {
    const filePath = resolve(process.cwd(), fileName);
    if (existsSync(filePath)) process.loadEnvFile(filePath);
  }
}

async function main(): Promise<void> {
  loadEnvironment();
  // Import dinámico: lib/storage lee variables de entorno al cargarse.
  const { ensureBucket, getStorageConfig } = await import("../lib/storage");
  await ensureBucket();
  console.log(`Bucket listo: ${getStorageConfig().bucket}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

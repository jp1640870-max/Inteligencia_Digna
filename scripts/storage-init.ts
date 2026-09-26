import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ensureBucket, getStorageConfig } from "../lib/storage";

function loadEnvironment(): void {
  for (const fileName of [".env", ".env.local"]) {
    const filePath = resolve(process.cwd(), fileName);
    if (existsSync(filePath)) process.loadEnvFile(filePath);
  }
}

async function main(): Promise<void> {
  loadEnvironment();
  await ensureBucket();
  console.log(`Bucket listo: ${getStorageConfig().bucket}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

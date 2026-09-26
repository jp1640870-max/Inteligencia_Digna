import { spawnSync } from "node:child_process";

const result = spawnSync("npx", ["tsx", "scripts/db-smoke.ts"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;

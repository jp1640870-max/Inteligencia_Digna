import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";

function loadEnvironment(): void {
  for (const fileName of [".env", ".env.local"]) {
    const filePath = resolve(process.cwd(), fileName);
    if (existsSync(filePath)) process.loadEnvFile(filePath);
  }
}

async function main(): Promise<void> {
  loadEnvironment();
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const extensions = await pool.query("SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pgcrypto') ORDER BY extname");
    const migrations = await pool.query("SELECT version, name FROM schema_migrations ORDER BY version");
    const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
    if (!extensions.rows.some((row) => row.extname === "vector")) throw new Error("La extensión vector no está instalada");
    if (!tables.rows.some((row) => row.table_name === "schema_migrations")) throw new Error("Falta schema_migrations");
    console.log(JSON.stringify({
      extensions: extensions.rows,
      migrations: migrations.rows,
      tables: tables.rows.map((row) => row.table_name),
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

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
  const sql = process.argv.slice(2).join(" ").trim();
  if (!sql) throw new Error("Uso: npm run db:query -- \"SELECT ...\"");
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  const readOnly = /^(select|show|explain|with)\b/i.test(sql);
  try {
    await client.query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
    const result = await client.query(sql);
    await client.query(readOnly ? "ROLLBACK" : "COMMIT");
    console.log(JSON.stringify({ rowCount: result.rowCount, rows: result.rows }, null, 2));
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

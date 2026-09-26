import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

type AppliedMigration = {
  name: string;
  checksum: string;
};

type Migration = {
  version: number;
  name: string;
  sql: string;
  checksum: string;
};

const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");
const lockName = "inteligencia_digna:schema_migrations";

function loadEnvironment(): void {
  for (const fileName of [".env", ".env.local"]) {
    const filePath = resolve(process.cwd(), fileName);
    if (existsSync(filePath)) process.loadEnvFile(filePath);
  }
}

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Falta DATABASE_URL");
  return databaseUrl;
}

async function loadMigrations(): Promise<Migration[]> {
  const files = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  const versions = new Set<number>();

  return Promise.all(
    files.map(async (name) => {
      const match = name.match(/^(\d+)_/);
      if (!match) throw new Error(`Nombre de migración inválido: ${name}`);
      const version = Number.parseInt(match[1], 10);
      if (versions.has(version)) throw new Error(`Versión de migración duplicada: ${version}`);
      versions.add(version);

      const sql = await readFile(resolve(migrationsDirectory, name), "utf8");
      return {
        version,
        name,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );
}

async function applyMigration(client: import("pg").PoolClient, migration: Migration): Promise<void> {
  const applied = await client.query<AppliedMigration>(
    "SELECT name, checksum FROM schema_migrations WHERE version = $1",
    [migration.version],
  );

  if (applied.rowCount) {
    const current = applied.rows[0];
    if (current.name !== migration.name || current.checksum !== migration.checksum) {
      throw new Error(`La migración ${migration.name} cambió después de aplicarse`);
    }
    console.log(`Omitida ${migration.name}`);
    return;
  }

  await client.query(migration.sql);
  await client.query(
    "INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
    [migration.version, migration.name, migration.checksum],
  );
  console.log(`Aplicada ${migration.name}`);
}

async function main(): Promise<void> {
  loadEnvironment();
  const migrations = await loadMigrations();
  const pool = new Pool({ connectionString: getDatabaseUrl(), max: 1 });

  try {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          checksum TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      for (const migration of migrations) {
        await client.query("BEGIN");
        try {
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName]);
          await applyMigration(client, migration);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  console.log("Migraciones completas");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

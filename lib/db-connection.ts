import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

let sharedPool: Pool | null = null;

function getDatabaseUrl(): string {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Falta DATABASE_URL");
  return connectionString;
}

export function getPool(): Pool {
  if (!sharedPool) {
    const max = Number(process.env.DATABASE_POOL_MAX || "10");
    sharedPool = new Pool({
      connectionString: getDatabaseUrl(),
      max: Number.isFinite(max) && max > 0 ? max : 10,
      ...(process.env.DATABASE_SSL === "require" ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    sharedPool.on("error", () => undefined);
  }
  return sharedPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> {
  return getPool().query(text, values) as Promise<QueryResult<T>>;
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => T | Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (!sharedPool) return;
  const pool = sharedPool;
  sharedPool = null;
  await pool.end();
}

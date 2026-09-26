import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";

type EmbeddingRow = { id: string; content: string };

function loadEnvironment(): void {
  for (const fileName of [".env", ".env.local"]) {
    const filePath = resolve(process.cwd(), fileName);
    if (existsSync(filePath)) process.loadEnvFile(filePath);
  }
}

function ollamaUrl(): string {
  return (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "").replace(/\/v1$/, "");
}

function embeddingModel(): string {
  return process.env.OLLAMA_EMBEDDING_MODEL || "bge-m3";
}

async function embed(client: PoolClient, texts: string[]): Promise<number[][]> {
  const response = await fetch(`${ollamaUrl()}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: embeddingModel(), input: texts, truncate: true, keep_alive: "0" }),
  });
  if (!response.ok) throw new Error(`Ollama embeddings HTTP ${response.status}`);
  const payload = (await response.json()) as { embeddings?: number[][] };
  const vectors = payload.embeddings || [];
  if (vectors.length !== texts.length) throw new Error("Ollama devolvió una cantidad inesperada de embeddings");
  if (vectors.some((vector) => vector.length !== 1024)) throw new Error("El modelo no devuelve embeddings de 1024 dimensiones");
  return vectors;
}

async function reindexTable(client: PoolClient, table: "rag_chunks" | "kb_chunks", batchSize: number): Promise<number> {
  let updated = 0;
  let offset = 0;
  while (true) {
    const result = await client.query<EmbeddingRow>(`SELECT id, content FROM ${table} ORDER BY id LIMIT $1 OFFSET $2`, [batchSize, offset]);
    if (result.rows.length === 0) return updated;
    const vectors = await embed(client, result.rows.map((row) => row.content));
    for (let index = 0; index < result.rows.length; index++) {
      await client.query(
        `UPDATE ${table} SET embedding = $1::vector, embedding_model = $2, embedding_dimensions = $3 WHERE id = $4`,
        [`[${vectors[index].join(",")}]`, embeddingModel(), 1024, result.rows[index].id],
      );
      updated += 1;
    }
    offset += batchSize;
  }
}

async function main(): Promise<void> {
  loadEnvironment();
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const client = await pool.connect();
    try {
      const rag = await reindexTable(client, "rag_chunks", 16);
      const kb = await reindexTable(client, "kb_chunks", 16);
      console.log(JSON.stringify({ model: embeddingModel(), dimensions: 1024, rag_chunks: rag, kb_chunks: kb }, null, 2));
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

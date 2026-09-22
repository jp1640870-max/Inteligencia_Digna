import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { env } from "../lib/env.js";
import { cosineSimilarity, chunkDocument } from "../lib/rag.js";

// Smoke test contra Ollama real. Solo corre con:
//   SMOKE_LIVE=1 OLLAMA_URL=http://... npm test
// (Migrado desde .kb-smoke.test.ts, que era un script manual sin runner.)
const LIVE = process.env.SMOKE_LIVE === "1";

describe("kb smoke (Ollama en vivo)", { skip: !LIVE }, () => {
  it("embeddings + similitud + chunking", async () => {
    const OLLAMA_URL = env.OLLAMA_URL;
    const emb = async (p: string): Promise<number[]> =>
      (
        await (
          await fetch(`${OLLAMA_URL}/api/embeddings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "bge-m3:latest", prompt: p }),
          })
        ).json()
      ).embedding;

    const a = await emb("Política de vacaciones de la empresa");
    assert.ok((a?.length || 0) > 0, "embedding vacío");
    const b = await emb("Política de vacaciones");
    const c = await emb("Receta de pasta con tomate");
    assert.ok(
      cosineSimilarity(a, b) > cosineSimilarity(a, c),
      "relacionados deben puntuar más"
    );
    const chunks = chunkDocument("Un texto de prueba ".repeat(50));
    assert.ok(chunks.length > 0);
  });
});

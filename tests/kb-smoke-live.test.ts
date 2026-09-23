import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { env } from "../lib/env.js";
import { cosineSimilarity, chunkDocument } from "../lib/rag.js";

// Smoke test contra SGLang real (protocolo OpenAI-compatible). Solo corre con:
//   SMOKE_LIVE=1 SGLANG_URL=http://10.0.201.10:8005 SGLANG_EMBEDDINGS_URL=http://10.0.201.10:8007 npm test
// (Migrado desde el smoke de Ollama /api/*.)
const LIVE = process.env.SMOKE_LIVE === "1";

function base(raw: string): string {
  return raw.replace(/\/+$/, "").replace(/\/v1$/, "");
}

describe("kb smoke (SGLang en vivo)", { skip: !LIVE }, () => {
  it("embeddings + similitud + chunking", async () => {
    const EMB_URL = base(env.SGLANG_EMBEDDINGS_URL || env.SGLANG_URL);
    const EMB_MODEL = env.EMBEDDING_MODEL || "bge-m3";
    const emb = async (p: string): Promise<number[]> =>
      (
        await (
          await fetch(`${EMB_URL}/v1/embeddings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: EMB_MODEL, input: p }),
          })
        ).json()
      ).data[0].embedding;

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

  it("chat completions responde texto", async () => {
    const CHAT_URL = base(env.SGLANG_URL);
    const res = await fetch(`${CHAT_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.TEXT_MODEL,
        messages: [{ role: "user", content: "Responde solo con la palabra: ok" }],
        stream: false,
        max_tokens: 20,
      }),
    });
    assert.equal(res.ok, true);
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    assert.ok((json.choices?.[0]?.message?.content || "").length > 0);
  });
});

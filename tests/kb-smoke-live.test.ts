import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { env } from "../lib/env.js";
import { cosineSimilarity, chunkDocument } from "../lib/rag.js";

const LIVE = process.env.SMOKE_LIVE === "1";
const ollamaUrl = (env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "").replace(/\/v1$/, "");
const chatModel = env.OLLAMA_CHAT_MODEL || "qwen3:8b";
const embeddingModel = env.OLLAMA_EMBEDDING_MODEL || "bge-m3";

describe("Ollama smoke", { skip: !LIVE }, () => {
  it("lista modelos", async () => {
    const response = await fetch(`${ollamaUrl}/api/tags`);
    assert.equal(response.ok, true);
    const payload = (await response.json()) as { models?: unknown[] };
    assert.ok(Array.isArray(payload.models));
  });

  it("responde chat con Qwen", async () => {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: chatModel,
        messages: [{ role: "user", content: "Responde solo con la palabra: ok" }],
        stream: false,
        think: false,
        options: { num_predict: 20 },
      }),
    });
    assert.equal(response.ok, true);
    const payload = (await response.json()) as { message?: { content?: string } };
    assert.ok((payload.message?.content || "").length > 0);
  });

  it("genera embeddings BGE y valida similitud", async () => {
    const embed = async (input: string): Promise<number[]> => {
      const response = await fetch(`${ollamaUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: embeddingModel, input, truncate: true }),
      });
      assert.equal(response.ok, true);
      const payload = (await response.json()) as { embeddings?: number[][] };
      return payload.embeddings?.[0] || [];
    };
    const a = await embed("Política de vacaciones de la empresa");
    const b = await embed("Política de vacaciones");
    const c = await embed("Receta de pasta con tomate");
    assert.ok(a.length > 0);
    assert.ok(cosineSimilarity(a, b) > cosineSimilarity(a, c));
    assert.ok(chunkDocument("Un texto de prueba ".repeat(50)).length > 0);
  });
});

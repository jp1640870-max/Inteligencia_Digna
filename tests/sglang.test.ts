import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sglangChat, sglangChatStream, sglangEmbedding } from "../lib/sglang.js";

// Tests del cliente SGLang con fetch mockeado (sin servidor real).
// tests/.env.test aporta SGLANG_URL=http://127.0.0.1:1 y TEXT_MODEL=test-model.

type Captured = { url: string; body: Record<string, unknown> };
let captured: Captured[];
let originalFetch: typeof fetch;

function mockFetch(handler: (url: string, init: RequestInit) => unknown) {
  originalFetch = globalThis.fetch;
  captured = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (url: string, init: RequestInit) => {
    captured.push({ url, body: JSON.parse(String(init.body)) });
    return handler(url, init);
  };
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function sseBody(chunks: string[]) {
  const enc = new TextEncoder();
  const bufs = chunks.map((c) => enc.encode(c));
  let i = 0;
  return {
    getReader() {
      return {
        async read(): Promise<{ done: boolean; value?: Uint8Array }> {
          if (i >= bufs.length) return { done: true, value: undefined };
          return { done: false, value: bufs[i++] };
        },
      };
    },
  };
}

beforeEach(() => {
  captured = [];
});

afterEach(() => {
  restoreFetch();
});

describe("sglangChat", () => {
  it("POST a /v1/chat/completions y devuelve el contenido recortado", async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "  hola mundo  " } }] }),
    }));
    const out = await sglangChat("test-model", [{ role: "user", content: "hi" }]);
    assert.equal(out, "hola mundo");
    assert.equal(captured.length, 1);
    assert.ok(captured[0].url.endsWith("/v1/chat/completions"));
    assert.equal(captured[0].body.model, "test-model");
    assert.equal(captured[0].body.stream, false);
  });

  it("traduce num_predict (legado) a max_tokens", async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "x" } }] }),
    }));
    await sglangChat("test-model", [{ role: "user", content: "hi" }], { num_predict: 20 });
    assert.equal(captured[0].body.max_tokens, 20);
    assert.ok(!("num_predict" in captured[0].body));
  });

  it("convierte images a content parts OpenAI (image_url)", async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    }));
    await sglangChat("test-model", [
      { role: "user", content: "mira", images: ["abc123"] },
    ]);
    const msgs = captured[0].body.messages as Array<{
      role: string;
      content: unknown;
    }>;
    assert.ok(Array.isArray(msgs[0].content));
    const parts = msgs[0].content as Array<{ type: string; image_url?: { url: string } }>;
    assert.equal(parts[1].type, "image_url");
    assert.ok(parts[1].image_url!.url.includes("abc123"));
  });

  it("lanza error honesto si el servidor responde != 2xx", async () => {
    mockFetch(() => ({
      ok: false,
      status: 500,
      text: async () => "boom",
    }));
    await assert.rejects(() => sglangChat("m", [{ role: "user", content: "hi" }]), /500/);
  });
});

describe("sglangChatStream", () => {
  it("emite deltas SSE y se detiene en [DONE]", async () => {
    mockFetch(() => ({
      ok: true,
      body: sseBody([
        `data: {"choices":[{"delta":{"content":"Ho"}}]}\n`,
        `data: {"choices":[{"delta":{"content":"la"}}]}\n`,
        `data: [DONE]\n`,
      ]),
    }));
    const parts: string[] = [];
    for await (const c of sglangChatStream("test-model", [{ role: "user", content: "hi" }])) {
      parts.push(c);
    }
    assert.deepEqual(parts, ["Ho", "la"]);
  });

  it("tolera JSON partido entre dos lecturas (buffer)", async () => {
    mockFetch(() => ({
      ok: true,
      body: sseBody([`data: {"choices":[{"delta":{"cont`, `ent":"Hola"}}]}\n\ndata: [DONE]\n`]),
    }));
    const parts: string[] = [];
    for await (const c of sglangChatStream("test-model", [{ role: "user", content: "hi" }])) {
      parts.push(c);
    }
    assert.deepEqual(parts, ["Hola"]);
  });

  it("se detiene en finish_reason aunque no llegue [DONE]", async () => {
    mockFetch(() => ({
      ok: true,
      body: sseBody([`data: {"choices":[{"delta":{"content":"a"},"finish_reason":"stop"}]}\n`]),
    }));
    const parts: string[] = [];
    for await (const c of sglangChatStream("test-model", [{ role: "user", content: "hi" }])) {
      parts.push(c);
    }
    assert.deepEqual(parts, ["a"]);
  });

  it("responde error honesto si HTTP != 2xx", async () => {
    mockFetch(() => ({ ok: false, status: 503 }));
    const parts: string[] = [];
    for await (const c of sglangChatStream("m", [{ role: "user", content: "hi" }])) {
      parts.push(c);
    }
    assert.ok(parts.join("").includes("503"));
  });
});

describe("sglangEmbedding", () => {
  it("POST a /v1/embeddings y devuelve el vector", async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    }));
    const vec = await sglangEmbedding("hola");
    assert.deepEqual(vec, [0.1, 0.2, 0.3]);
    assert.ok(captured[0].url.endsWith("/v1/embeddings"));
    assert.ok(typeof captured[0].body.input === "string");
  });

  it("devuelve [] si el servidor falla", async () => {
    mockFetch(() => ({ ok: false, status: 500 }));
    assert.deepEqual(await sglangEmbedding("hola"), []);
  });
});

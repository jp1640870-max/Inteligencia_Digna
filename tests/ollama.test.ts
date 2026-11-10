import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ollamaChat, ollamaChatStream, ollamaEmbedding, OllamaTimeoutError } from "../lib/ollama.js";

type Captured = { url: string; body: Record<string, unknown> };
let captured: Captured[];
let originalFetch: typeof fetch;

function mockFetch(handler: (url: string, init: RequestInit) => unknown) {
  originalFetch = globalThis.fetch;
  captured = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    captured.push({ url, body: JSON.parse(String(init?.body)) });
    return handler(url, init || {});
  }) as typeof fetch;
}

function ndjsonBody(lines: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    getReader() {
      return {
        async read(): Promise<{ done: boolean; value?: Uint8Array }> {
          if (index >= lines.length) return { done: true, value: undefined };
          return { done: false, value: encoder.encode(lines[index++]) };
        },
      };
    },
  };
}

beforeEach(() => {
  captured = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ollamaChat", () => {
  it("usa /api/chat y devuelve message.content", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({ message: { content: " hola " } }) }));
    const result = await ollamaChat("chat-model", [{ role: "user", content: "hola" }]);
    assert.equal(result, "hola");
    assert.ok(captured[0].url.endsWith("/api/chat"));
    assert.equal(captured[0].body.stream, false);
    assert.equal((captured[0].body.options as Record<string, unknown>).num_ctx, 32768);
  });

  it("traduce max_tokens y conserva imágenes como images", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({ message: { content: "ok" } }) }));
    await ollamaChat("chat-model", [{ role: "user", content: "mira", images: ["data:image/jpeg;base64,abc"] }], { max_tokens: 20 });
    assert.equal((captured[0].body.options as Record<string, unknown>).num_predict, 20);
    const messages = captured[0].body.messages as Array<Record<string, unknown>>;
    assert.deepEqual(messages[0].images, ["abc"]);
  });

  it("reporta errores HTTP", async () => {
    mockFetch(() => ({ ok: false, status: 503, text: async () => "down" }));
    await assert.rejects(() => ollamaChat("chat-model", [{ role: "user", content: "hola" }]), /503/);
  });
});

describe("ollamaChatStream", () => {
  it("lee NDJSON, maneja split y termina con done", async () => {
    mockFetch(() => ({
      ok: true,
      body: ndjsonBody([
        '{"message":{"content":"Ho"}}\n',
        '{"message":{"content":"la"}}\n{"done":true}\n',
      ]),
    }));
    const parts: string[] = [];
    for await (const part of ollamaChatStream("chat-model", [{ role: "user", content: "hola" }])) parts.push(part);
    assert.deepEqual(parts, ["Ho", "la"]);
  });

  it("reporta done_reason y no envía onDone a Ollama", async () => {
    mockFetch(() => ({
      ok: true,
      body: ndjsonBody([
        '{"message":{"content":"ok"}}\n',
        '{"done":true,"done_reason":"length"}\n',
      ]),
    }));

    let doneReason: string | undefined;
    for await (const _ of ollamaChatStream(
      "chat-model",
      [{ role: "user", content: "hola" }],
      { onDone: (info) => { doneReason = info.doneReason; } },
    )) {
      void _;
    }

    assert.equal(doneReason, "length");
    assert.equal((captured[0].body.options as Record<string, unknown>).onDone, undefined);
  });

  it("lanza error si Ollama devuelve error", async () => {
    mockFetch(() => ({ ok: true, body: ndjsonBody(['{"error":"model missing"}\n']) }));
    await assert.rejects(async () => {
      for await (const _ of ollamaChatStream("chat-model", [{ role: "user", content: "hola" }])) void _;
    }, /model missing/);
  });

  it("no envía timeoutMs ni idleTimeoutMs a Ollama", async () => {
    mockFetch(() => ({
      ok: true,
      body: ndjsonBody(['{"message":{"content":"ok"}}\n{"done":true}\n']),
    }));
    for await (const _ of ollamaChatStream("chat-model", [{ role: "user", content: "hola" }], {
      idleTimeoutMs: 60000,
      timeoutMs: 300000,
    })) void _;
    const options = captured[0].body.options as Record<string, unknown>;
    assert.equal(options.idleTimeoutMs, undefined);
    assert.equal(options.timeoutMs, undefined);
  });

  const encoder = new TextEncoder();

  it("aborta por inactividad si el stream deja de enviar tokens", async () => {
    const controller = new TextEncoderStream();
    const writer = controller.writable.getWriter();

    // Enviar un chunk inmediatamente
    writer.write('{"message":{"content":"Hola"}}\n');

    // No enviar más nada nunca (simula inactividad permanente).
    // El idle timeout (20ms) debe dispararse antes de que cerremos el stream (100ms).
    setTimeout(() => {
      writer.close().catch(() => undefined);
    }, 100);

    mockFetch(() => ({
      ok: true,
      body: controller.readable,
    }));

    await assert.rejects(
      async () => {
        for await (const _ of ollamaChatStream("chat-model", [{ role: "user", content: "hola" }], {
          idleTimeoutMs: 20,
        })) void _;
      },
      (err) => err instanceof OllamaTimeoutError && err.kind === "idle",
    );
  });

  it("no aborta si el stream sigue enviando tokens antes del idle timeout", async () => {
    const lines = [
      '{"message":{"content":"A"}}\n',
      '{"message":{"content":"B"}}\n',
      '{"message":{"content":"C"}}\n',
      '{"done":true}\n',
    ];
    const controller = new TextEncoderStream();
    const writer = controller.writable.getWriter();

    let i = 0;
    const interval = setInterval(() => {
      if (i >= lines.length) {
        writer.close().catch(() => undefined);
        clearInterval(interval);
        return;
      }
      writer.write(lines[i++]).catch(() => undefined);
    }, 10);

    mockFetch(() => ({
      ok: true,
      body: controller.readable,
    }));

    const parts: string[] = [];
    for await (const part of ollamaChatStream("chat-model", [{ role: "user", content: "hola" }], {
      idleTimeoutMs: 100,
    })) parts.push(part);

    clearInterval(interval);
    assert.deepEqual(parts, ["A", "B", "C"]);
  });
});

describe("ollamaEmbedding", () => {
  it("usa /api/embed y devuelve el primer vector", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }) }));
    assert.deepEqual(await ollamaEmbedding("hola"), [0.1, 0.2, 0.3]);
    assert.ok(captured[0].url.endsWith("/api/embed"));
  });
});

describe("ollamaEmbedding", () => {
  it("usa /api/embed y devuelve el primer vector", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }) }));
    assert.deepEqual(await ollamaEmbedding("hola"), [0.1, 0.2, 0.3]);
    assert.ok(captured[0].url.endsWith("/api/embed"));
  });
});

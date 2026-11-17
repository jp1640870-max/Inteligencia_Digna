import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildFlux2KleinGraph,
  ComfyCancelledError,
  ComfyUiBackend,
  type ComfyGenerateHooks,
} from "../lib/images/comfyui";

process.env.COMFYUI_URL = "http://comfy.test";
process.env.COMFYUI_TIMEOUT_MS = "10000";
process.env.COMFYUI_POLL_MS = "250";

const originalFetch = globalThis.fetch;

type Call = { url: string; init?: RequestInit };

function installFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return calls;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.COMFYUI_TARGETED_CANCEL = "false";
});

describe("grafo FLUX.2 Klein", () => {
  it("construye un grafo t2i con los modelos configurados", () => {
    const graph = buildFlux2KleinGraph(
      {
        jobId: "00000000-0000-0000-0000-000000000001",
        prompt: "un gato",
        width: 1024,
        height: 1024,
        steps: 4,
        seed: 42,
      },
      {
        model: "model.safetensors",
        clipModel: "clip.safetensors",
        vaeModel: "vae.safetensors",
        filenamePrefix: "flux2-klein",
      } as ReturnType<typeof import("../lib/images/config").getImageConfig>,
    );

    assert.equal(graph.unet.inputs.unet_name, "model.safetensors");
    assert.equal(graph.texto.inputs.text, "un gato");
    assert.equal(graph.guardar.inputs.filename_prefix, "flux2-klein/00000000-0000-0000-0000-000000000001");
    assert.equal(graph.carga_0, undefined);
  });

  it("encadena ReferenceLatent para cada referencia", () => {
    const graph = buildFlux2KleinGraph(
      {
        jobId: "00000000-0000-0000-0000-000000000001",
        prompt: "edita",
        width: 1024,
        height: 1024,
        steps: 4,
        seed: 42,
        references: [
          { buffer: Buffer.from("x"), mime: "image/png", filename: "ref" },
        ],
      },
      {
        model: "model.safetensors",
        clipModel: "clip.safetensors",
        vaeModel: "vae.safetensors",
        filenamePrefix: "flux2-klein",
      } as ReturnType<typeof import("../lib/images/config").getImageConfig>,
    );

    assert.equal(graph.carga_0.class_type, "LoadImage");
    assert.equal(graph.ref_pos_0.class_type, "ReferenceLatent");
    assert.deepEqual(graph.guia.inputs.positive, ["ref_pos_0", 0]);
    assert.deepEqual(graph.guia.inputs.negative, ["ref_neg_0", 0]);
  });
});

describe("inspección de ComfyUI", () => {
  it("trata execution_error como error aunque completed sea false", async () => {
    installFetch((url) => {
      if (url.includes("/history/p1")) {
        return Response.json({
          p1: {
            status: {
              status_str: "error",
              completed: false,
              messages: [
                ["execution_error", { exception_message: "CUDA out of memory" }],
              ],
            },
          },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const result = await new ComfyUiBackend().inspect("p1");
    assert.equal(result.state, "error");
    assert.match(result.error || "", /CUDA out of memory/);
  });

  it("detecta una salida completada", async () => {
    installFetch((url) => {
      if (url.includes("/history/p1")) {
        return Response.json({
          p1: {
            status: { status_str: "success", completed: true },
            outputs: { guardar: { images: [{ filename: "a.png", type: "output" }] } },
          },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const result = await new ComfyUiBackend().inspect("p1");
    assert.equal(result.state, "completed");
    assert.equal(result.output?.filename, "a.png");
  });

  it("no confunde un historial en ejecución con no encontrado", async () => {
    installFetch(() =>
      Response.json({
        p1: { status: { status_str: "success", completed: false } },
      }),
    );
    const result = await new ComfyUiBackend().inspect("p1");
    assert.equal(result.state, "running");
  });
});

describe("cancelación de ComfyUI", () => {
  it("borra de la cola y nunca llama /interrupt sin capacidad dirigida", async () => {
    process.env.COMFYUI_TARGETED_CANCEL = "false";
    const calls = installFetch(() => Response.json({ deleted: true }));

    const result = await new ComfyUiBackend().cancel("p1");
    assert.deepEqual(result, { deleted: true, interrupted: false });
    assert.ok(calls.some((call) => call.url.endsWith("/queue")));
    assert.ok(!calls.some((call) => call.url.endsWith("/interrupt")));
  });

  it("usa /interrupt solo con prompt_id y capacidad habilitada", async () => {
    process.env.COMFYUI_TARGETED_CANCEL = "true";
    const calls = installFetch(() => Response.json({ deleted: true }));

    const result = await new ComfyUiBackend().cancel("p1");
    assert.equal(result.interrupted, true);
    const interrupt = calls.find((call) => call.url.endsWith("/interrupt"));
    assert.ok(interrupt);
    assert.deepEqual(JSON.parse(String(interrupt.init?.body)), { prompt_id: "p1" });
  });

  it("descarta la salida si se cancela durante la generación", async () => {
    process.env.COMFYUI_TARGETED_CANCEL = "false";
    const calls = installFetch((url) => {
      if (url.endsWith("/system_stats")) return Response.json({ system: {} });
      if (url.endsWith("/prompt")) return Response.json({ prompt_id: "p1" });
      if (url.endsWith("/queue")) return Response.json({ deleted: true });
      if (url.includes("/history/")) {
        return Response.json({
          p1: { status: { status_str: "success", completed: false } },
        });
      }
      return new Response("not found", { status: 404 });
    });

    let checks = 0;
    const hooks: ComfyGenerateHooks = {
      onPromptId: async () => undefined,
      isCancelled: async () => {
        checks += 1;
        return checks >= 3;
      },
    };

    await assert.rejects(
      () =>
        new ComfyUiBackend().generate(
          {
            jobId: "job",
            prompt: "gato",
            width: 256,
            height: 256,
            steps: 4,
            seed: 42,
          },
          hooks,
        ),
      ComfyCancelledError,
    );
    assert.ok(calls.some((call) => call.url.endsWith("/queue")));
    assert.ok(!calls.some((call) => call.url.endsWith("/interrupt")));
  });
});

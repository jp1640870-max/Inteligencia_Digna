import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";

import { getImageConfig } from "./config";

type NodeValue = string | number | boolean | [string, number];
type ComfyNode = { class_type: string; inputs: Record<string, NodeValue> };
export type ComfyGraph = Record<string, ComfyNode>;

export type ComfyImageRef = {
  filename: string;
  subfolder?: string;
  type?: string;
};

type ComfyHistoryEntry = {
  status?: {
    status_str?: string;
    completed?: boolean;
    messages?: Array<[string, unknown]>;
  };
  outputs?: Record<string, { images?: ComfyImageRef[] }>;
};

export type ComfyReference = {
  buffer: Buffer;
  mime: string;
  filename: string;
};

export type ComfyGenerateInput = {
  jobId: string;
  prompt: string;
  width: number;
  height: number;
  steps: number;
  seed: number;
  references?: ComfyReference[];
};

export type ComfyOutput = {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  promptId: string;
};

export type ComfyGenerateHooks = {
  /** Debe persistirse antes de empezar a consultar el historial. */
  onPromptId: (promptId: string) => Promise<void>;
  isCancelled?: () => Promise<boolean>;
  heartbeat?: () => Promise<void>;
};

export type ComfyPromptState =
  | "queued"
  | "running"
  | "completed"
  | "error"
  | "not_found";

export type ComfyInspection = {
  state: ComfyPromptState;
  error?: string;
  output?: ComfyImageRef;
};

export type ComfyHealth = {
  ok: boolean;
  url: string;
  workflowConfigured: boolean;
  workflowReadable: boolean;
  error?: string;
};

export class ComfyUiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ComfyUiError";
    this.code = code;
  }
}

export class ComfyCancelledError extends Error {
  readonly code = "comfy_cancelled";

  constructor(message = "Generación cancelada.") {
    super(message);
    this.name = "ComfyCancelledError";
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function extFromMime(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

function safeName(value: string, fallback: string): string {
  const cleaned = String(value || "")
    .replace(/\.[A-Za-z0-9]+$/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 80);
  return cleaned || fallback;
}

function renderPromptError(entry: ComfyHistoryEntry): string {
  for (const [type, payload] of entry.status?.messages || []) {
    if (
      (type === "execution_error" ||
        type === "execution_interrupted" ||
        type === "prompt_outputs_failed_validation") &&
      payload &&
      typeof payload === "object"
    ) {
      const value = payload as Record<string, unknown>;
      const message = String(
        value.message || value.exception_message || value.exception_type || "",
      );
      if (message) return message;
    }
  }
  return entry.status?.status_str === "error"
    ? "ComfyUI reportó un error de ejecución sin detalle."
    : "Error desconocido de ComfyUI.";
}

function firstImage(entry: ComfyHistoryEntry): ComfyImageRef | undefined {
  for (const output of Object.values(entry.outputs || {})) {
    const image = output.images?.[0];
    if (image?.filename) return image;
  }
  return undefined;
}

/**
 * Genera el grafo programático de FLUX.2 Klein.
 *
 * Se construye aquí y no se lee de `COMFYUI_WORKFLOW` porque el worker no
 * puede acceder a rutas del host del DGX y porque el flujo de edición necesita
 * nodos ReferenceLatent que el workflow t2i remoto no contiene.
 */
export function buildFlux2KleinGraph(
  input: ComfyGenerateInput,
  config = getImageConfig(),
): ComfyGraph {
  const references = input.references ?? [];
  const graph: ComfyGraph = {
    unet: {
      class_type: "UNETLoader",
      inputs: { unet_name: config.model, weight_dtype: "default" },
    },
    clip: {
      class_type: "CLIPLoader",
      inputs: { clip_name: config.clipModel, type: "flux2", device: "default" },
    },
    vae: {
      class_type: "VAELoader",
      inputs: { vae_name: config.vaeModel },
    },
    texto: {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["clip", 0], text: input.prompt },
    },
    negativo: {
      class_type: "ConditioningZeroOut",
      inputs: { conditioning: ["texto", 0] },
    },
  };

  let positive: [string, number] = ["texto", 0];
  let negative: [string, number] = ["negativo", 0];

  references.forEach((reference, index) => {
    const load = `carga_${index}`;
    const scale = `escala_${index}`;
    const encode = `codifica_${index}`;
    const refPos = `ref_pos_${index}`;
    const refNeg = `ref_neg_${index}`;
    const uploadedName = `${safeName(reference.filename, `referencia_${index + 1}`)}.${extFromMime(reference.mime)}`;

    graph[load] = { class_type: "LoadImage", inputs: { image: uploadedName } };
    graph[scale] = {
      class_type: "ImageScaleToTotalPixels",
      inputs: {
        image: [load, 0],
        upscale_method: "nearest-exact",
        megapixels: 1,
        resolution_steps: 1,
      },
    };
    graph[encode] = {
      class_type: "VAEEncode",
      inputs: { pixels: [scale, 0], vae: ["vae", 0] },
    };
    graph[refPos] = {
      class_type: "ReferenceLatent",
      inputs: { conditioning: positive, latent: [encode, 0] },
    };
    graph[refNeg] = {
      class_type: "ReferenceLatent",
      inputs: { conditioning: negative, latent: [encode, 0] },
    };
    positive = [refPos, 0];
    negative = [refNeg, 0];
  });

  graph.latente = {
    class_type: "EmptyFlux2LatentImage",
    inputs: { width: input.width, height: input.height, batch_size: 1 },
  };
  graph.sigmas = {
    class_type: "Flux2Scheduler",
    inputs: { steps: input.steps, width: input.width, height: input.height },
  };
  graph.ruido = {
    class_type: "RandomNoise",
    inputs: { noise_seed: input.seed },
  };
  graph.sampler = {
    class_type: "KSamplerSelect",
    inputs: { sampler_name: "euler" },
  };
  graph.guia = {
    class_type: "CFGGuider",
    inputs: { model: ["unet", 0], positive, negative, cfg: 1 },
  };
  graph.muestreo = {
    class_type: "SamplerCustomAdvanced",
    inputs: {
      noise: ["ruido", 0],
      guider: ["guia", 0],
      sampler: ["sampler", 0],
      sigmas: ["sigmas", 0],
      latent_image: ["latente", 0],
    },
  };
  graph.decodifica = {
    class_type: "VAEDecode",
    inputs: { samples: ["muestreo", 0], vae: ["vae", 0] },
  };
  graph.guardar = {
    class_type: "SaveImage",
    inputs: {
      images: ["decodifica", 0],
      filename_prefix: `${config.filenamePrefix.replace(/\/+$/, "")}/${input.jobId}`,
    },
  };
  return graph;
}

export type ImageBackend = {
  readonly name: string;
  generate(input: ComfyGenerateInput, hooks: ComfyGenerateHooks): Promise<ComfyOutput>;
  cancel(promptId: string): Promise<{ deleted: boolean; interrupted: boolean }>;
  inspect(promptId: string): Promise<ComfyInspection>;
  downloadOutput(reference: ComfyImageRef, promptId?: string): Promise<ComfyOutput>;
  health(): Promise<ComfyHealth>;
};

export class ComfyUiBackend implements ImageBackend {
  readonly name = "comfyui-flux2-klein";

  private config() {
    return getImageConfig();
  }

  private async fetchJson(
    path: string,
    init: RequestInit,
    timeoutMs: number,
    code: string,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.config().comfyUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ComfyUiError(code, `No se pudo conectar con ComfyUI: ${message}`);
    }
    const text = await response.text();
    let body: unknown = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    if (!response.ok) {
      const detail =
        body && typeof body === "object" && "error" in body
          ? String((body as Record<string, unknown>).error)
          : text.slice(0, 500);
      throw new ComfyUiError(code, `ComfyUI respondió ${response.status}: ${detail}`);
    }
    return body;
  }

  async health(): Promise<ComfyHealth> {
    const config = this.config();
    let workflowReadable = false;
    if (config.comfyWorkflow) {
      try {
        await access(config.comfyWorkflow);
        workflowReadable = true;
      } catch {
        workflowReadable = false;
      }
    }
    try {
      await this.fetchJson("/system_stats", { method: "GET" }, 8_000, "comfy_unavailable");
      return {
        ok: true,
        url: config.comfyUrl,
        workflowConfigured: Boolean(config.comfyWorkflow),
        workflowReadable,
      };
    } catch (error) {
      return {
        ok: false,
        url: config.comfyUrl,
        workflowConfigured: Boolean(config.comfyWorkflow),
        workflowReadable,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async uploadReference(reference: ComfyReference, index: number): Promise<string> {
    const config = this.config();
    const base = safeName(reference.filename, `referencia_${index + 1}`);
    const filename = `${base}-${randomUUID().slice(0, 8)}.${extFromMime(reference.mime)}`;
    const form = new FormData();
    form.append(
      "image",
      new Blob([new Uint8Array(reference.buffer)], { type: reference.mime }),
      filename,
    );
    form.append("overwrite", "true");
    form.append("type", "input");

    let response: Response;
    try {
      response = await fetch(`${config.comfyUrl}/upload/image`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      throw new ComfyUiError(
        "comfy_upload_failed",
        `No se pudo subir la referencia a ComfyUI: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const body = (await response.json().catch(() => ({}))) as {
      name?: string;
      subfolder?: string;
      error?: string;
    };
    if (!response.ok || body.error) {
      throw new ComfyUiError(
        "comfy_upload_failed",
        `ComfyUI rechazó la referencia: ${body.error || response.status}`,
      );
    }
    if (!body.name) {
      throw new ComfyUiError("comfy_upload_failed", "ComfyUI no devolvió el nombre de la referencia.");
    }
    return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
  }

  async submit(input: ComfyGenerateInput): Promise<string> {
    const config = this.config();
    if ((input.references?.length ?? 0) > config.maxReferences) {
      throw new ComfyUiError(
        "comfy_too_many_references",
        `FLUX.2 Klein admite como máximo ${config.maxReferences} referencias.`,
      );
    }

    const uploaded: string[] = [];
    for (let index = 0; index < (input.references?.length ?? 0); index += 1) {
      uploaded.push(await this.uploadReference(input.references![index], index));
    }

    const graph = buildFlux2KleinGraph(input, config);
    // El nombre devuelto por `/upload/image` se inyecta en LoadImage; el grafo
    // se construye con nombres ya subidos para no depender de rutas locales.
    for (let index = 0; index < uploaded.length; index += 1) {
      const node = graph[`carga_${index}`];
      if (node) node.inputs.image = uploaded[index];
    }

    let body: Record<string, unknown>;
    try {
      body = (await this.fetchJson(
        "/prompt",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: graph, client_id: `image-worker-${input.jobId}` }),
        },
        30_000,
        "comfy_rejected",
      )) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof ComfyUiError) throw error;
      throw new ComfyUiError(
        "comfy_rejected",
        `No se pudo enviar el grafo a ComfyUI: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const promptId = String(body.prompt_id || "");
    if (!promptId) {
      throw new ComfyUiError("comfy_rejected", "ComfyUI no devolvió prompt_id.");
    }
    const nodeErrors = body.node_errors;
    if (nodeErrors && typeof nodeErrors === "object" && Object.keys(nodeErrors).length > 0) {
      throw new ComfyUiError(
        "comfy_node_error",
        `Errores de nodos en FLUX.2 Klein: ${JSON.stringify(nodeErrors).slice(0, 800)}`,
      );
    }
    return promptId;
  }

  private async inspectQueue(promptId: string): Promise<"queued" | "running" | null> {
    const body = (await this.fetchJson(
      "/queue",
      { method: "GET" },
      15_000,
      "comfy_unavailable",
    )) as {
      queue_running?: unknown[];
      queue_pending?: unknown[];
    };
    const has = (entries: unknown[] | undefined) =>
      (entries || []).some((entry) => Array.isArray(entry) && String(entry[1] ?? "") === promptId);
    if (has(body.queue_running)) return "running";
    if (has(body.queue_pending)) return "queued";
    return null;
  }

  private async history(promptId: string): Promise<ComfyHistoryEntry | null> {
    const body = (await this.fetchJson(
      `/history/${encodeURIComponent(promptId)}`,
      { method: "GET" },
      15_000,
      "comfy_unavailable",
    )) as Record<string, ComfyHistoryEntry>;
    return body[promptId] ?? null;
  }

  async inspect(promptId: string): Promise<ComfyInspection> {
    const entry = await this.history(promptId);
    if (entry) {
      const status = entry.status?.status_str || "";
      if (status === "error") {
        return { state: "error", error: renderPromptError(entry) };
      }
      if (entry.status?.completed === true) {
        const output = firstImage(entry);
        if (!output) {
          return { state: "error", error: "ComfyUI terminó sin devolver una imagen." };
        }
        return { state: "completed", output };
      }
      // `completed` puede ser false mientras sigue en ejecución; el historial
      // ya existe, así que no lo tratamos como «no encontrado».
      return { state: "running" };
    }

    const queue = await this.inspectQueue(promptId);
    if (queue) return { state: queue };
    return { state: "not_found" };
  }

  async downloadOutput(reference: ComfyImageRef, promptId = ""): Promise<ComfyOutput> {
    const config = this.config();
    const params = new URLSearchParams({
      filename: reference.filename,
      subfolder: reference.subfolder || "",
      type: reference.type || "output",
    });
    let response: Response;
    try {
      response = await fetch(`${config.comfyUrl}/view?${params.toString()}`, {
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new ComfyUiError(
        "comfy_download_failed",
        `No se pudo descargar la imagen de ComfyUI: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      throw new ComfyUiError(
        "comfy_download_failed",
        `ComfyUI no entregó la imagen (estado ${response.status}).`,
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      throw new ComfyUiError("comfy_download_failed", "ComfyUI devolvió una imagen vacía.");
    }
    return {
      buffer,
      mimeType: response.headers.get("content-type") || "image/png",
      filename: reference.filename,
      promptId,
    };
  }

  async generate(
    input: ComfyGenerateInput,
    hooks: ComfyGenerateHooks,
  ): Promise<ComfyOutput> {
    const config = this.config();

    if (await hooks.isCancelled?.()) {
      throw new ComfyCancelledError();
    }

    const stats = await this.health();
    if (!stats.ok) {
      throw new ComfyUiError(
        "comfy_unavailable",
        `ComfyUI no está disponible en ${config.comfyUrl}. ${stats.error || ""}`.trim(),
      );
    }

    const promptId = await this.submit(input);
    await hooks.onPromptId(promptId);

    if (await hooks.isCancelled?.()) {
      await this.cancel(promptId).catch(() => undefined);
      throw new ComfyCancelledError();
    }

    const deadline = Date.now() + config.timeoutMs;
    let cancelSent = false;
    while (Date.now() < deadline) {
      await delay(config.pollMs);
      await hooks.heartbeat?.();

      if (await hooks.isCancelled?.()) {
        if (!cancelSent) {
          cancelSent = true;
          await this.cancel(promptId).catch(() => undefined);
        }
        // Si no hay cancelación dirigida, el prompt puede seguir corriendo en
        // ComfyUI. Se descarta el resultado y se marca cancelado; nunca se
        // interrumpe globalmente el servidor.
        throw new ComfyCancelledError();
      }

      const entry = await this.history(promptId);
      if (entry) {
        const status = entry.status?.status_str || "";
        // El bug conocido de dev consultaba `completed` antes que el error y
        // convertía un execution_error en un timeout. Aquí el error gana.
        if (status === "error") {
          throw new ComfyUiError("comfy_execution_error", renderPromptError(entry));
        }
        if (entry.status?.completed === true) {
          const output = firstImage(entry);
          if (!output) {
            throw new ComfyUiError(
              "comfy_output_missing",
              "ComfyUI terminó pero no produjo ninguna imagen.",
            );
          }
          return this.downloadOutput(output, promptId);
        }
      }
    }

    throw new ComfyUiError(
      "comfy_timeout",
      `FLUX.2 Klein no terminó en ${Math.round(config.timeoutMs / 1000)} s (prompt_id ${promptId}).`,
    );
  }

  async cancel(promptId: string): Promise<{ deleted: boolean; interrupted: boolean }> {
    if (!promptId) throw new ComfyUiError("comfy_cancel_invalid", "Falta prompt_id para cancelar.");
    const config = this.config();
    let deleted = false;
    let interrupted = false;

    try {
      const body = (await this.fetchJson(
        "/queue",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ delete: [promptId] }),
        },
        15_000,
        "comfy_cancel_failed",
      )) as Record<string, unknown>;
      deleted = body.deleted === true || Array.isArray(body.deleted);
    } catch {
      // La cola puede no aceptar borrado en versiones antiguas.
    }

    // Nunca se llama `/interrupt` sin prompt_id: en ComfyUI eso interrumpe el
    // trabajo que esté ejecutándose, posiblemente de otro usuario.
    if (config.targetedCancel && promptId) {
      try {
        await this.fetchJson(
          "/interrupt",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt_id: promptId }),
          },
          15_000,
          "comfy_cancel_failed",
        );
        interrupted = true;
      } catch {
        // Si la versión no soporta cancelación dirigida, se deja terminar y se
        // descarta el resultado; no se interrumpe globalmente.
      }
    }
    return { deleted, interrupted };
  }
}

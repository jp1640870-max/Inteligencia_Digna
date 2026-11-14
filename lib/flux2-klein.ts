import { randomInt, randomUUID } from "node:crypto";

const COMFY_URL = (process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");
const FLUX2_UNET = process.env.FLUX2_UNET || "flux-2-klein-4b-fp8.safetensors";
const FLUX2_CLIP = process.env.FLUX2_CLIP || "qwen_3_4b.safetensors";
const FLUX2_VAE = process.env.FLUX2_VAE || "flux2-vae.safetensors";
const FLUX2_SAMPLER = process.env.FLUX2_SAMPLER || "euler";
const FLUX2_STEPS = parseInt(process.env.FLUX2_STEPS || "4", 10);
const FLUX2_WIDTH = parseInt(process.env.FLUX2_WIDTH || "1024", 10);
const FLUX2_HEIGHT = parseInt(process.env.FLUX2_HEIGHT || "1024", 10);
const FLUX2_TIMEOUT_MS = parseInt(
  process.env.FLUX2_TIMEOUT_MS || process.env.COMFY_TIMEOUT_MS || "900000",
  10
);

type NodeValue = string | number | boolean | [string, number];
type ComfyNode = { class_type: string; inputs: Record<string, NodeValue> };
type ComfyGraph = Record<string, ComfyNode>;

type ComfyImage = { filename: string; subfolder?: string; type?: string };

type ComfyHistoryEntry = {
  status?: {
    status_str?: string;
    completed?: boolean;
    messages?: Array<[string, unknown]>;
  };
  outputs?: Record<string, { images?: ComfyImage[] }>;
};

export type Flux2Options = {
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
};

export type Flux2Reference = {
  data: string;
  mime?: string;
  filename?: string;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function extFromMime(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

function parseReference(reference: Flux2Reference): { buffer: Buffer; mime: string } {
  const value = reference.data.trim();
  const match = /^data:([^;,]+)?;base64,([\s\S]*)$/.exec(value);
  const mime = reference.mime || match?.[1] || "image/png";
  const payload = match ? match[2] : value;
  if (payload.length > 35_000_000) {
    throw new Error("La imagen de referencia supera el límite de 25 MB");
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(payload.replace(/\s+/g, ""), "base64");
  } catch {
    throw new Error("La imagen de referencia no es base64 válido");
  }
  if (!buffer.byteLength) {
    throw new Error("La imagen de referencia está vacía");
  }
  if (buffer.byteLength > 25 * 1024 * 1024) {
    throw new Error("La imagen de referencia supera el límite de 25 MB");
  }
  return { buffer, mime };
}

async function uploadReference(
  reference: Flux2Reference,
  index: number
): Promise<string> {
  const { buffer, mime } = parseReference(reference);
  const base = (reference.filename || `flux2-referencia-${index + 1}`)
    .replace(/\.[A-Za-z0-9]+$/, "")
    .replace(/[^A-Za-z0-9._-]/g, "_");
  const filename = `${base || `flux2-referencia-${index + 1}`}-${randomUUID().slice(0, 8)}.${extFromMime(mime)}`;

  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(buffer)], { type: mime }), filename);
  form.append("overwrite", "true");

  let res: Response;
  try {
    res = await fetch(`${COMFY_URL}/upload/image`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    throw new Error(
      `No se pudo subir la imagen de referencia a ComfyUI (${COMFY_URL}): ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  }

  const body = (await res.json().catch(() => ({}))) as {
    name?: string;
    subfolder?: string;
    error?: string;
  };
  if (!res.ok || body.error) {
    throw new Error(
      `ComfyUI rechazó la imagen de referencia: ${body.error || res.status}`
    );
  }
  if (!body.name) {
    throw new Error("ComfyUI no devolvió el nombre de la imagen de referencia");
  }
  return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
}

function buildGraph(
  prompt: string,
  options: Flux2Options,
  referenceNames: string[]
): ComfyGraph {
  const graph: ComfyGraph = {
    unet: {
      class_type: "UNETLoader",
      inputs: { unet_name: FLUX2_UNET, weight_dtype: "default" },
    },
    clip: {
      class_type: "CLIPLoader",
      inputs: { clip_name: FLUX2_CLIP, type: "flux2", device: "default" },
    },
    vae: { class_type: "VAELoader", inputs: { vae_name: FLUX2_VAE } },
    texto: {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["clip", 0], text: prompt },
    },
    negativo: {
      class_type: "ConditioningZeroOut",
      inputs: { conditioning: ["texto", 0] },
    },
  };

  let positive: [string, number] = ["texto", 0];
  let negative: [string, number] = ["negativo", 0];
  let sizeSource: [string, number] | null = null;

  referenceNames.forEach((name, index) => {
    const carga = `carga_${index}`;
    const escala = `escala_${index}`;
    const codifica = `codifica_${index}`;
    const refPos = `ref_pos_${index}`;
    const refNeg = `ref_neg_${index}`;

    graph[carga] = { class_type: "LoadImage", inputs: { image: name } };
    graph[escala] = {
      class_type: "ImageScaleToTotalPixels",
      inputs: {
        image: [carga, 0],
        upscale_method: "nearest-exact",
        megapixels: 1.0,
        resolution_steps: 1,
      },
    };
    graph[codifica] = {
      class_type: "VAEEncode",
      inputs: { pixels: [escala, 0], vae: ["vae", 0] },
    };
    graph[refPos] = {
      class_type: "ReferenceLatent",
      inputs: { conditioning: positive, latent: [codifica, 0] },
    };
    graph[refNeg] = {
      class_type: "ReferenceLatent",
      inputs: { conditioning: negative, latent: [codifica, 0] },
    };

    positive = [refPos, 0];
    negative = [refNeg, 0];
    if (!sizeSource) sizeSource = [escala, 0];
  });

  let width: NodeValue = options.width ?? FLUX2_WIDTH;
  let height: NodeValue = options.height ?? FLUX2_HEIGHT;

  if (!(options.width && options.height) && sizeSource) {
    graph.tamano = {
      class_type: "GetImageSize",
      inputs: { image: sizeSource },
    };
    width = ["tamano", 0];
    height = ["tamano", 1];
  }

  const steps = options.steps ?? FLUX2_STEPS;
  const seed = options.seed ?? randomInt(1, 2 ** 47);

  graph.latente = {
    class_type: "EmptyFlux2LatentImage",
    inputs: { width, height, batch_size: 1 },
  };
  graph.sigmas = {
    class_type: "Flux2Scheduler",
    inputs: { steps, width, height },
  };
  graph.ruido = {
    class_type: "RandomNoise",
    inputs: { noise_seed: seed },
  };
  graph.sampler = {
    class_type: "KSamplerSelect",
    inputs: { sampler_name: FLUX2_SAMPLER },
  };
  graph.guia = {
    class_type: "CFGGuider",
    inputs: { model: ["unet", 0], positive, negative, cfg: 1.0 },
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
    inputs: { images: ["decodifica", 0], filename_prefix: "flux2-klein" },
  };

  return graph;
}

function renderPromptError(entry: ComfyHistoryEntry): string {
  for (const [type, payload] of entry.status?.messages || []) {
    if (type === "execution_error" && payload && typeof payload === "object") {
      const p = payload as Record<string, unknown>;
      const msg = String(p.message || p.exception_message || "");
      if (msg) return msg;
    }
  }
  return "error desconocido de ComfyUI";
}

/**
 * Genera o edita una imagen con FLUX.2 Klein 4B usando la API de ComfyUI.
 * Sin referencias hace texto→imagen; con referencias usa ReferenceLatent para
 * editar manteniendo la composición de la primera imagen.
 */
export async function flux2GenerateImage(
  prompt: string,
  options: Flux2Options & { references?: Flux2Reference[] } = {}
): Promise<string> {
  const references = options.references || [];
  if (references.length > 4) {
    throw new Error("FLUX.2 Klein admite como máximo 4 imágenes de referencia");
  }

  try {
    const stats = await fetch(`${COMFY_URL}/system_stats`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!stats.ok) {
      throw new Error(`ComfyUI respondió con estado ${stats.status}`);
    }
  } catch (e) {
    throw new Error(
      `ComfyUI no está disponible en ${COMFY_URL}. Levanta el túnel SSH (scripts/comfy-tunnel.ps1) o revisa COMFY_URL. ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  }

  const referenceNames: string[] = [];
  for (let i = 0; i < references.length; i += 1) {
    referenceNames.push(await uploadReference(references[i], i));
    console.log(`🖼️ Referencia ${i + 1} subida a ComfyUI: ${referenceNames[i]}`);
  }

  const graph = buildGraph(prompt, options, referenceNames);
  const clientId = randomUUID();

  let res: Response;
  let promptId = "";
  try {
    res = await fetch(`${COMFY_URL}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: graph, client_id: clientId }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(
        `ComfyUI rechazó el grafo FLUX.2 Klein: ${
          typeof body.error === "string" ? body.error : JSON.stringify(body).slice(0, 400)
        }`
      );
    }
    promptId = String(body.prompt_id || "");
    if (!promptId) throw new Error("ComfyUI no devolvió prompt_id");
    const nodeErrors = body.node_errors as Record<string, unknown> | undefined;
    if (nodeErrors && Object.keys(nodeErrors).length > 0) {
      throw new Error(
        `Errores de nodos en FLUX.2 Klein: ${JSON.stringify(nodeErrors).slice(0, 600)}`
      );
    }
  } catch (e) {
    if (e instanceof Error && /^ComfyUI rechazó|^Errores de nodos/.test(e.message)) {
      throw e;
    }
    throw new Error(
      `No se pudo enviar FLUX.2 Klein a ComfyUI (${COMFY_URL}): ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  }

  const mode = referenceNames.length > 0 ? "edición" : "texto→imagen";
  const width = graph.latente.inputs.width;
  const height = graph.latente.inputs.height;
  const size =
    typeof width === "number" && typeof height === "number"
      ? `${width}x${height}`
      : "tamaño de la referencia";
  console.log(
    `🖼️ FLUX.2 Klein (${mode}) prompt enviado: ${promptId} (${size}, steps ${graph.sigmas.inputs.steps})`
  );

  const deadline = Date.now() + FLUX2_TIMEOUT_MS;
  let lastStatus = "";
  while (Date.now() < deadline) {
    await delay(1500);
    const hres = await fetch(`${COMFY_URL}/history/${promptId}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const history = (await hres.json().catch(() => ({}))) as Record<
      string,
      ComfyHistoryEntry
    >;
    const entry = history[promptId];
    if (!entry) continue;

    const status = entry.status?.status_str || "";
    if (status && status !== lastStatus) {
      lastStatus = status;
      console.log(`🖼️ FLUX.2 Klein estado: ${status}`);
    }

    if (!entry.status?.completed) continue;

    if (status === "error") {
      throw new Error(`FLUX.2 Klein falló: ${renderPromptError(entry)}`);
    }

    for (const output of Object.values(entry.outputs || {})) {
      const first = output.images?.[0];
      if (!first) continue;

      const params = new URLSearchParams({
        filename: first.filename,
        subfolder: first.subfolder || "",
        type: first.type || "output",
      });
      const imgRes = await fetch(`${COMFY_URL}/view?${params.toString()}`, {
        signal: AbortSignal.timeout(60_000),
      });
      if (!imgRes.ok) {
        throw new Error(
          `No se pudo descargar la imagen de ComfyUI (estado ${imgRes.status})`
        );
      }
      const buf = Buffer.from(await imgRes.arrayBuffer());
      console.log(
        `🖼️ Imagen FLUX.2 Klein descargada: ${first.filename} (${buf.byteLength} bytes)`
      );
      return `data:image/png;base64,${buf.toString("base64")}`;
    }
  }

  throw new Error(
    `FLUX.2 Klein no terminó en ${FLUX2_TIMEOUT_MS / 1000}s (prompt_id ${promptId}). Revisa ComfyUI en ${COMFY_URL}.`
  );
}

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const COMFY_URL = process.env.COMFY_URL || "http://10.0.201.10:8188";
const COMFY_WORKFLOW = resolve(
  process.cwd(),
  process.env.COMFY_WORKFLOW || "workflows/sd_turbo_t2i.json"
);
const COMFY_WORKFLOW_FALLBACK = resolve(
  process.cwd(),
  process.env.COMFY_WORKFLOW_FALLBACK || "workflows/qwen_image_2_1_t2i.json"
);
const COMFY_TIMEOUT_MS = parseInt(process.env.COMFY_TIMEOUT_MS || "300000", 10);

type ComfyNode = { class_type: string; inputs: Record<string, unknown> };
type ComfyWorkflow = Record<string, ComfyNode>;

type ComfyImage = {
  filename: string;
  subfolder: string;
  type: string;
};

type ComfyHistoryEntry = {
  status?: {
    status_str?: string;
    completed?: boolean;
    messages?: Array<[string, unknown]>;
  };
  outputs?: Record<string, { images?: ComfyImage[] }>;
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadWorkflow(workflowPath: string): ComfyWorkflow {
  try {
    return JSON.parse(readFileSync(workflowPath, "utf8")) as ComfyWorkflow;
  } catch (e) {
    throw new Error(
      `No se pudo leer el workflow de ComfyUI (${workflowPath}): ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

function renderPromptError(entry: ComfyHistoryEntry): string {
  for (const [type, payload] of entry.status?.messages || []) {
    if (type === "execution_error" && payload && typeof payload === "object") {
      const p = payload as Record<string, unknown>;
      const msg = String((p as { message?: unknown }).message || "");
      if (msg) return msg;
      const ex = String((p as { exception_message?: unknown }).exception_message || "");
      if (ex) return ex;
    }
  }
  return "error desconocido de ComfyUI";
}

/**
 * Genera una imagen vía ComfyUI usando el workflow en formato API. Inyecta el
 * prompt, dimensiones, pasos y seed (los defaults salen del propio workflow: SD
 * Turbo 512x512@4 o Qwen 768x768@25), envía /prompt, sondea /history y descarga
 * el PNG final.
 */
async function generateWithWorkflow(
  workflowPath: string,
  prompt: string,
  options: {
    width?: number;
    height?: number;
    steps?: number;
    seed?: number;
  }
): Promise<string> {
  const workflow = loadWorkflow(workflowPath);
  const width = options?.width ?? Number(workflow.latent?.inputs?.width) ?? 512;
  const height = options?.height ?? Number(workflow.latent?.inputs?.height) ?? 512;
  const steps = options?.steps ?? Number(workflow.sampler?.inputs?.steps) ?? 4;
  const seed = options?.seed ?? Math.floor(Math.random() * 2 ** 31);

  workflow.positive.inputs.text = prompt;
  workflow.negative.inputs.text = "";
  workflow.latent.inputs.width = width;
  workflow.latent.inputs.height = height;
  workflow.latent.inputs.batch_size = 1;
  workflow.sampler.inputs.seed = seed;
  workflow.sampler.inputs.steps = steps;

  const clientId = globalThis.crypto?.randomUUID?.() ?? `app_${Date.now()}`;

  let res: Response;
  let promptId = "";
  try {
    res = await fetch(`${COMFY_URL}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(
        `ComfyUI rechazó el workflow: ${typeof body.error === "string" ? body.error : JSON.stringify(body).slice(0, 300)}`
      );
    }
    promptId = String(body.prompt_id || "");
    if (!promptId) throw new Error("ComfyUI no devolvió prompt_id");
    const nodeErrors = body.node_errors as Record<string, unknown> | undefined;
    if (nodeErrors && Object.keys(nodeErrors).length > 0) {
      throw new Error(
        `Errores de nodos en el workflow: ${JSON.stringify(nodeErrors).slice(0, 400)}`
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("ComfyUI rechazó") || e instanceof Error && e.message.startsWith("Errores de nodos")) {
      throw e;
    }
    throw new Error(
      `No se pudo enviar el workflow a ComfyUI (${COMFY_URL}): ${e instanceof Error ? e.message : String(e)}`
    );
  }

  console.log(`🖼️ ComfyUI prompt enviado: ${promptId} (${width}x${height}, steps ${steps}) [${workflowPath.split(/[\\/]/).pop()}]`);

  const deadline = Date.now() + COMFY_TIMEOUT_MS;
  let lastStatus = "";
  while (Date.now() < deadline) {
    await delay(1000);
    const hres = await fetch(`${COMFY_URL}/history/${promptId}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const history = (await hres.json().catch(() => ({}))) as Record<string, ComfyHistoryEntry>;
    const entry = history[promptId];
    if (!entry) continue;

    const status = entry.status?.status_str || "";
    if (status !== lastStatus) {
      lastStatus = status;
      console.log(`🖼️ ComfyUI estado: ${status}`);
    }

    if (entry.status?.completed) {
      if (status === "error") {
        throw new Error(`ComfyUI falló al generar: ${renderPromptError(entry)}`);
      }
      for (const output of Object.values(entry.outputs || {})) {
        const first = output.images?.[0];
        if (first) {
          const params = new URLSearchParams({
            filename: first.filename,
            subfolder: first.subfolder || "",
            type: first.type || "output",
          });
          const imgRes = await fetch(`${COMFY_URL}/view?${params.toString()}`, {
            signal: AbortSignal.timeout(60_000),
          });
          if (!imgRes.ok) {
            throw new Error(`No se pudo descargar la imagen de ComfyUI (estado ${imgRes.status})`);
          }
          const buf = Buffer.from(await imgRes.arrayBuffer());
          console.log(`🖼️ Imagen descargada de ComfyUI: ${first.filename} (${buf.byteLength} bytes)`);
          const mime = "image/png";
          return `data:${mime};base64,${buf.toString("base64")}`;
        }
      }
    }
  }

  throw new Error(
    `ComfyUI no terminó en ${COMFY_TIMEOUT_MS / 1000}s (prompt_id ${promptId}). Revisa el estado del DGX o sube COMFY_TIMEOUT_MS.`
  );
}

/**
 * Genera una imagen vía ComfyUI. Usa el workflow PRIMARIO (SD-Turbo, rápido) y
 * si falla reintenta con el workflow de respaldo (Qwen Image 2.1).
 */
export async function comfyGenerateImage(
  prompt: string,
  options?: {
    width?: number;
    height?: number;
    steps?: number;
    seed?: number;
  }
): Promise<string> {
  try {
    const stats = await fetch(`${COMFY_URL}/system_stats`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!stats.ok) {
      throw new Error(`ComfyUI respondió con estado ${stats.status}`);
    }
  } catch (e) {
    console.log(`🖼️ ComfyUI no accesible: ${e instanceof Error ? e.message : String(e)}`);
    throw new Error(
      `ComfyUI no está disponible en ${COMFY_URL}. Arranca ComfyUI escuchando en 0.0.0.0:8188 (ej: python main.py --listen 0.0.0.0) y abre el puerto 8188. ${e instanceof Error ? e.message : String(e)}`
    );
  }

  const primaryLabel = COMFY_WORKFLOW.split(/[\\/]/).pop();
  try {
    const image = await generateWithWorkflow(COMFY_WORKFLOW, prompt, options ?? {});
    console.log(`🖼️ Imagen generada con ComfyUI (primario: ${primaryLabel})`);
    return image;
  } catch (e1) {
    const msg1 = e1 instanceof Error ? e1.message : String(e1);
    if (COMFY_WORKFLOW_FALLBACK !== COMFY_WORKFLOW) {
      const fallbackLabel = COMFY_WORKFLOW_FALLBACK.split(/[\\/]/).pop();
      console.error(`🖼️ Workflow primario (${primaryLabel}) falló: ${msg1}. Reintentando con respaldo (${fallbackLabel})`);
      try {
        const image = await generateWithWorkflow(COMFY_WORKFLOW_FALLBACK, prompt, options ?? {});
        console.log(`🖼️ Imagen generada con ComfyUI (respaldo: ${fallbackLabel})`);
        return image;
      } catch (e2) {
        const msg2 = e2 instanceof Error ? e2.message : String(e2);
        throw new Error(`ComfyUI falló con el primario (${primaryLabel}) y con el respaldo (${fallbackLabel}): ${msg2}`);
      }
    }
    throw e1;
  }
}
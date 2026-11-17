/**
 * Configuración del pipeline de imágenes.
 *
 * Se lee en cada llamada (no se congela al importar) para que el worker y los
 * tests puedan cambiar variables entre casos. Los nombres `COMFYUI_*` son los
 * acordados con la instalación del DGX.
 */

function text(name: string, fallback = ""): string {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

function decimal(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? fallback);
  return Number.isFinite(raw) ? raw : fallback;
}

function flag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

export type ImageBackend = "flux2-klein" | "mock";

export type ImageConfig = {
  enabled: boolean;
  backend: ImageBackend;
  comfyUrl: string;
  comfyWorkflow: string;
  model: string;
  clipModel: string;
  vaeModel: string;
  defaultWidth: number;
  defaultHeight: number;
  steps: number;
  seed: number;
  timeoutMs: number;
  pollMs: number;
  filenamePrefix: string;
  targetedCancel: boolean;
  maxPixels: number;
  promptMaxChars: number;
  maxReferences: number;
  maxReferenceBytes: number;
  maxReferenceDimension: number;
  maxOutputBytes: number;
  activeJobsPerUser: number;
  activeJobsPerChat: number;
  rateLimitPerMinute: number;
  workerConcurrency: number;
  workerPollMs: number;
  workerHeartbeatMs: number;
  workerStaleMs: number;
  maxAttempts: number;
  promptModel: string;
  promptTimeoutMs: number;
  refinePrompt: boolean;
  intentModel: string;
  intentTimeoutMs: number;
  intentMinConfidence: number;
  intentUseOllama: boolean;
  mockDelayMs: number;
};

export function getImageConfig(): ImageConfig {
  const backend = text("IMAGE_BACKEND", "flux2-klein").toLowerCase() === "mock"
    ? "mock"
    : "flux2-klein";

  return {
    enabled: flag("IMAGE_ENABLED", true),
    backend,
    comfyUrl: text("COMFYUI_URL", text("COMFY_URL", "http://127.0.0.1:8188")).replace(/\/+$/, ""),
    comfyWorkflow: text("COMFYUI_WORKFLOW"),
    model: text("COMFYUI_MODEL", "flux-2-klein-4b-fp8.safetensors"),
    clipModel: text("COMFYUI_CLIP_MODEL", "qwen_3_4b.safetensors"),
    vaeModel: text("COMFYUI_VAE_MODEL", "flux2-vae.safetensors"),
    defaultWidth: integer("COMFYUI_DEFAULT_WIDTH", 1024, 256, 2048),
    defaultHeight: integer("COMFYUI_DEFAULT_HEIGHT", 1024, 256, 2048),
    steps: integer("COMFYUI_STEPS", 4, 1, 20),
    seed: integer("COMFYUI_SEED", 42, 0, Number.MAX_SAFE_INTEGER),
    timeoutMs: integer("COMFYUI_TIMEOUT_MS", 300_000, 10_000, 1_800_000),
    pollMs: integer("COMFYUI_POLL_MS", 1_000, 250, 15_000),
    filenamePrefix: text("COMFYUI_FILENAME_PREFIX", "flux2-klein"),
    targetedCancel: flag("COMFYUI_TARGETED_CANCEL", false),
    maxPixels: integer("IMAGE_MAX_PIXELS", 1_100_000, 65_536, 8_388_608),
    promptMaxChars: integer("IMAGE_PROMPT_MAX_CHARS", 2_000, 32, 20_000),
    maxReferences: integer("IMAGE_MAX_REFERENCES", 4, 0, 8),
    maxReferenceBytes: integer("IMAGE_MAX_REFERENCE_MB", 10, 1, 50) * 1024 * 1024,
    maxReferenceDimension: integer("IMAGE_MAX_REFERENCE_DIMENSION", 8192, 256, 16384),
    maxOutputBytes: integer("IMAGE_MAX_OUTPUT_MB", 20, 1, 100) * 1024 * 1024,
    activeJobsPerUser: integer("IMAGE_MAX_ACTIVE_JOBS_PER_USER", 2, 1, 20),
    activeJobsPerChat: integer("IMAGE_MAX_ACTIVE_JOBS_PER_CHAT", 3, 1, 30),
    rateLimitPerMinute: integer("IMAGE_RATE_LIMIT_PER_MINUTE", 5, 1, 120),
    workerConcurrency: integer("IMAGE_WORKER_CONCURRENCY", 1, 1, 8),
    workerPollMs: integer("IMAGE_WORKER_POLL_MS", 1_500, 250, 30_000),
    workerHeartbeatMs: integer("IMAGE_WORKER_HEARTBEAT_MS", 5_000, 1_000, 60_000),
    workerStaleMs: integer("IMAGE_WORKER_STALE_MS", 60_000, 10_000, 900_000),
    maxAttempts: integer("IMAGE_JOB_MAX_ATTEMPTS", 2, 1, 10),
    promptModel: text("IMAGE_PROMPT_MODEL"),
    promptTimeoutMs: integer("IMAGE_PROMPT_TIMEOUT_MS", 20_000, 1_000, 120_000),
    refinePrompt: flag("IMAGE_PROMPT_REFINE", true),
    intentModel: text("IMAGE_INTENT_MODEL"),
    intentTimeoutMs: integer("IMAGE_INTENT_TIMEOUT_MS", 5_000, 500, 30_000),
    intentMinConfidence: decimal("IMAGE_INTENT_MIN_CONFIDENCE", 0.72),
    intentUseOllama: flag("IMAGE_INTENT_USE_OLLAMA", true),
    mockDelayMs: integer("IMAGE_MOCK_DELAY_MS", 25, 0, 10_000),
  };
}

export function imageGenerationDisabledMessage(): string {
  return "La generación de imágenes no está habilitada. Configura IMAGE_ENABLED y COMFYUI_URL.";
}

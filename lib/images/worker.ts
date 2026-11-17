import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import { deleteObject, getObject, getStorageConfig, putObject } from "@/lib/storage";
import type { ImageJobRow, ImageReferenceRow } from "@/types";

import {
  ComfyCancelledError,
  ComfyUiBackend,
  ComfyUiError,
  type ComfyGenerateHooks,
  type ComfyOutput,
  type ImageBackend,
} from "./comfyui";
import { getImageConfig } from "./config";
import {
  decodeImageInput,
  generatedImageObjectKey,
  imageFilename,
  ImageValidationError,
} from "./media";
import { MockImageBackend } from "./mock";
import { refineImagePrompt } from "./prompt";
import {
  claimNextJob,
  completeImageJob,
  failImageJob,
  failStalePreparingJobs,
  finishCancelledJob,
  finishJobFromExistingImage,
  getImageForJob,
  getJobById,
  getJobReferences,
  heartbeatWorker,
  listOrphanedJobs,
  registerWorker,
  reserveOrphanForInspection,
  rescheduleJobBeforeSubmit,
  setComfyPromptId,
  setJobSaving,
  unregisterWorker,
  updateJobEffectivePrompt,
} from "./repository";

export type ImageWorkerOptions = {
  backend?: ImageBackend;
  workerId?: string;
  concurrency?: number;
  pollMs?: number;
  heartbeatMs?: number;
  staleMs?: number;
  signal?: AbortSignal;
  logger?: (message: string, extra?: Record<string, unknown>) => void;
};

type ClaimedJob = ImageJobRow & { references: ImageReferenceRow[] };

const defaultLogger = (message: string, extra?: Record<string, unknown>) => {
  console.log(`[image-worker] ${message}`, extra ?? "");
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export function createImageBackend(): ImageBackend {
  return getImageConfig().backend === "mock" ? new MockImageBackend() : new ComfyUiBackend();
}

export class ImageWorker {
  private readonly backend: ImageBackend;
  private readonly workerId: string;
  private readonly concurrency: number;
  private readonly pollMs: number;
  private readonly heartbeatMs: number;
  private readonly staleMs: number;
  private readonly signal?: AbortSignal;
  private readonly logger: (message: string, extra?: Record<string, unknown>) => void;
  private readonly active = new Map<string, string>();
  private stopping = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private recoveryRunning = false;

  constructor(options: ImageWorkerOptions = {}) {
    const config = getImageConfig();
    this.backend = options.backend ?? createImageBackend();
    this.workerId =
      options.workerId ||
      process.env.IMAGE_WORKER_ID ||
      `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
    this.concurrency = options.concurrency ?? config.workerConcurrency;
    this.pollMs = options.pollMs ?? config.workerPollMs;
    this.heartbeatMs = options.heartbeatMs ?? config.workerHeartbeatMs;
    this.staleMs = options.staleMs ?? config.workerStaleMs;
    this.signal = options.signal;
    this.logger = options.logger ?? defaultLogger;
  }

  get id(): string {
    return this.workerId;
  }

  async run(): Promise<void> {
    const config = getImageConfig();
    await registerWorker({
      workerId: this.workerId,
      hostname: hostname(),
      pid: process.pid,
      concurrency: this.concurrency,
      metadata: {
        backend: this.backend.name,
        comfy_url: config.comfyUrl,
        workflow_configured: Boolean(config.comfyWorkflow),
      },
    });
    this.logger(`iniciado (${this.workerId}, ${this.backend.name}, concurrencia ${this.concurrency})`);

    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat();
    }, this.heartbeatMs);
    this.heartbeatTimer.unref?.();

    const onAbort = () => {
      this.stopping = true;
      this.logger("deteniendo; no se reencolan trabajos enviados a ComfyUI");
    };
    this.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      await this.recover();
      const loops = Array.from({ length: this.concurrency }, () =>
        this.slotLoop(),
      );
      const recoveryLoop = this.recoveryLoop();
      await Promise.all([...loops, recoveryLoop]);
    } finally {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      await unregisterWorker(this.workerId).catch(() => undefined);
      this.logger("detenido");
    }
  }

  private async heartbeat(): Promise<void> {
    try {
      const currentJobId = this.active.keys().next().value as string | undefined;
      await heartbeatWorker({
        workerId: this.workerId,
        status: this.stopping ? "stopping" : this.active.size > 0 ? "busy" : "idle",
        currentJobId: currentJobId ?? null,
      });
    } catch (error) {
      this.logger("heartbeat falló", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async slotLoop(): Promise<void> {
    while (!this.stopping && !this.signal?.aborted) {
      let job: ClaimedJob | null = null;
      try {
        job = await claimNextJob(this.workerId);
      } catch (error) {
        this.logger("no se pudo reclamar un trabajo", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (!job) {
        await sleep(this.pollMs, this.signal);
        continue;
      }

      this.active.set(job.id, job.status);
      await this.heartbeat();
      try {
        await this.processJob(job);
      } catch (error) {
        this.logger("procesamiento inesperado", {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
        });
        await failImageJob(
          job.id,
          "worker_internal_error",
          error instanceof Error ? error.message : String(error),
          "No se pudo completar la imagen. Inténtalo de nuevo.",
        ).catch(() => undefined);
      } finally {
        this.active.delete(job.id);
        await this.heartbeat();
      }
    }
  }

  private async recoveryLoop(): Promise<void> {
    const interval = Math.max(5_000, Math.min(60_000, this.staleMs / 2));
    while (!this.stopping && !this.signal?.aborted) {
      await sleep(interval, this.signal);
      if (this.stopping || this.signal?.aborted) break;
      await this.recover();
    }
  }

  /**
   * Recupera trabajos cuyo worker dejó de latir. No reencola a ciegas: si hay
   * prompt_id consulta /queue y /history; si no lo hay, falla con un mensaje
   * explícito para que el usuario reintente y no se duplique una generación.
   */
  private async recover(): Promise<void> {
    if (this.recoveryRunning || this.stopping) return;
    this.recoveryRunning = true;
    try {
      await failStalePreparingJobs(this.staleMs);
      const orphans = await listOrphanedJobs(this.staleMs);
      for (const orphan of orphans) {
        if (this.stopping || this.signal?.aborted) break;
        const job = await reserveOrphanForInspection(orphan.id, this.workerId);
        if (!job) continue;
        this.logger("recuperando trabajo huérfano", {
          jobId: job.id,
          status: job.status,
          promptId: job.comfy_prompt_id,
        });
        await this.recoverOne(job);
      }
    } catch (error) {
      this.logger("recuperación falló", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.recoveryRunning = false;
    }
  }

  private async recoverOne(job: ImageJobRow): Promise<void> {
    if (await getImageForJob(job.id)) {
      await finishJobFromExistingImage(job.id, "Imagen generada.");
      return;
    }

    if (job.cancel_requested) {
      if (job.comfy_prompt_id) await this.backend.cancel(job.comfy_prompt_id).catch(() => undefined);
      await finishCancelledJob(job.id);
      return;
    }

    if (!job.comfy_prompt_id) {
      await failImageJob(
        job.id,
        "comfy_prompt_lost",
        "El worker se reinició antes de guardar el prompt_id.",
        "No se pudo verificar la generación. Vuelve a intentarlo.",
      );
      return;
    }

    let inspection;
    try {
      inspection = await this.backend.inspect(job.comfy_prompt_id);
    } catch (error) {
      await failImageJob(
        job.id,
        "recovery_unavailable",
        `No se pudo consultar ComfyUI: ${error instanceof Error ? error.message : String(error)}`,
        "No se pudo verificar la imagen con ComfyUI. Inténtalo de nuevo.",
      );
      return;
    }

    if (inspection.state === "not_found") {
      // El trabajo ya tenía prompt_id, así que pudo ejecutarse. Aunque ComfyUI
      // ya no lo reporte, no se reencola: sería un duplicado de GPU y podría
      // producir dos imágenes distintas para una sola solicitud.
      await failImageJob(
        job.id,
        "comfy_prompt_not_found",
        "ComfyUI no conserva el trabajo, pero ya había sido enviado.",
        "La imagen no se pudo recuperar. Vuelve a intentarlo.",
      );
      return;
    }

    if (inspection.state === "error") {
      await failImageJob(
        job.id,
        "comfy_execution_error",
        inspection.error || "ComfyUI reportó un error.",
        "La generación falló en ComfyUI. Inténtalo de nuevo.",
      );
      return;
    }

    if (inspection.state === "completed" && inspection.output) {
      try {
        const output = await this.backend.downloadOutput(
          inspection.output,
          job.comfy_prompt_id,
        );
        await this.saveOutput(job, output);
      } catch (error) {
        await failImageJob(
          job.id,
          error instanceof ComfyUiError ? error.code : "recovery_save_failed",
          error instanceof Error ? error.message : String(error),
          "La imagen se generó, pero no se pudo guardar. Inténtalo de nuevo.",
        );
      }
      return;
    }

    if (inspection.state === "queued" || inspection.state === "running") {
      await this.adoptRunningPrompt(job, inspection.state);
      return;
    }

    await failImageJob(
      job.id,
      "recovery_unknown",
      "Estado de recuperación desconocido.",
      "No se pudo verificar la imagen. Vuelve a intentarlo.",
    );
  }

  private async adoptRunningPrompt(
    job: ImageJobRow,
    initialState: "queued" | "running",
  ): Promise<void> {
    const config = getImageConfig();
    const promptId = job.comfy_prompt_id!;
    const deadline = Date.now() + config.timeoutMs;
    let lastState: string = initialState;
    while (Date.now() < deadline && !this.stopping) {
      await sleep(config.pollMs, this.signal);
      const current = await getJobById(job.id);
      if (!current) return;
      if (current.cancel_requested) {
        await this.backend.cancel(promptId).catch(() => undefined);
        await finishCancelledJob(job.id);
        return;
      }
      await heartbeatWorker({
        workerId: this.workerId,
        status: "busy",
        currentJobId: job.id,
      });
      try {
        const inspection = await this.backend.inspect(promptId);
        lastState = inspection.state;
        if (inspection.state === "completed" && inspection.output) {
          const output = await this.backend.downloadOutput(inspection.output, promptId);
          await this.saveOutput(job, output);
          return;
        }
        if (inspection.state === "error") {
          await failImageJob(
            job.id,
            "comfy_execution_error",
            inspection.error || "ComfyUI reportó un error.",
            "La generación falló en ComfyUI. Inténtalo de nuevo.",
          );
          return;
        }
        if (inspection.state === "not_found") {
          await failImageJob(
            job.id,
            "comfy_prompt_lost",
            "ComfyUI dejó de reportar el trabajo durante la recuperación.",
            "No se pudo recuperar la imagen. Vuelve a intentarlo.",
          );
          return;
        }
      } catch (error) {
        this.logger("consulta de recuperación falló", {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (!this.stopping) {
      await failImageJob(
        job.id,
        "comfy_timeout",
        `La recuperación superó el tiempo máximo (último estado: ${lastState}).`,
        "La imagen tardó demasiado. Vuelve a intentarlo.",
      );
    }
  }

  private async loadReferences(job: ClaimedJob): Promise<
    Array<{ buffer: Buffer; mime: string; filename: string }>
  > {
    const config = getImageConfig();
    const references = [];
    for (const reference of job.references) {
      const buffer = await getObject(reference.object_key);
      if (buffer.length > config.maxReferenceBytes) {
        throw new ImageValidationError(
          `La referencia ${reference.original_filename} supera el tamaño permitido.`,
        );
      }
      // Valida que el objeto siga siendo una imagen real antes de enviarlo.
      decodeImageInput(
        { data: buffer.toString("base64"), mime: reference.mime_type },
        { maxBytes: config.maxReferenceBytes, maxDimension: config.maxReferenceDimension },
      );
      references.push({
        buffer,
        mime: reference.mime_type,
        filename: reference.original_filename,
      });
    }
    return references;
  }

  private async processJob(job: ClaimedJob): Promise<void> {
    const config = getImageConfig();
    let promptIdSeen = false;
    let promptId = "";

    try {
      if (job.cancel_requested) {
        await finishCancelledJob(job.id);
        return;
      }

      if (await getImageForJob(job.id)) {
        await finishJobFromExistingImage(job.id, "Imagen generada.");
        return;
      }

      const effectivePrompt = job.effective_prompt ||
        (await refineImagePrompt({
          prompt: job.prompt,
          kind: job.kind,
          context: job.context_excerpt,
          hasReferences: job.references.length > 0,
          maxChars: config.promptMaxChars,
        }));
      if (effectivePrompt !== job.effective_prompt) {
        await updateJobEffectivePrompt(job.id, effectivePrompt);
      }

      const references = await this.loadReferences(job);
      const hooks: ComfyGenerateHooks = {
        onPromptId: async (id) => {
          promptIdSeen = true;
          promptId = id;
          // Reintenta la persistencia: si se pierde, la recuperación no puede
          // distinguir entre «no enviado» y «enviado», y no debe duplicar.
          let lastError: unknown;
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              await setComfyPromptId(job.id, id);
              return;
            } catch (error) {
              lastError = error;
              await sleep(250, this.signal);
            }
          }
          throw lastError instanceof Error
            ? lastError
            : new Error("No se pudo guardar prompt_id.");
        },
        isCancelled: async () => {
          const current = await getJobById(job.id);
          return Boolean(current?.cancel_requested);
        },
        heartbeat: async () => {
          await heartbeatWorker({
            workerId: this.workerId,
            status: "busy",
            currentJobId: job.id,
          });
        },
      };

      const output = await this.backend.generate(
        {
          jobId: job.id,
          prompt: effectivePrompt,
          width: job.width,
          height: job.height,
          steps: job.steps,
          seed: job.seed ?? config.seed,
          references,
        },
        hooks,
      );
      const current = await getJobById(job.id);
      if (current?.cancel_requested) {
        await finishCancelledJob(job.id);
        return;
      }
      await this.saveOutput(job, output);
    } catch (error) {
      const current = await getJobById(job.id);
      if (current?.cancel_requested || error instanceof ComfyCancelledError) {
        if (promptId) await this.backend.cancel(promptId).catch(() => undefined);
        await finishCancelledJob(job.id);
        return;
      }

      const code = error instanceof ComfyUiError ? error.code : "generation_failed";
      const message = error instanceof Error ? error.message : String(error);
      this.logger("trabajo falló", { jobId: job.id, code, message, promptIdSeen });

      // Solo es seguro reintentar si el prompt nunca llegó a ComfyUI.
      if (
        !promptIdSeen &&
        (code === "comfy_unavailable" || code === "comfy_upload_failed") &&
        (await rescheduleJobBeforeSubmit(job.id, code, message, 5_000))
      ) {
        return;
      }

      await failImageJob(
        job.id,
        code,
        message,
        promptIdSeen
          ? "La generación falló después de enviarse a ComfyUI. Vuelve a intentarlo."
          : "No se pudo generar la imagen. Inténtalo de nuevo.",
      );
    }
  }

  private async saveOutput(job: ImageJobRow, output: ComfyOutput): Promise<void> {
    const config = getImageConfig();
    const decoded = decodeImageInput(
      { data: output.buffer.toString("base64"), mime: output.mimeType },
      {
        maxBytes: config.maxOutputBytes,
        maxDimension: 8192,
      },
    );
    const imageId = randomUUID();
    const storage = getStorageConfig();
    const key = generatedImageObjectKey(
      job.user_id,
      job.chat_id,
      imageId,
      decoded.extension,
    );

    await setJobSaving(job.id);
    await putObject(key, decoded.buffer, decoded.mime, {
      job: job.id,
      prompt_id: output.promptId,
      width: String(decoded.width),
      height: String(decoded.height),
      seed: String(job.seed ?? ""),
    });

    const parentImage = job.parent_job_id ? await getImageForJob(job.parent_job_id) : null;
    try {
      await completeImageJob({
        jobId: job.id,
        userId: job.user_id,
        chatId: job.chat_id,
        messageId: job.assistant_message_id,
        bucket: storage.bucket,
        objectKey: key,
        filename: imageFilename(config.filenamePrefix, imageId, decoded.extension),
        mimeType: decoded.mime,
        extension: decoded.extension,
        sizeBytes: decoded.bytes,
        checksumSha256: decoded.checksumSha256,
        width: decoded.width,
        height: decoded.height,
        prompt: job.prompt,
        effectivePrompt: job.effective_prompt || job.prompt,
        seed: job.seed,
        parentImageId: parentImage?.id ?? null,
        assistantText: "Imagen generada.",
        metadata: {
          backend: this.backend.name,
          comfy_prompt_id: output.promptId,
          steps: job.steps,
          kind: job.kind,
          references: (await getJobReferences(job.id)).length,
          requested_width: job.width,
          requested_height: job.height,
          output_width: decoded.width,
          output_height: decoded.height,
          model: config.model,
        },
      });
    } catch (error) {
      // Si otra ejecución alcanzó a insertar la fila, se repara el estado en
      // vez de duplicar la imagen.
      if (await getImageForJob(job.id)) {
        await finishJobFromExistingImage(job.id, "Imagen generada.");
        return;
      }
      await deleteObject(key).catch(() => undefined);
      throw error;
    }
  }

}

/** Punto de entrada usado por scripts/image-worker.ts. */
export async function runImageWorker(signal?: AbortSignal): Promise<void> {
  const worker = new ImageWorker({ signal });
  await worker.run();
}

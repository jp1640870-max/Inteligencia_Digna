import { randomInt, randomUUID } from "node:crypto";

import { deleteObject, getObject, getStorageConfig, putObject } from "@/lib/storage";
import type { ImageJobMeta, ImageReferenceInput, ImageJobKind } from "@/types";

import { getImageConfig, imageGenerationDisabledMessage } from "./config";
import {
  decodeImageInput,
  fitToPixelBudget,
  generatedImageObjectKey,
  ImageValidationError,
  referenceObjectKey,
} from "./media";
import type { ImageIntentResult } from "./intent";
import {
  addJobReference,
  countActiveJobs,
  countRecentJobs,
  createImageAttachment,
  createImageJob,
  createPlaceholderMessage,
  failImageJob,
  findJobByClientRequest,
  getGeneratedImageAssetForChat,
  getJobById,
  getJobWithImageForUser,
  getLatestGeneratedImageForChat,
  setJobQueued,
  setJobAssistantMessage,
  toImageJobMeta,
  updateAssistantMessageContent,
  userOwnsChat,
} from "./repository";

export class ImageServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ImageServiceError";
    this.code = code;
    this.status = status;
  }
}

export type StartImageJobInput = {
  userId: string;
  chatId: string;
  userMessageId: number | null;
  message: string;
  intent: ImageIntentResult;
  referenceImages?: ImageReferenceInput[];
  parentImageId?: string;
  clientRequestId?: string;
  width?: number;
  height?: number;
  history?: Array<{ role: "user" | "ai"; text?: string }>;
};

export type ImageJobStart = {
  job: ImageJobMeta;
  assistantMessageId: number;
  duplicate: boolean;
  assistantText: string;
};

function clampSize(value: unknown): number | undefined {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  const rounded = Math.round(number);
  if (rounded < 16 || rounded > 4096) return undefined;
  return rounded;
}

function normalizeRequestId(value: string | undefined): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) return randomUUID();
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(trimmed)) {
    throw new ImageServiceError(
      "invalid_request_id",
      "clientRequestId debe tener entre 1 y 100 caracteres alfanuméricos.",
      400,
    );
  }
  return trimmed;
}

function contextExcerpt(history: StartImageJobInput["history"]): string | null {
  const text = (history ?? [])
    .filter((item) => item.text && item.text.trim())
    .slice(-6)
    .map((item) => `${item.role === "user" ? "Usuario" : "Asistente"}: ${item.text!.slice(0, 500)}`)
    .join("\n");
  return text ? text.slice(0, 3_000) : null;
}

function assistantPlaceholder(label = "Preparando imagen…"): string {
  return label;
}

export async function createImageClarification(
  chatId: string,
  text: string,
): Promise<number> {
  return createPlaceholderMessage(chatId, text);
}

export async function startImageJob(input: StartImageJobInput): Promise<ImageJobStart> {
  const config = getImageConfig();
  if (!config.enabled) {
    throw new ImageServiceError("image_disabled", imageGenerationDisabledMessage(), 503);
  }
  if (!(await userOwnsChat(input.chatId, input.userId))) {
    throw new ImageServiceError("chat_not_found", "El chat no existe o no te pertenece.", 404);
  }

  const requestId = normalizeRequestId(input.clientRequestId);
  const existing = await findJobByClientRequest(input.userId, requestId);
  if (existing) {
    const details = await getJobWithImageForUser(existing.id, input.userId);
    return {
      job: toImageJobMeta(existing, details?.image ?? undefined),
      assistantMessageId: existing.assistant_message_id ?? 0,
      duplicate: true,
      assistantText: existing.status === "completed" ? "Imagen generada." : "Generando imagen…",
    };
  }

  if (input.intent.action !== "generate" && input.intent.action !== "edit" && input.intent.action !== "variant") {
    throw new ImageServiceError("not_image_request", "La intención no corresponde a una imagen.", 400);
  }

  const prompt = input.intent.prompt.trim() || "Crea una imagen";
  if (prompt.length > config.promptMaxChars) {
    throw new ImageServiceError(
      "prompt_too_long",
      `La descripción de la imagen supera ${config.promptMaxChars} caracteres.`,
      400,
    );
  }

  const active = await countActiveJobs(input.userId, input.chatId);
  if (active.user >= config.activeJobsPerUser) {
    throw new ImageServiceError(
      "too_many_active_jobs",
      `Ya tienes ${active.user} imágenes en proceso. Espera a que terminen.`,
      409,
    );
  }
  if (active.chat >= config.activeJobsPerChat) {
    throw new ImageServiceError(
      "too_many_active_jobs_chat",
      `Este chat tiene ${active.chat} imágenes en proceso. Espera a que terminen.`,
      409,
    );
  }
  if ((await countRecentJobs(input.userId, 60_000)) >= config.rateLimitPerMinute) {
    throw new ImageServiceError(
      "rate_limited",
      "Demasiadas solicitudes de imagen en el último minuto. Espera un momento.",
      429,
    );
  }

  const references = input.referenceImages ?? [];
  if (references.length > config.maxReferences) {
    throw new ImageServiceError(
      "too_many_references",
      `Puedes adjuntar como máximo ${config.maxReferences} imágenes de referencia.`,
      400,
    );
  }

  const decodedReferences = references.map((reference, index) => {
    try {
      return decodeImageInput(reference, {
        maxBytes: config.maxReferenceBytes,
        maxDimension: config.maxReferenceDimension,
      });
    } catch (error) {
      if (error instanceof ImageValidationError) {
        throw new ImageServiceError("invalid_reference", `Referencia ${index + 1}: ${error.message}`, 400);
      }
      throw error;
    }
  });

  // El mismo archivo puede llegar como adjunto y como `parentImageId` (por
  // ejemplo, al editar desde una tarjeta). Enviarlo dos veces encadena dos
  // ReferenceLatent idénticos y sobrepondera la referencia. Se conserva una
  // sola copia por checksum.
  const uniqueReferences: Array<{
    decoded: (typeof decodedReferences)[number];
    filename: string;
  }> = [];
  const referenceChecksums = new Set<string>();
  for (let index = 0; index < decodedReferences.length; index += 1) {
    const decoded = decodedReferences[index];
    if (referenceChecksums.has(decoded.checksumSha256)) continue;
    referenceChecksums.add(decoded.checksumSha256);
    uniqueReferences.push({
      decoded,
      filename:
        references[index]?.filename ||
        `referencia-${uniqueReferences.length + 1}.${decoded.extension}`,
    });
  }

  let parent:
    | Awaited<ReturnType<typeof getGeneratedImageAssetForChat>>
    | null = null;
  if (input.parentImageId) {
    parent = await getGeneratedImageAssetForChat(
      input.parentImageId,
      input.chatId,
      input.userId,
    );
    if (!parent) {
      throw new ImageServiceError(
        "parent_not_found",
        "La imagen seleccionada no existe en este chat.",
        404,
      );
    }
  } else if (input.intent.useLatestImage) {
    const latest = await getLatestGeneratedImageForChat(input.chatId, input.userId);
    if (latest) {
      parent = await getGeneratedImageAssetForChat(
        latest.image.id,
        input.chatId,
        input.userId,
      );
    }
  }

  if (
    (input.intent.action === "edit" || input.intent.action === "variant") &&
    !parent &&
    decodedReferences.length === 0
  ) {
    throw new ImageServiceError(
      "missing_image",
      "Para editar o crear una variante necesito una imagen adjunta o una imagen anterior del chat.",
      400,
    );
  }

  let parentBuffer: Buffer | null = null;
  let parentDecoded: ReturnType<typeof decodeImageInput> | null = null;
  if (parent) {
    try {
      parentBuffer = await getObject(parent.objectKey);
      parentDecoded = decodeImageInput(
        { data: parentBuffer.toString("base64"), mime: parent.mimeType },
        { maxBytes: config.maxReferenceBytes, maxDimension: config.maxReferenceDimension },
      );
    } catch (error) {
      if (error instanceof ImageValidationError) {
        throw new ImageServiceError(
          "invalid_parent",
          `No se pudo usar la imagen anterior: ${error.message}`,
          422,
        );
      }
      throw new ImageServiceError(
        "storage_unavailable",
        "No se pudo leer la imagen anterior desde el almacenamiento.",
        503,
      );
    }
  }

  // Si la imagen padre ya vino como adjunto, no se agrega otra referencia.
  const includeParentReference = Boolean(
    parent && !(parentDecoded && referenceChecksums.has(parentDecoded.checksumSha256)),
  );
  const totalReferences =
    uniqueReferences.length + (includeParentReference ? 1 : 0);
  if (totalReferences > config.maxReferences) {
    throw new ImageServiceError(
      "too_many_references",
      `Puedes adjuntar como máximo ${config.maxReferences} imágenes de referencia.`,
      400,
    );
  }

  const requestedWidth = clampSize(input.width);
  const requestedHeight = clampSize(input.height);
  const baseDimensions =
    requestedWidth && requestedHeight
      ? { width: requestedWidth, height: requestedHeight }
      : input.intent.dimensionsExplicit && input.intent.width && input.intent.height
        ? { width: input.intent.width, height: input.intent.height }
        : parentDecoded
          ? { width: parentDecoded.width, height: parentDecoded.height }
          : uniqueReferences[0]
            ? { width: uniqueReferences[0].decoded.width, height: uniqueReferences[0].decoded.height }
            : { width: input.intent.width ?? config.defaultWidth, height: input.intent.height ?? config.defaultHeight };
  const dimensions = fitToPixelBudget(
    baseDimensions.width,
    baseDimensions.height,
    config.maxPixels,
  );

  let seed: number;
  if (input.intent.action === "variant") {
    seed = randomInt(1, 2_147_483_647);
    if (parent?.seed !== null && parent?.seed !== undefined && seed === parent.seed) {
      seed = seed === 2_147_483_646 ? 1 : seed + 1;
    }
  } else if (input.intent.action === "edit") {
    seed = parent?.seed ?? config.seed;
  } else {
    seed = config.seed;
  }

  let job: Awaited<ReturnType<typeof createImageJob>>;
  try {
    job = await createImageJob({
      userId: input.userId,
      chatId: input.chatId,
      userMessageId: input.userMessageId,
      clientRequestId: requestId,
      kind: input.intent.action as ImageJobKind,
      prompt,
      contextExcerpt: contextExcerpt(input.history),
      parentJobId: parent?.jobId ?? null,
      width: dimensions.width,
      height: dimensions.height,
      steps: config.steps,
      seed,
    });
  } catch (error) {
    // Dos pestañas o un doble envío pueden pasar el chequeo previo a la vez.
    // La restricción única de (user_id, client_request_id) es la autoridad.
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "23505"
    ) {
      const raced = await findJobByClientRequest(input.userId, requestId);
      if (raced) {
        const details = await getJobWithImageForUser(raced.id, input.userId);
        return {
          job: toImageJobMeta(raced, details?.image ?? undefined),
          assistantMessageId: raced.assistant_message_id ?? 0,
          duplicate: true,
          assistantText:
            raced.status === "completed" ? "Imagen generada." : "Generando imagen…",
        };
      }
    }
    throw error;
  }

  let assistantMessageId = 0;
  try {
    assistantMessageId = await createPlaceholderMessage(
      input.chatId,
      assistantPlaceholder(),
    );
    await setJobAssistantMessage(job.id, assistantMessageId);
  } catch (error) {
    await failImageJob(
      job.id,
      "message_persistence_failed",
      error instanceof Error ? error.message : String(error),
      "No se pudo crear el mensaje de la imagen.",
    );
    throw new ImageServiceError(
      "message_persistence_failed",
      "No se pudo preparar el mensaje de la imagen.",
      500,
    );
  }

  const uploadedKeys: string[] = [];
  try {
    let sortOrder = 0;
    if (includeParentReference && parent) {
      await addJobReference({
        jobId: job.id,
        attachmentId: parent.attachmentId,
        sortOrder,
        role: "parent",
      });
      sortOrder += 1;
    }

    const storage = getStorageConfig();
    for (let index = 0; index < uniqueReferences.length; index += 1) {
      const { decoded, filename } = uniqueReferences[index];
      const key = referenceObjectKey(
        input.userId,
        input.chatId,
        job.id,
        index,
        decoded.extension,
      );
      await putObject(key, decoded.buffer, decoded.mime, {
        width: String(decoded.width),
        height: String(decoded.height),
        checksum: decoded.checksumSha256,
        job: job.id,
      });
      uploadedKeys.push(key);
      const attachmentId = await createImageAttachment({
        messageId: null,
        uploadedBy: input.userId,
        bucket: storage.bucket,
        objectKey: key,
        originalFilename: filename,
        mimeType: decoded.mime,
        extension: decoded.extension,
        sizeBytes: decoded.bytes,
        checksumSha256: decoded.checksumSha256,
        metadata: {
          width: decoded.width,
          height: decoded.height,
          job_id: job.id,
          role: "reference",
        },
      });
      await addJobReference({
        jobId: job.id,
        attachmentId,
        sortOrder,
        role: "attachment",
      });
      sortOrder += 1;
    }

    await setJobQueued(job.id);
    await updateAssistantMessageContent(assistantMessageId, "Generando imagen…");
  } catch (error) {
    for (const key of uploadedKeys) {
      await deleteObject(key).catch(() => undefined);
    }
    await failImageJob(
      job.id,
      "preparation_failed",
      error instanceof Error ? error.message : String(error),
      "No se pudo preparar la imagen. Inténtalo de nuevo.",
    );
    throw new ImageServiceError(
      "preparation_failed",
      "No se pudo preparar la imagen para el worker.",
      500,
    );
  }

  const storedJob = (await getJobById(job.id)) ?? job;
  return {
    job: toImageJobMeta(storedJob),
    assistantMessageId,
    duplicate: false,
    assistantText: "Generando imagen…",
  };
}

/** Utilidad para tests: nombre de objeto de una imagen generada. */
export function generatedObjectKey(
  userId: string,
  chatId: string,
  imageId: string,
  extension = "png",
): string {
  return generatedImageObjectKey(userId, chatId, imageId, extension);
}

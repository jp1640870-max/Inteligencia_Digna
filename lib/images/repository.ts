import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { query, withTransaction } from "@/lib/db-connection";
import type {
  GeneratedImageMeta,
  GeneratedImageRow,
  ImageJobKind,
  ImageJobMeta,
  ImageJobRow,
  ImageJobStatus,
  ImageReferenceRow,
  Msg,
} from "@/types";

import { imageDownloadUrl, imagePreviewUrl } from "./media";

type DbRow = Record<string, unknown>;

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : numberValue(value);
}

function textValue(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : textValue(value);
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function imageJobFromRow(row: DbRow): ImageJobRow {
  return {
    id: textValue(row.id),
    user_id: textValue(row.user_id),
    chat_id: textValue(row.chat_id),
    user_message_id: nullableNumber(row.user_message_id),
    assistant_message_id: nullableNumber(row.assistant_message_id),
    client_request_id: textValue(row.client_request_id),
    kind: textValue(row.kind, "generate") as ImageJobKind,
    status: textValue(row.status, "preparing") as ImageJobStatus,
    prompt: textValue(row.prompt),
    effective_prompt: nullableText(row.effective_prompt),
    context_excerpt: nullableText(row.context_excerpt),
    parent_job_id: nullableText(row.parent_job_id),
    width: numberValue(row.width, 1024),
    height: numberValue(row.height, 1024),
    steps: numberValue(row.steps, 4),
    seed: nullableNumber(row.seed),
    comfy_prompt_id: nullableText(row.comfy_prompt_id),
    worker_id: nullableText(row.worker_id),
    attempts: numberValue(row.attempts),
    max_attempts: numberValue(row.max_attempts, 2),
    cancel_requested: booleanValue(row.cancel_requested),
    error_code: nullableText(row.error_code),
    error_message: nullableText(row.error_message),
    available_at: textValue(row.available_at),
    started_at: nullableText(row.started_at),
    finished_at: nullableText(row.finished_at),
    created_at: textValue(row.created_at),
    updated_at: textValue(row.updated_at),
  };
}

export function generatedImageFromRow(row: DbRow): GeneratedImageRow {
  const metadata = parseJson(row.metadata);
  return {
    id: textValue(row.id),
    user_id: textValue(row.user_id),
    chat_id: textValue(row.chat_id),
    message_id: nullableNumber(row.message_id),
    job_id: textValue(row.job_id),
    attachment_id: textValue(row.attachment_id),
    width: numberValue(row.width, 1024),
    height: numberValue(row.height, 1024),
    prompt: textValue(row.prompt),
    effective_prompt: nullableText(row.effective_prompt),
    seed: nullableNumber(row.seed),
    parent_image_id: nullableText(row.parent_image_id),
    metadata:
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {},
    created_at: textValue(row.created_at),
  };
}

type ImageWithAttachmentRow = DbRow & {
  image_id: string;
  attachment_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number | string;
};

export function generatedImageMetaFromRow(
  row: ImageWithAttachmentRow,
  jobId: string,
  chatId: string,
): GeneratedImageMeta {
  const id = textValue(row.id ?? row.image_id);
  const seed = nullableNumber(row.seed);
  return {
    id,
    jobId,
    chatId,
    messageId: nullableNumber(row.message_id) ?? undefined,
    filename: textValue(row.filename, `${id}.png`),
    mime_type: textValue(row.mime_type, "image/png"),
    size_bytes: numberValue(row.size_bytes),
    width: numberValue(row.width, 1024),
    height: numberValue(row.height, 1024),
    prompt: textValue(row.prompt),
    seed: seed ?? undefined,
    parentImageId: nullableText(row.parent_image_id) ?? undefined,
    created_at: textValue(row.created_at),
    previewUrl: imagePreviewUrl(id),
    downloadUrl: imageDownloadUrl(id),
  };
}

export function toImageJobMeta(
  row: ImageJobRow,
  image?: GeneratedImageMeta,
): ImageJobMeta {
  return {
    id: row.id,
    chatId: row.chat_id,
    userMessageId: row.user_message_id ?? undefined,
    assistantMessageId: row.assistant_message_id ?? undefined,
    kind: row.kind,
    status: row.status,
    prompt: row.prompt,
    width: row.width,
    height: row.height,
    steps: row.steps,
    seed: row.seed ?? undefined,
    parentImageId: image?.parentImageId,
    cancelRequested: row.cancel_requested,
    error:
      row.error_code && row.error_message
        ? { code: row.error_code, message: row.error_message }
        : undefined,
    image,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type CreateImageJobInput = {
  userId: string;
  chatId: string;
  userMessageId: number | null;
  clientRequestId: string;
  kind: ImageJobKind;
  prompt: string;
  contextExcerpt?: string | null;
  parentJobId?: string | null;
  width: number;
  height: number;
  steps: number;
  seed: number | null;
};

export async function createImageJob(input: CreateImageJobInput): Promise<ImageJobRow> {
  const result = await query(
    `INSERT INTO image_jobs
       (user_id, chat_id, user_message_id, client_request_id, kind, status,
        prompt, context_excerpt, parent_job_id, width, height, steps, seed)
     VALUES ($1, $2, $3, $4, $5, 'preparing', $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      input.userId,
      input.chatId,
      input.userMessageId,
      input.clientRequestId,
      input.kind,
      input.prompt,
      input.contextExcerpt ?? null,
      input.parentJobId ?? null,
      input.width,
      input.height,
      input.steps,
      input.seed,
    ],
  );
  return imageJobFromRow(result.rows[0] as DbRow);
}

export async function userOwnsChat(chatId: string, userId: string): Promise<boolean> {
  const result = await query(
    "SELECT 1 FROM chats WHERE id = $1 AND user_id = $2 LIMIT 1",
    [chatId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function createPlaceholderMessage(
  chatId: string,
  content: string,
): Promise<number> {
  return withTransaction(async (client: PoolClient) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO messages (chat_id, role, content)
       VALUES ($1, 'assistant', $2)
       RETURNING id`,
      [chatId, content],
    );
    await client.query("UPDATE chats SET updated_at = NOW() WHERE id = $1", [chatId]);
    return numberValue(inserted.rows[0]?.id);
  });
}

export async function findJobByClientRequest(
  userId: string,
  clientRequestId: string,
): Promise<ImageJobRow | null> {
  const result = await query(
    "SELECT * FROM image_jobs WHERE user_id = $1 AND client_request_id = $2 LIMIT 1",
    [userId, clientRequestId],
  );
  const row = result.rows[0] as DbRow | undefined;
  return row ? imageJobFromRow(row) : null;
}

export async function createImageAttachment(input: {
  messageId: number | null;
  uploadedBy: string;
  bucket: string;
  objectKey: string;
  originalFilename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  checksumSha256: string;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO attachments
       (message_id, uploaded_by, storage_provider, bucket, object_key,
        original_filename, mime_type, extension, size_bytes, checksum_sha256,
        status, metadata)
     VALUES ($1, $2, 'minio', $3, $4, $5, $6, $7, $8, $9, 'ready', $10::jsonb)
     RETURNING id`,
    [
      input.messageId,
      input.uploadedBy,
      input.bucket,
      input.objectKey,
      input.originalFilename,
      input.mimeType,
      input.extension,
      input.sizeBytes,
      input.checksumSha256,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return textValue(result.rows[0]?.id);
}

export async function addJobReference(input: {
  jobId: string;
  attachmentId: string;
  sortOrder: number;
  role?: "attachment" | "parent";
}): Promise<void> {
  await query(
    `INSERT INTO image_job_references (job_id, attachment_id, sort_order, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (job_id, attachment_id) DO NOTHING`,
    [input.jobId, input.attachmentId, input.sortOrder, input.role ?? "attachment"],
  );
}

export async function setJobQueued(jobId: string): Promise<void> {
  await query(
    `UPDATE image_jobs
        SET status = 'queued', available_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'preparing'`,
    [jobId],
  );
}

export async function setJobAssistantMessage(jobId: string, messageId: number): Promise<void> {
  await query(
    "UPDATE image_jobs SET assistant_message_id = $2, updated_at = NOW() WHERE id = $1",
    [jobId, messageId],
  );
}

export async function getJobById(jobId: string): Promise<ImageJobRow | null> {
  const result = await query("SELECT * FROM image_jobs WHERE id = $1 LIMIT 1", [jobId]);
  const row = result.rows[0] as DbRow | undefined;
  return row ? imageJobFromRow(row) : null;
}

export async function getJobForUser(
  jobId: string,
  userId: string,
): Promise<ImageJobRow | null> {
  const result = await query(
    "SELECT * FROM image_jobs WHERE id = $1 AND user_id = $2 LIMIT 1",
    [jobId, userId],
  );
  const row = result.rows[0] as DbRow | undefined;
  return row ? imageJobFromRow(row) : null;
}

export async function getImageForJob(jobId: string): Promise<GeneratedImageMeta | null> {
  const result = await query(
    `SELECT gi.*, a.original_filename AS filename, a.mime_type, a.size_bytes,
            gi.id AS image_id, gi.attachment_id
       FROM generated_images gi
       JOIN attachments a ON a.id = gi.attachment_id
      WHERE gi.job_id = $1
      LIMIT 1`,
    [jobId],
  );
  const row = result.rows[0] as ImageWithAttachmentRow | undefined;
  if (!row) return null;
  return generatedImageMetaFromRow(
    row,
    textValue(row.job_id),
    textValue(row.chat_id),
  );
}

export async function getJobWithImageForUser(
  jobId: string,
  userId: string,
): Promise<{ job: ImageJobRow; image: GeneratedImageMeta | null } | null> {
  const job = await getJobForUser(jobId, userId);
  if (!job) return null;
  return { job, image: await getImageForJob(job.id) };
}

export async function getJobReferences(jobId: string): Promise<ImageReferenceRow[]> {
  const result = await query(
    `SELECT r.id, r.job_id, r.attachment_id, r.sort_order, r.role, r.created_at,
            a.object_key, a.bucket, a.original_filename, a.mime_type, a.size_bytes,
            a.metadata
       FROM image_job_references r
       JOIN attachments a ON a.id = r.attachment_id
      WHERE r.job_id = $1
      ORDER BY r.sort_order ASC`,
    [jobId],
  );
  return (result.rows as DbRow[]).map((row) => {
    const metadata = parseJson(row.metadata);
    const meta =
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      id: textValue(row.id),
      job_id: textValue(row.job_id),
      attachment_id: textValue(row.attachment_id),
      sort_order: numberValue(row.sort_order),
      role: textValue(row.role, "attachment"),
      original_filename: textValue(row.original_filename),
      mime_type: textValue(row.mime_type, "image/png"),
      size_bytes: numberValue(row.size_bytes),
      width: numberValue(meta.width, 1024),
      height: numberValue(meta.height, 1024),
      object_key: textValue(row.object_key),
      bucket: textValue(row.bucket),
      created_at: textValue(row.created_at),
    };
  });
}

export async function countActiveJobs(userId: string, chatId: string): Promise<{
  user: number;
  chat: number;
}> {
  const result = await query(
    `SELECT
       COUNT(*) FILTER (WHERE user_id = $1)::int AS user_count,
       COUNT(*) FILTER (WHERE chat_id = $2)::int AS chat_count
     FROM image_jobs
     WHERE status IN ('preparing', 'queued', 'generating', 'saving')
       AND created_at > NOW() - INTERVAL '1 day'`,
    [userId, chatId],
  );
  const row = result.rows[0] as DbRow | undefined;
  return { user: numberValue(row?.user_count), chat: numberValue(row?.chat_count) };
}

export async function countRecentJobs(userId: string, windowMs: number): Promise<number> {
  const result = await query(
    `SELECT COUNT(*)::int AS count
       FROM image_jobs
      WHERE user_id = $1
        AND created_at > NOW() - ($2::int * INTERVAL '1 millisecond')`,
    [userId, windowMs],
  );
  return numberValue((result.rows[0] as DbRow | undefined)?.count);
}

export async function getJobsForChat(
  chatId: string,
  userId: string,
  onlyActive = false,
): Promise<ImageJobRow[]> {
  const result = await query(
    `SELECT * FROM image_jobs
      WHERE chat_id = $1 AND user_id = $2
        ${onlyActive ? "AND status IN ('preparing', 'queued', 'generating', 'saving')" : ""}
      ORDER BY created_at DESC`,
    [chatId, userId],
  );
  return (result.rows as DbRow[]).map(imageJobFromRow);
}

/**
 * Adjunta trabajos e imágenes generadas a los mensajes del historial.
 *
 * Se resuelve con dos consultas para no hacer N+1 al cargar un chat. Si una
 * imagen ya está lista, también se adjunta al trabajo para que la tarjeta
 * pueda mostrar progreso y resultado con el mismo objeto.
 */
export async function attachImageGeneration(messages: Msg[]): Promise<Msg[]> {
  const ids = messages
    .map((message) => message.id)
    .filter((id): id is number => typeof id === "number" && Number.isFinite(id));
  if (ids.length === 0) return messages;

  const jobsResult = await query(
    `SELECT * FROM image_jobs
      WHERE assistant_message_id = ANY($1::bigint[])
      ORDER BY created_at DESC`,
    [ids],
  );
  const jobs = (jobsResult.rows as DbRow[]).map(imageJobFromRow);
  if (jobs.length === 0) return messages;

  const imagesResult = await query(
    `SELECT gi.*, a.original_filename AS filename, a.mime_type, a.size_bytes,
            gi.id AS image_id, gi.attachment_id
       FROM generated_images gi
       JOIN attachments a ON a.id = gi.attachment_id
      WHERE gi.message_id = ANY($1::bigint[])
      ORDER BY gi.created_at DESC`,
    [ids],
  );
  const images = (imagesResult.rows as ImageWithAttachmentRow[]).map((row) =>
    generatedImageMetaFromRow(
      row,
      textValue(row.job_id),
      textValue(row.chat_id),
    ),
  );

  const jobByMessage = new Map<number, ImageJobRow>();
  for (const job of jobs) {
    if (job.assistant_message_id !== null && !jobByMessage.has(job.assistant_message_id)) {
      jobByMessage.set(job.assistant_message_id, job);
    }
  }
  const imageByJob = new Map<string, GeneratedImageMeta[]>();
  const imagesByMessage = new Map<number, GeneratedImageMeta[]>();
  for (const image of images) {
    const list = imageByJob.get(image.jobId) ?? [];
    list.push(image);
    imageByJob.set(image.jobId, list);
    if (image.messageId !== undefined) {
      const messageList = imagesByMessage.get(image.messageId) ?? [];
      messageList.push(image);
      imagesByMessage.set(image.messageId, messageList);
    }
  }

  for (const message of messages) {
    if (message.id === undefined) continue;
    const job = jobByMessage.get(message.id);
    if (job) {
      message.imageJob = toImageJobMeta(job, imageByJob.get(job.id)?.[0]);
    }
    const list = imagesByMessage.get(message.id);
    if (list && list.length > 0) message.generatedImages = list;
  }
  return messages;
}

type ClaimedJob = ImageJobRow & { references: ImageReferenceRow[] };

export async function claimNextJob(workerId: string): Promise<ClaimedJob | null> {
  return withTransaction(async (client: PoolClient) => {
    const result = await client.query(
      `SELECT * FROM image_jobs
        WHERE status = 'queued'
          AND cancel_requested = FALSE
          AND available_at <= NOW()
          AND attempts < max_attempts
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1`,
    );
    const row = result.rows[0] as DbRow | undefined;
    if (!row) return null;

    const updated = await client.query(
      `UPDATE image_jobs
          SET status = 'generating',
              worker_id = $2,
              attempts = attempts + 1,
              started_at = COALESCE(started_at, NOW()),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [textValue(row.id), workerId],
    );
    const job = imageJobFromRow(updated.rows[0] as DbRow);
    const refs = await client.query(
      `SELECT r.id, r.job_id, r.attachment_id, r.sort_order, r.role, r.created_at,
              a.object_key, a.bucket, a.original_filename, a.mime_type, a.size_bytes,
              a.metadata
         FROM image_job_references r
         JOIN attachments a ON a.id = r.attachment_id
        WHERE r.job_id = $1
        ORDER BY r.sort_order ASC`,
      [job.id],
    );
    const references = (refs.rows as DbRow[]).map((ref) => {
      const metadata = parseJson(ref.metadata);
      const meta =
        metadata && typeof metadata === "object" && !Array.isArray(metadata)
          ? (metadata as Record<string, unknown>)
          : {};
      return {
        id: textValue(ref.id),
        job_id: textValue(ref.job_id),
        attachment_id: textValue(ref.attachment_id),
        sort_order: numberValue(ref.sort_order),
        role: textValue(ref.role, "attachment"),
        original_filename: textValue(ref.original_filename),
        mime_type: textValue(ref.mime_type, "image/png"),
        size_bytes: numberValue(ref.size_bytes),
        width: numberValue(meta.width, 1024),
        height: numberValue(meta.height, 1024),
        object_key: textValue(ref.object_key),
        bucket: textValue(ref.bucket),
        created_at: textValue(ref.created_at),
      };
    });
    return { ...job, references };
  });
}

export async function setComfyPromptId(jobId: string, promptId: string): Promise<void> {
  await query(
    `UPDATE image_jobs
        SET comfy_prompt_id = $2, status = 'generating', updated_at = NOW()
      WHERE id = $1`,
    [jobId, promptId],
  );
}

export async function setJobSaving(jobId: string): Promise<void> {
  await query(
    `UPDATE image_jobs
        SET status = 'saving', updated_at = NOW()
      WHERE id = $1 AND status = 'generating'`,
    [jobId],
  );
}

export type CompleteImageJobInput = {
  jobId: string;
  userId: string;
  chatId: string;
  messageId: number | null;
  bucket: string;
  objectKey: string;
  filename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  checksumSha256: string;
  width: number;
  height: number;
  prompt: string;
  effectivePrompt: string;
  seed: number | null;
  parentImageId?: string | null;
  assistantText: string;
  metadata?: Record<string, unknown>;
};

export async function completeImageJob(
  input: CompleteImageJobInput,
): Promise<{ image: GeneratedImageMeta; job: ImageJobRow }> {
  return withTransaction(async (client: PoolClient) => {
    const attachment = await client.query<{ id: string }>(
      `INSERT INTO attachments
         (message_id, uploaded_by, storage_provider, bucket, object_key,
          original_filename, mime_type, extension, size_bytes, checksum_sha256,
          status, metadata)
       VALUES ($1, $2, 'minio', $3, $4, $5, $6, $7, $8, $9, 'ready', $10::jsonb)
       RETURNING id`,
      [
        input.messageId,
        input.userId,
        input.bucket,
        input.objectKey,
        input.filename,
        input.mimeType,
        input.extension,
        input.sizeBytes,
        input.checksumSha256,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    const attachmentId = textValue(attachment.rows[0]?.id);

    const imageResult = await client.query(
      `INSERT INTO generated_images
         (user_id, chat_id, message_id, job_id, attachment_id, width, height,
          prompt, effective_prompt, seed, parent_image_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
       RETURNING *`,
      [
        input.userId,
        input.chatId,
        input.messageId,
        input.jobId,
        attachmentId,
        input.width,
        input.height,
        input.prompt,
        input.effectivePrompt,
        input.seed,
        input.parentImageId ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );

    const jobResult = await client.query(
      `UPDATE image_jobs
          SET status = 'completed',
              error_code = NULL,
              error_message = NULL,
              cancel_requested = FALSE,
              finished_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [input.jobId],
    );

    if (input.messageId !== null) {
      await client.query(
        `UPDATE messages
            SET content = CASE WHEN content = '' THEN $2 ELSE $2 END
          WHERE id = $1`,
        [input.messageId, input.assistantText],
      );
    }
    await client.query("UPDATE chats SET updated_at = NOW() WHERE id = $1", [input.chatId]);

    const imageRow = imageResult.rows[0] as DbRow;
    const joined: ImageWithAttachmentRow = {
      ...imageRow,
      image_id: textValue(imageRow.id),
      attachment_id: attachmentId,
      filename: input.filename,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
    };
    return {
      image: generatedImageMetaFromRow(joined, input.jobId, input.chatId),
      job: imageJobFromRow(jobResult.rows[0] as DbRow),
    };
  });
}

async function updateAssistantMessage(
  messageId: number | null,
  content: string,
): Promise<void> {
  if (messageId === null) return;
  await query("UPDATE messages SET content = $2 WHERE id = $1", [messageId, content]);
}

export async function updateAssistantMessageContent(
  messageId: number,
  content: string,
): Promise<void> {
  await updateAssistantMessage(messageId, content);
}

export async function failImageJob(
  jobId: string,
  code: string,
  message: string,
  assistantText: string,
): Promise<void> {
  const result = await query(
    `UPDATE image_jobs
        SET status = CASE WHEN status = 'cancelled' THEN status ELSE 'failed' END,
            error_code = $2,
            error_message = $3,
            finished_at = COALESCE(finished_at, NOW()),
            cancel_requested = FALSE,
            updated_at = NOW()
      WHERE id = $1
      RETURNING assistant_message_id`,
    [jobId, code, message],
  );
  const messageId = nullableNumber((result.rows[0] as DbRow | undefined)?.assistant_message_id);
  await updateAssistantMessage(messageId, assistantText);
}

export async function finishCancelledJob(jobId: string): Promise<void> {
  const result = await query(
    `UPDATE image_jobs
        SET status = 'cancelled',
            error_code = NULL,
            error_message = NULL,
            cancel_requested = FALSE,
            finished_at = NOW(),
            updated_at = NOW()
      WHERE id = $1 AND status NOT IN ('completed', 'failed')
      RETURNING assistant_message_id`,
    [jobId],
  );
  const messageId = nullableNumber((result.rows[0] as DbRow | undefined)?.assistant_message_id);
  await updateAssistantMessage(messageId, "Generación de imagen cancelada.");
}

/**
 * Cancela de inmediato si el trabajo todavía no llegó a ComfyUI. Si ya se
 * envió, solo marca la bandera: el worker hace la cancelación dirigida y no
 * interrumpe otros trabajos del mismo ComfyUI.
 */
export async function requestJobCancellation(
  jobId: string,
  userId: string,
): Promise<ImageJobRow | null> {
  return withTransaction(async (client: PoolClient) => {
    const found = await client.query(
      `SELECT * FROM image_jobs WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [jobId, userId],
    );
    const row = found.rows[0] as DbRow | undefined;
    if (!row) return null;
    const job = imageJobFromRow(row);
    if (["completed", "failed", "cancelled"].includes(job.status)) return job;

    if (!job.comfy_prompt_id && (job.status === "preparing" || job.status === "queued")) {
      const updated = await client.query(
        `UPDATE image_jobs
            SET status = 'cancelled', cancel_requested = FALSE,
                finished_at = NOW(), updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [jobId],
      );
      await client.query(
        "UPDATE messages SET content = $2 WHERE id = $1",
        [job.assistant_message_id, "Generación de imagen cancelada."],
      );
      return imageJobFromRow(updated.rows[0] as DbRow);
    }

    const updated = await client.query(
      `UPDATE image_jobs
          SET cancel_requested = TRUE, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [jobId],
    );
    return imageJobFromRow(updated.rows[0] as DbRow);
  });
}

/** Reasigna un trabajo cuyo worker murió, solo después de consultar ComfyUI. */
/**
 * Reintenta un trabajo que falló antes de ser aceptado por ComfyUI. No se usa
 * para timeouts ni errores de ejecución, donde el prompt pudo quedar vivo.
 */
export async function rescheduleJobBeforeSubmit(
  jobId: string,
  code: string,
  message: string,
  delayMs: number,
): Promise<boolean> {
  const result = await query(
    `UPDATE image_jobs
        SET status = 'queued', worker_id = NULL, comfy_prompt_id = NULL,
            error_code = $2, error_message = $3,
            available_at = NOW() + ($4::int * INTERVAL '1 millisecond'),
            updated_at = NOW()
      WHERE id = $1
        AND status = 'generating'
        AND attempts < max_attempts
      RETURNING id`,
    [jobId, code, message, delayMs],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function reserveOrphanForInspection(
  jobId: string,
  workerId: string,
): Promise<ImageJobRow | null> {
  const result = await query(
    `UPDATE image_jobs
        SET worker_id = $2, updated_at = NOW()
      WHERE id = $1 AND status IN ('generating', 'saving')
      RETURNING *`,
    [jobId, workerId],
  );
  const row = result.rows[0] as DbRow | undefined;
  return row ? imageJobFromRow(row) : null;
}

export async function listOrphanedJobs(
  staleMs: number,
  limit = 20,
): Promise<ImageJobRow[]> {
  const result = await query(
    `SELECT j.*
       FROM image_jobs j
       LEFT JOIN image_workers w ON w.worker_id = j.worker_id
      WHERE j.status IN ('generating', 'saving')
        AND (j.worker_id IS NULL
             OR w.worker_id IS NULL
             OR w.heartbeat_at < NOW() - ($1::int * INTERVAL '1 millisecond'))
      ORDER BY j.updated_at ASC
      LIMIT $2`,
    [staleMs, limit],
  );
  return (result.rows as DbRow[]).map(imageJobFromRow);
}

export async function failStalePreparingJobs(staleMs: number): Promise<number> {
  const result = await query(
    `WITH failed AS (
       UPDATE image_jobs
          SET status = 'failed',
              error_code = 'stale_preparing',
              error_message = 'La preparación del trabajo no terminó.',
              finished_at = NOW(),
              updated_at = NOW()
        WHERE status = 'preparing'
          AND updated_at < NOW() - ($1::int * INTERVAL '1 millisecond')
        RETURNING assistant_message_id
     ),
     updated_messages AS (
       UPDATE messages
          SET content = 'No se pudo preparar la imagen. Inténtalo de nuevo.'
        WHERE id IN (
          SELECT assistant_message_id FROM failed
           WHERE assistant_message_id IS NOT NULL
        )
     )
     SELECT COUNT(*)::int AS count FROM failed`,
    [staleMs],
  );
  return numberValue((result.rows[0] as DbRow | undefined)?.count);
}

export async function getGeneratedImageForUser(
  imageId: string,
  userId: string,
): Promise<{
  image: GeneratedImageRow;
  attachment: {
    bucket: string;
    object_key: string;
    original_filename: string;
    mime_type: string;
    size_bytes: number;
  };
} | null> {
  const result = await query(
    `SELECT gi.*, a.bucket, a.object_key, a.original_filename, a.mime_type, a.size_bytes
       FROM generated_images gi
       JOIN attachments a ON a.id = gi.attachment_id
      WHERE gi.id = $1 AND gi.user_id = $2
      LIMIT 1`,
    [imageId, userId],
  );
  const row = result.rows[0] as DbRow | undefined;
  if (!row) return null;
  return {
    image: generatedImageFromRow(row),
    attachment: {
      bucket: textValue(row.bucket),
      object_key: textValue(row.object_key),
      original_filename: textValue(row.original_filename),
      mime_type: textValue(row.mime_type, "image/png"),
      size_bytes: numberValue(row.size_bytes),
    },
  };
}

export async function getGeneratedImageById(imageId: string): Promise<{
  image: GeneratedImageRow;
  bucket: string;
  object_key: string;
  original_filename: string;
  mime_type: string;
  user_id: string;
} | null> {
  const result = await query(
    `SELECT gi.*, a.bucket, a.object_key, a.original_filename, a.mime_type
       FROM generated_images gi
       JOIN attachments a ON a.id = gi.attachment_id
      WHERE gi.id = $1
      LIMIT 1`,
    [imageId],
  );
  const row = result.rows[0] as DbRow | undefined;
  if (!row) return null;
  return {
    image: generatedImageFromRow(row),
    bucket: textValue(row.bucket),
    object_key: textValue(row.object_key),
    original_filename: textValue(row.original_filename),
    mime_type: textValue(row.mime_type, "image/png"),
    user_id: textValue(row.user_id),
  };
}

/** Imagen generada más reciente del chat, para resolver «hazla más grande». */
export async function getLatestGeneratedImageForChat(
  chatId: string,
  userId: string,
): Promise<{ image: GeneratedImageRow; job: ImageJobRow } | null> {
  const result = await query(
    `SELECT gi.*, j.*, gi.id AS image_id, gi.created_at AS image_created_at
       FROM generated_images gi
       JOIN image_jobs j ON j.id = gi.job_id
      WHERE gi.chat_id = $1 AND gi.user_id = $2
      ORDER BY gi.created_at DESC
      LIMIT 1`,
    [chatId, userId],
  );
  const row = result.rows[0] as DbRow | undefined;
  if (!row) return null;
  const imageRow = { ...row, id: row.image_id, created_at: row.image_created_at };
  return {
    image: generatedImageFromRow(imageRow),
    job: imageJobFromRow(row),
  };
}

export async function getGeneratedImageAssetForChat(
  imageId: string,
  chatId: string,
  userId: string,
): Promise<{
  imageId: string;
  jobId: string;
  attachmentId: string;
  bucket: string;
  objectKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  seed: number | null;
  prompt: string;
  parentImageId: string | null;
  checksumSha256: string | null;
} | null> {
  const result = await query(
    `SELECT gi.id, gi.job_id, gi.attachment_id, gi.width, gi.height, gi.seed,
            gi.prompt, gi.parent_image_id, a.bucket, a.object_key,
            a.original_filename, a.mime_type, a.size_bytes, a.checksum_sha256
       FROM generated_images gi
       JOIN attachments a ON a.id = gi.attachment_id
      WHERE gi.id = $1 AND gi.chat_id = $2 AND gi.user_id = $3
      LIMIT 1`,
    [imageId, chatId, userId],
  );
  const row = result.rows[0] as DbRow | undefined;
  if (!row) return null;
  return {
    imageId: textValue(row.id),
    jobId: textValue(row.job_id),
    attachmentId: textValue(row.attachment_id),
    bucket: textValue(row.bucket),
    objectKey: textValue(row.object_key),
    filename: textValue(row.original_filename),
    mimeType: textValue(row.mime_type, "image/png"),
    sizeBytes: numberValue(row.size_bytes),
    width: numberValue(row.width, 1024),
    height: numberValue(row.height, 1024),
    seed: nullableNumber(row.seed),
    prompt: textValue(row.prompt),
    parentImageId: nullableText(row.parent_image_id),
    checksumSha256: nullableText(row.checksum_sha256),
  };
}

export async function updateJobEffectivePrompt(
  jobId: string,
  effectivePrompt: string,
): Promise<void> {
  await query(
    "UPDATE image_jobs SET effective_prompt = $2, updated_at = NOW() WHERE id = $1",
    [jobId, effectivePrompt],
  );
}

/**
 * Repara el caso en que el worker alcanzó a guardar la imagen pero murió antes
 * de marcar el trabajo como completado. No vuelve a llamar a ComfyUI.
 */
export async function finishJobFromExistingImage(
  jobId: string,
  assistantText: string,
): Promise<boolean> {
  return withTransaction(async (client: PoolClient) => {
    const image = await client.query(
      "SELECT message_id, chat_id FROM generated_images WHERE job_id = $1 LIMIT 1",
      [jobId],
    );
    const row = image.rows[0] as DbRow | undefined;
    if (!row) return false;
    await client.query(
      `UPDATE image_jobs
          SET status = 'completed', error_code = NULL, error_message = NULL,
              cancel_requested = FALSE, finished_at = COALESCE(finished_at, NOW()),
              updated_at = NOW()
        WHERE id = $1 AND status <> 'completed'`,
      [jobId],
    );
    if (row.message_id !== null && row.message_id !== undefined) {
      await client.query("UPDATE messages SET content = $2 WHERE id = $1", [
        row.message_id,
        assistantText,
      ]);
    }
    await client.query("UPDATE chats SET updated_at = NOW() WHERE id = $1", [
      textValue(row.chat_id),
    ]);
    return true;
  });
}

export async function getGeneratedImageForChatById(
  imageId: string,
  chatId: string,
  userId: string,
): Promise<{ image: GeneratedImageRow; job: ImageJobRow } | null> {
  const result = await query(
    `SELECT gi.*, gi.id AS image_id, j.*, gi.created_at AS image_created_at
       FROM generated_images gi
       JOIN image_jobs j ON j.id = gi.job_id
      WHERE gi.id = $1 AND gi.chat_id = $2 AND gi.user_id = $3
      LIMIT 1`,
    [imageId, chatId, userId],
  );
  const row = result.rows[0] as DbRow | undefined;
  if (!row) return null;
  const imageRow = { ...row, id: row.image_id, created_at: row.image_created_at };
  return {
    image: generatedImageFromRow(imageRow),
    job: imageJobFromRow(row),
  };
}

export async function registerWorker(input: {
  workerId: string;
  hostname: string;
  pid: number;
  concurrency: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await query(
    `INSERT INTO image_workers
       (worker_id, hostname, pid, concurrency, status, metadata)
     VALUES ($1, $2, $3, $4, 'starting', $5::jsonb)
     ON CONFLICT (worker_id) DO UPDATE
       SET hostname = EXCLUDED.hostname,
           pid = EXCLUDED.pid,
           concurrency = EXCLUDED.concurrency,
           status = 'starting',
           started_at = NOW(),
           heartbeat_at = NOW(),
           metadata = EXCLUDED.metadata`,
    [
      input.workerId,
      input.hostname,
      input.pid,
      input.concurrency,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export async function heartbeatWorker(input: {
  workerId: string;
  status: "idle" | "busy" | "stopping" | "error";
  currentJobId?: string | null;
}): Promise<void> {
  await query(
    `UPDATE image_workers
        SET status = $2, current_job_id = $3, heartbeat_at = NOW()
      WHERE worker_id = $1`,
    [input.workerId, input.status, input.currentJobId ?? null],
  );
}

export async function unregisterWorker(workerId: string): Promise<void> {
  await query(
    `UPDATE image_workers
        SET status = 'stopped', current_job_id = NULL, heartbeat_at = NOW()
      WHERE worker_id = $1`,
    [workerId],
  );
}

export async function listImageWorkers(): Promise<
  Array<{
    worker_id: string;
    hostname: string;
    pid: number;
    concurrency: number;
    status: string;
    current_job_id: string | null;
    started_at: string;
    heartbeat_at: string;
    stale: boolean;
  }>
> {
  const result = await query(
    `SELECT *, heartbeat_at < NOW() - INTERVAL '60 seconds' AS stale
       FROM image_workers
      ORDER BY heartbeat_at DESC
      LIMIT 50`,
  );
  return (result.rows as DbRow[]).map((row) => ({
    worker_id: textValue(row.worker_id),
    hostname: textValue(row.hostname),
    pid: numberValue(row.pid),
    concurrency: numberValue(row.concurrency, 1),
    status: textValue(row.status),
    current_job_id: nullableText(row.current_job_id),
    started_at: textValue(row.started_at),
    heartbeat_at: textValue(row.heartbeat_at),
    stale: booleanValue(row.stale),
  }));
}

export function newRequestId(): string {
  return randomUUID();
}

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Integración real de PostgreSQL + MinIO + worker mock.
 *
 * No usa la base de desarrollo por accidente: exige `IMAGE_TEST_DATABASE_URL`
 * (una base desechable con las migraciones aplicadas). El backend de imágenes
 * se fuerza a `mock`, así que no hace falta GPU.
 */

const testDatabaseUrl = process.env.IMAGE_TEST_DATABASE_URL || "";
const testBucket = process.env.IMAGE_TEST_BUCKET || "";

function loadEnvironment(): void {
  const filePath = resolve(process.cwd(), ".env");
  if (existsSync(filePath)) process.loadEnvFile(filePath);
}

loadEnvironment();
if (testDatabaseUrl) process.env.DATABASE_URL = testDatabaseUrl;
if (testBucket) process.env.MINIO_BUCKET = testBucket;
process.env.IMAGE_BACKEND = "mock";
process.env.IMAGE_MOCK_DELAY_MS = "5";
process.env.IMAGE_PROMPT_REFINE = "false";
process.env.IMAGE_INTENT_USE_OLLAMA = "false";
process.env.IMAGE_RATE_LIMIT_PER_MINUTE = "100";

const canRun = Boolean(
  testDatabaseUrl &&
    testBucket &&
    process.env.DATABASE_URL &&
    process.env.MINIO_ACCESS_KEY &&
    process.env.MINIO_SECRET_KEY,
);

async function waitFor<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await read();
    if (done(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Tiempo agotado esperando al worker. Último valor: ${JSON.stringify(last)}`);
}

describe(
  "pipeline de imágenes contra PostgreSQL y MinIO",
  { skip: canRun ? false : "define IMAGE_TEST_DATABASE_URL, IMAGE_TEST_BUCKET y credenciales MinIO" },
  () => {
    const suffix = randomUUID();
    const workerPrefix = `test-${suffix}`;
    let query: typeof import("../lib/db-connection.js").query;
    let getPool: typeof import("../lib/db-connection.js").getPool;
    let db: typeof import("../lib/db.js");
    let repository: typeof import("../lib/images/repository.js");
    let service: typeof import("../lib/images/service.js");
    let storage: typeof import("../lib/storage.js");
    let workerModule: typeof import("../lib/images/worker.js");
    let mockModule: typeof import("../lib/images/mock.js");
    let userId = "";
    let otherUserId = "";
    let chatId = "";
    let firstJobId = "";
    let firstImageId = "";
    let cancelledJobId = "";
    let recoveredJobId = "";

    const start = async (
      label: string,
      clientRequestId = `${suffix}-${label.replace(/[^A-Za-z0-9._:-]/g, "-")}`,
      addUserMessage = true,
    ) => {
      return service.startImageJob({
        userId,
        chatId,
        userMessageId: addUserMessage
          ? await db.addMessage(chatId, "user", label)
          : null,
        message: label,
        intent: {
          action: "generate",
          prompt: label,
          confidence: 1,
          reason: "test",
          source: "rules",
          width: 256,
          height: 192,
          dimensionsExplicit: true,
        },
        clientRequestId,
        width: 256,
        height: 192,
        history: [{ role: "user", text: label }],
      });
    };

    before(async () => {
      const connection = await import("../lib/db-connection.js");
      query = connection.query;
      getPool = connection.getPool;
      db = await import("../lib/db.js");
      repository = await import("../lib/images/repository.js");
      service = await import("../lib/images/service.js");
      storage = await import("../lib/storage.js");
      workerModule = await import("../lib/images/worker.js");
      mockModule = await import("../lib/images/mock.js");
      await storage.ensureBucket();

      const tables = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN ('image_jobs', 'generated_images', 'image_job_references', 'image_workers')`,
      );
      assert.equal(
        Number(tables.rows[0]?.count),
        4,
        "aplica las migraciones a la base de prueba (npm run db:migrate)",
      );

      const user = await query<{ id: string }>(
        `INSERT INTO users (email, name, role) VALUES ($1, $2, 'user') RETURNING id`,
        [`image-test-${suffix}@example.invalid`, "Image Test"],
      );
      userId = user.rows[0].id;
      chatId = randomUUID();
      await db.createChat(chatId, userId, "Prueba de imágenes");

      const other = await query<{ id: string }>(
        `INSERT INTO users (email, name, role) VALUES ($1, $2, 'user') RETURNING id`,
        [`image-test-other-${suffix}@example.invalid`, "Other User"],
      );
      otherUserId = other.rows[0].id;
    });

    after(async () => {
      if (!query || !userId) return;
      const objects = await query<{ bucket: string; object_key: string }>(
        `SELECT DISTINCT a.bucket, a.object_key
           FROM attachments a
           LEFT JOIN messages m ON m.id = a.message_id
          WHERE a.uploaded_by = ANY($2::uuid[]) OR m.chat_id = $1`,
        [chatId, [userId, otherUserId].filter(Boolean)],
      ).catch(() => ({ rows: [] as Array<{ bucket: string; object_key: string }> }));
      for (const object of objects.rows) {
        await storage?.deleteObject(object.object_key).catch(() => undefined);
      }
      await query("DELETE FROM attachments WHERE uploaded_by = ANY($1::uuid[])", [
        [userId, otherUserId].filter(Boolean),
      ]).catch(() => undefined);
      await query("DELETE FROM image_workers WHERE worker_id LIKE $1", [
        `${workerPrefix}%`,
      ]).catch(() => undefined);
      await query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
        [userId, otherUserId].filter(Boolean),
      ]).catch(() => undefined);
      await getPool?.().end().catch(() => undefined);
    });

    it("crea, deduplica, procesa y persiste una imagen", async () => {
      const requestId = `${suffix}-gato-azul`;
      const started = await start("un gato azul", requestId);
      firstJobId = started.job.id;
      assert.equal(started.job.status, "queued");
      assert.equal(started.duplicate, false);
      assert.ok(started.assistantMessageId > 0);

      const repeated = await start("un gato azul", requestId, false);
      assert.equal(repeated.duplicate, true);
      assert.equal(repeated.job.id, firstJobId);

      const counts = await query<{ jobs: string; messages: string }>(
        `SELECT (SELECT COUNT(*) FROM image_jobs WHERE chat_id = $1)::text AS jobs,
                (SELECT COUNT(*) FROM messages WHERE chat_id = $1)::text AS messages`,
        [chatId],
      );
      assert.equal(Number(counts.rows[0].jobs), 1);
      assert.equal(Number(counts.rows[0].messages), 2);

      const controller = new AbortController();
      const worker = new workerModule.ImageWorker({
        backend: new mockModule.MockImageBackend(),
        workerId: `${workerPrefix}-pipeline`,
        concurrency: 1,
        pollMs: 50,
        heartbeatMs: 100,
        staleMs: 5_000,
        signal: controller.signal,
        logger: () => undefined,
      });
      const running = worker.run();
      try {
        const job = await waitFor(
          () => repository.getJobById(firstJobId),
          (value) => value?.status === "completed" || value?.status === "failed",
        );
        assert.equal(job?.status, "completed", job?.error_message || "sin detalle");
        assert.equal(job?.seed, 42);

        const image = await repository.getImageForJob(firstJobId);
        assert.ok(image);
        firstImageId = image.id;
        assert.equal(image.width, 256);
        assert.equal(image.height, 192);

        const asset = await repository.getGeneratedImageAssetForChat(
          image.id,
          chatId,
          userId,
        );
        assert.ok(asset);
        const buffer = await storage.getObject(asset.objectKey);
        assert.deepEqual(
          [...buffer.subarray(0, 8)],
          [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
        );

        const messages = await db.getMessagesByChat(chatId);
        const assistant = messages.find(
          (message) => message.id === started.assistantMessageId,
        );
        assert.equal(assistant?.imageJob?.status, "completed");
        assert.equal(assistant?.generatedImages?.[0]?.id, image.id);
        assert.match(assistant?.text || "", /Imagen generada/);
      } finally {
        controller.abort();
        await running;
      }
    });

    it("deduplica la referencia cuando la imagen padre llega también como adjunto", async () => {
      assert.ok(firstImageId && firstJobId);
      const asset = await repository.getGeneratedImageAssetForChat(
        firstImageId,
        chatId,
        userId,
      );
      assert.ok(asset);
      const buffer = await storage.getObject(asset.objectKey);

      const edit = await service.startImageJob({
        userId,
        chatId,
        userMessageId: await db.addMessage(chatId, "user", "cambia el fondo a azul"),
        message: "cambia el fondo a azul",
        intent: {
          action: "edit",
          prompt: "cambia el fondo a azul",
          confidence: 1,
          reason: "test",
          source: "rules",
        },
        referenceImages: [
          {
            data: buffer.toString("base64"),
            mime: asset.mimeType,
            filename: "la-misma.png",
          },
        ],
        parentImageId: firstImageId,
        clientRequestId: `${suffix}-dedupe-parent`,
        width: 256,
        height: 192,
      });

      const stored = await repository.getJobById(edit.job.id);
      assert.equal(stored?.kind, "edit");
      assert.equal(stored?.parent_job_id, firstJobId);
      const refs = await query<{ role: string }>(
        "SELECT role FROM image_job_references WHERE job_id = $1 ORDER BY sort_order",
        [edit.job.id],
      );
      assert.equal(refs.rows.length, 1, "el padre no debe enviarse dos veces");
      assert.equal(refs.rows[0].role, "attachment");
      await repository.requestJobCancellation(edit.job.id, userId);
    });

    it("cancela antes de que el worker lo reclame", async () => {
      const started = await start("un perro rojo");
      cancelledJobId = started.job.id;
      const cancelled = await repository.requestJobCancellation(
        cancelledJobId,
        userId,
      );
      assert.equal(cancelled?.status, "cancelled");
      const messages = await db.getMessagesByChat(chatId);
      const assistant = messages.find(
        (message) => message.id === started.assistantMessageId,
      );
      assert.match(assistant?.text || "", /cancelada/i);
    });

    it("no expone trabajos ni imágenes a otro usuario", async () => {
      assert.ok(firstJobId && firstImageId);
      assert.equal(
        await repository.getJobWithImageForUser(firstJobId, otherUserId),
        null,
      );
      assert.equal(
        await repository.requestJobCancellation(firstJobId, otherUserId),
        null,
      );
      assert.equal(
        await repository.getGeneratedImageAssetForChat(
          firstImageId,
          chatId,
          otherUserId,
        ),
        null,
      );
    });

    it("no reencola un prompt_id que ComfyUI ya no reporta", async () => {
      const started = await start("un faro violeta");
      const jobId = started.job.id;
      const deadWorker = `${workerPrefix}-dead-prompt`;
      await query(
        `INSERT INTO image_workers
           (worker_id, hostname, pid, concurrency, status, heartbeat_at)
         VALUES ($1, 'test', 1, 1, 'busy', NOW() - INTERVAL '1 hour')`,
        [deadWorker],
      );
      const claimed = await repository.claimNextJob(deadWorker);
      assert.equal(claimed?.id, jobId);
      await query(
        `UPDATE image_jobs SET comfy_prompt_id = 'prompt-perdido' WHERE id = $1`,
        [jobId],
      );

      const controller = new AbortController();
      const worker = new workerModule.ImageWorker({
        backend: new mockModule.LostPromptBackend(),
        workerId: `${workerPrefix}-lost`,
        concurrency: 1,
        pollMs: 50,
        heartbeatMs: 100,
        staleMs: 10,
        signal: controller.signal,
        logger: () => undefined,
      });
      const running = worker.run();
      try {
        const job = await waitFor(
          () => repository.getJobById(jobId),
          (value) => value?.status === "failed",
        );
        assert.equal(job?.error_code, "comfy_prompt_not_found");
        assert.equal(job?.attempts, 1);
      } finally {
        controller.abort();
        await running;
      }
    });

    it("falla sin reencolar si un worker murió antes de guardar prompt_id", async () => {
      const started = await start("un robot verde");
      recoveredJobId = started.job.id;

      const deadWorker = `${workerPrefix}-dead`;
      await query(
        `INSERT INTO image_workers
           (worker_id, hostname, pid, concurrency, status, heartbeat_at)
         VALUES ($1, 'test', 1, 1, 'busy', NOW() - INTERVAL '1 hour')`,
        [deadWorker],
      );
      const claimed = await repository.claimNextJob(deadWorker);
      assert.equal(claimed?.id, recoveredJobId);
      assert.equal(claimed?.comfy_prompt_id, null);

      const controller = new AbortController();
      const worker = new workerModule.ImageWorker({
        backend: new mockModule.MockImageBackend(),
        workerId: `${workerPrefix}-recovery`,
        concurrency: 1,
        pollMs: 50,
        heartbeatMs: 100,
        staleMs: 10,
        signal: controller.signal,
        logger: () => undefined,
      });
      const running = worker.run();
      try {
        const job = await waitFor(
          () => repository.getJobById(recoveredJobId),
          (value) => value?.status === "failed",
        );
        assert.equal(job?.error_code, "comfy_prompt_lost");
        assert.equal(job?.attempts, 1, "no debe reencolar ni reintentar a ciegas");
      } finally {
        controller.abort();
        await running;
      }
    });
  },
);

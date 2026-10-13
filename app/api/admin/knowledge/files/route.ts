export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import {
  requireCapability,
} from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { visibleKbFiles } from "@/lib/kb-access";
import {
  insertKbFile,
  updateKbFile,
  deleteKbChunksByFile,
  findKbFileByName,
  getKbCategoryBySlug,
  getConfig,
  logAudit,
  createAttachment,
  toKbFileSummary,
} from "@/lib/db";
import { extractText } from "@/lib/file-processor";
import { normalizeFileName } from "@/lib/kb";
import { log, childLogger } from "@/lib/logger";
import { getStorageConfig, objectKey, putObject } from "@/lib/storage";

const ALLOWED_EXTENSIONS = ["pdf", "docx", "xlsx", "xls", "txt", "md", "csv"];
const MIN_USEFUL_TEXT = 20;

type UploadResult = {
  name: string;
  status: "active" | "pending_review" | "hold" | "duplicate" | "invalid" | "error";
  message: string;
  fileId?: string;
  conflictWith?: string | null;
  chunkCount?: number;
};

export async function GET(req: Request) {
  const { allowed, status, user } = await requireCapability("kb.read");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { searchParams } = new URL(req.url);
  const categoryId = searchParams.get("categoryId") || undefined;
  const statusFilter = searchParams.get("status") || undefined;
  const search = searchParams.get("search") || undefined;

  // El listado pasa por la política de lectura y no por `getKbFiles`: para un
  // `editor` eso recorta a lo que tiene por grant o lo que él subió. Con la
  // consulta completa, el buscador devolvía coincidencias sobre `f.content`
  // de documentos ajenos y sin grant, y bastaba un 200 o un vacío para
  // confirmar si un texto estaba dentro. Era un oráculo de existencia de
  // contenido, no un buscador.
  const files = await visibleKbFiles(user, { categoryId, status: statusFilter, search });
  // Sin `content`: el listado es de metadatos. El texto se pide bajo demanda.
  return NextResponse.json({ files: files.map(toKbFileSummary) });
}

export async function POST(req: Request) {
  const { allowed, status, user } = await requireCapability("kb.upload");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const rateCheck = checkRateLimit(`kb-upload:${user.id}`);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Demasiadas subidas. Intenta de nuevo en unos segundos." },
      { status: 429, headers: rateCheck.headers }
    );
  }

  const reqLog = childLogger({ userId: user.id, scope: "kb-upload" });

  try {
    const form = await req.formData();
    const filesEntry = form.getAll("files") as File[];
    const categoryIdParam = (form.get("categoryId") as string) || null;
    const textEntry = form.get("textEntry") === "1";

    if (filesEntry.length === 0 && !textEntry) {
      return NextResponse.json({ error: "No se recibieron archivos" }, { status: 400 });
    }

    const maxSizeMb = parseInt((await getConfig("max_file_size_mb")) || "20", 10) || 20;

    // Categoría por defecto: general
    let categoryId = categoryIdParam;
    if (!categoryId) {
      const general = await getKbCategoryBySlug("general");
      categoryId = general?.id ?? null;
    }

    const results: UploadResult[] = [];

    // ─── Entrada manual (texto) — unificada como archivo format='text' ───
    if (textEntry) {
      const title = normalizeFileName((form.get("title") as string) || "");
      const content = (form.get("content") as string) || "";

      if (!title || content.trim().length < MIN_USEFUL_TEXT) {
        results.push({ name: title || "(sin título)", status: "invalid", message: "Título y contenido útil son requeridos" });
      } else {
        // Upsert: si existe una entrada de texto con el mismo título, reemplaza
        const existing = (await findKbFileByName(title)).find((f) => f.format === "text");
        if (existing) {
          // Una edición sobre algo ya publicado vuelve a la cola: el texto
          // anterior estuvo visible y este necesita su propia validación.
          await updateKbFile(existing.id, { content, category_id: categoryId, checksum: null, status: "pending_review" });
          await deleteKbChunksByFile(existing.id);
          results.push({
            name: title,
            status: "pending_review",
            message: "Entrada actualizada. Queda en revisión antes de volver a publicarse.",
            fileId: existing.id,
          });
        } else {
          const fileId = uuidv4();
          await insertKbFile({
            id: fileId,
            filename: title,
            format: "text",
            category_id: categoryId,
            status: "pending_review",
            content,
            checksum: null,
            uploaded_by: user.id,
          });
          results.push({
            name: title,
            status: "pending_review",
            message: "Entrada guardada. Queda en revisión antes de publicarse.",
            fileId,
          });
        }
        await logAudit(user.id, "kb.upload", `Entrada manual en revisión: "${title}"`, "");
      }
    }

    for (const file of filesEntry) {
      const name = normalizeFileName(file.name);
      const ext = name.split(".").pop()?.toLowerCase() || "";

      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        results.push({ name, status: "invalid", message: `Extensión .${ext} no permitida (PDF, DOCX, XLSX, XLS, TXT, MD, CSV)` });
        continue;
      }

      if (file.size > maxSizeMb * 1024 * 1024) {
        results.push({ name, status: "invalid", message: `El archivo excede el límite de ${maxSizeMb} MB` });
        continue;
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const checksum = createHash("sha256").update(buffer).digest("hex");

      // ─── Detección de duplicados / conflictos por nombre ───
      const existingByName = await findKbFileByName(name);
      const previous = existingByName.find((f) => f.status !== "hold") || existingByName[0];

      if (previous && previous.checksum === checksum) {
        results.push({ name, status: "duplicate", message: "Ya existe un archivo con el mismo nombre y contenido" });
        continue;
      }

      let content: string;
      try {
        content = await extractText(buffer, name);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        reqLog.warn({ filename: name }, `Error extrayendo texto: ${msg}`);
        results.push({ name, status: "error", message: `No se pudo procesar el archivo: ${msg}` });
        continue;
      }

      const fileId = uuidv4();
      const isConflict = !!previous;
      const lowContent = content.trim().length < MIN_USEFUL_TEXT;

      await insertKbFile({
        id: fileId,
        filename: name,
        format: ext,
        size_bytes: file.size,
        category_id: categoryId,
        status: "pending_review",
        conflict_with: isConflict ? previous.id : null,
        content,
        checksum,
        uploaded_by: user.id,
      });

      const key = objectKey("kb", name);
      try {
        await putObject(key, buffer, file.type || "application/octet-stream", { source: "knowledge-base" });
        await createAttachment({
          id: uuidv4(),
          kb_file_id: fileId,
          uploaded_by: user.id,
          bucket: getStorageConfig().bucket,
          object_key: key,
          original_filename: name,
          mime_type: file.type || "application/octet-stream",
          extension: ext,
          size_bytes: file.size,
          checksum_sha256: checksum,
          status: "ready",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await updateKbFile(fileId, { status: "hold" });
        results.push({ name, status: "error", message: `No se pudo guardar el archivo en MinIO: ${message}`, fileId });
        continue;
      }

      if (isConflict) {
        // Conflicto de nombre: HOLD sin indexar hasta resolución
        await updateKbFile(fileId, { status: "hold" });
        results.push({
          name,
          status: "hold",
          message: `Nombre duplicado con "${previous.filename}". En revisión — resuélvelo desde el panel.`,
          fileId,
          conflictWith: previous.id,
        });
        await logAudit(user.id, "kb.conflict", `Conflicto KB: "${name}" choca con "${previous.filename}"`, "");
        continue;
      }

      if (lowContent) {
        await updateKbFile(fileId, { status: "hold" });
        results.push({
          name,
          status: "hold",
          message: "No se pudo extraer texto útil del archivo. En revisión.",
          fileId,
        });
        await logAudit(user.id, "kb.hold", `Archivo en revisión (texto insuficiente): "${name}"`, "");
        continue;
      }

      // ─── Caso normal: queda pendiente de aprobación ───
      // No se indexa todavía. Indexar sin revisar significaría que un archivo sin
      // grants ya está vectorizado y a un solo grant de ser visible; aprobar
      // después sería un formality. El coste (embeddings) se paga al aprobar,
      // que es cuando el contenido ya se ha aceptado.
      results.push({
        name,
        status: "pending_review",
        message: "Archivo guardado. Queda en revisión: un administrador debe aprobarlo y conceder acceso.",
        fileId,
      });
      await logAudit(user.id, "kb.upload", `Archivo subido, pendiente de revisión: "${name}"`, "");
    }

    log.info({ userId: user.id, uploaded: results.length }, "Subida KB completada");
    return NextResponse.json({ results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    reqLog.error({ err: msg }, "Error en subida KB");
    return NextResponse.json({ error: "Error al procesar archivos" }, { status: 500 });
  }
}
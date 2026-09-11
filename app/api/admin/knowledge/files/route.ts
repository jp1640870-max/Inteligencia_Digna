export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import { requireRole } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  getKbFiles,
  insertKbFile,
  updateKbFile,
  findKbFileByName,
  getKbCategoryBySlug,
  getConfig,
  logAudit,
} from "@/lib/db";
import { extractText } from "@/lib/file-processor";
import { indexKbFile, normalizeFileName } from "@/lib/kb";
import { log, childLogger } from "@/lib/logger";

const ALLOWED_EXTENSIONS = ["pdf", "docx", "xlsx", "xls", "txt", "md", "csv"];
const MIN_USEFUL_TEXT = 20;

type UploadResult = {
  name: string;
  status: "active" | "hold" | "duplicate" | "invalid" | "error";
  message: string;
  fileId?: string;
  conflictWith?: string | null;
  chunkCount?: number;
};

export async function GET(req: Request) {
  const { allowed } = await requireRole(["super_admin", "admin", "editor"]);
  if (!allowed) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const categoryId = searchParams.get("categoryId") || undefined;
  const status = searchParams.get("status") || undefined;
  const search = searchParams.get("search") || undefined;

  const files = getKbFiles({ categoryId, status, search });
  return NextResponse.json({ files });
}

export async function POST(req: Request) {
  const { allowed, user } = await requireRole(["super_admin", "admin", "editor"]);
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
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

    const maxSizeMb = parseInt(getConfig("max_file_size_mb") || "20", 10) || 20;

    // Categoría por defecto: general
    let categoryId = categoryIdParam;
    if (!categoryId) {
      const general = getKbCategoryBySlug("general");
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
        const existing = findKbFileByName(title).find((f) => f.format === "text");
        if (existing) {
          updateKbFile(existing.id, { content, category_id: categoryId, checksum: null });
          const indexing = await indexKbFile(existing.id);
          updateKbFile(existing.id, { status: "active" });
          results.push({
            name: title,
            status: "active",
            message: `Entrada actualizada e indexada (${indexing.chunks} fragmentos)`,
            fileId: existing.id,
            chunkCount: indexing.chunks,
          });
        } else {
          const fileId = uuidv4();
          insertKbFile({
            id: fileId,
            filename: title,
            format: "text",
            category_id: categoryId,
            status: "processing",
            content,
            checksum: null,
            uploaded_by: user.id,
          });
          const indexing = await indexKbFile(fileId);
          updateKbFile(fileId, { status: "active" });
          results.push({
            name: title,
            status: "active",
            message: `Entrada guardada e indexada (${indexing.chunks} fragmentos)`,
            fileId,
            chunkCount: indexing.chunks,
          });
        }
        logAudit(user.id, "kb.upload", `Entrada manual: "${title}"`, "");
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
      const existingByName = findKbFileByName(name);
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

      insertKbFile({
        id: fileId,
        filename: name,
        format: ext,
        size_bytes: file.size,
        category_id: categoryId,
        status: "processing",
        conflict_with: isConflict ? previous.id : null,
        content,
        checksum,
        uploaded_by: user.id,
      });

      if (isConflict) {
        // Conflicto de nombre: HOLD sin indexar hasta resolución
        updateKbFile(fileId, { status: "hold" });
        results.push({
          name,
          status: "hold",
          message: `Nombre duplicado con "${previous.filename}". En revisión — resuélvelo desde el panel.`,
          fileId,
          conflictWith: previous.id,
        });
        logAudit(user.id, "kb.conflict", `Conflicto KB: "${name}" choca con "${previous.filename}"`, "");
        continue;
      }

      if (lowContent) {
        updateKbFile(fileId, { status: "hold" });
        results.push({
          name,
          status: "hold",
          message: "No se pudo extraer texto útil del archivo. En revisión.",
          fileId,
        });
        logAudit(user.id, "kb.hold", `Archivo en revisión (texto insuficiente): "${name}"`, "");
        continue;
      }

      // ─── Caso normal: indexar y activar ───
      try {
        const indexing = await indexKbFile(fileId);
        updateKbFile(fileId, { status: "active" });
        results.push({
          name,
          status: "active",
          message: `Indexado correctamente (${indexing.chunks} fragmentos${indexing.truncated ? ", truncado al máximo permitido" : ""})`,
          fileId,
          chunkCount: indexing.chunks,
        });
        logAudit(user.id, "kb.upload", `Archivo subido e indexado: "${name}" (${indexing.chunks} chunks)`, "");
      } catch (e) {
        // Indexación falló → queda en processing para reintento manual
        const msg = e instanceof Error ? e.message : String(e);
        reqLog.error({ filename: name }, `Error indexando KB: ${msg}`);
        results.push({
          name,
          status: "error",
          message: `Archivo guardado pero falló la indexación. Usa "Reindexar": ${msg}`,
          fileId,
        });
      }
    }

    log.info({ userId: user.id, uploaded: results.length }, "Subida KB completada");
    return NextResponse.json({ results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    reqLog.error({ err: msg }, "Error en subida KB");
    return NextResponse.json({ error: "Error al procesar archivos" }, { status: 500 });
  }
}
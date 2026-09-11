export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import {
  getKbFileById,
  updateKbFile,
  updateKbChunksCategory,
  getKbCategoryById,
  logAudit,
} from "@/lib/db";
import { indexKbFile, deleteKbFile, resolveKeepBoth } from "@/lib/kb";
import { childLogger } from "@/lib/logger";
import type { KbConflictAction } from "@/types";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, user } = await requireRole(["super_admin", "admin", "editor"]);
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const file = getKbFileById(id);
  if (!file) {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
  }

  deleteKbFile(id);
  logAudit(user.id, "kb.delete", `Archivo eliminado: "${file.filename}"`, "");

  return NextResponse.json({ success: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, user } = await requireRole(["super_admin", "admin", "editor"]);
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const action = body.action as KbConflictAction;
  const reqLog = childLogger({ userId: user.id, fileId: id, action });

  const file = getKbFileById(id);
  if (!file) {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
  }

  try {
    switch (action) {
      case "keep-both": {
        if (file.status !== "hold") {
          return NextResponse.json({ error: "El archivo no está en revisión" }, { status: 400 });
        }
        const renamed = resolveKeepBoth(id);
        if (!renamed) {
          return NextResponse.json({ error: "No se pudo mantener ambos archivos" }, { status: 400 });
        }
        const indexing = await indexKbFile(id);
        logAudit(user.id, "kb.resolve", `Conflicto resuelto (mantener ambos): "${renamed.filename}" (${indexing.chunks} chunks)`, "");
        return NextResponse.json({ success: true, message: `Archivo activado como "${renamed.filename}" (${indexing.chunks} fragmentos)` });
      }

      case "delete-new": {
        deleteKbFile(id);
        logAudit(user.id, "kb.resolve", `Conflicto resuelto (eliminar el nuevo): "${file.filename}"`, "");
        return NextResponse.json({ success: true, message: "Archivo nuevo eliminado" });
      }

      case "delete-old": {
        if (!file.conflict_with) {
          return NextResponse.json({ error: "No hay archivo anterior con conflicto" }, { status: 400 });
        }
        const oldFile = getKbFileById(file.conflict_with);
        deleteKbFile(file.conflict_with);
        updateKbFile(id, { status: "active", conflict_with: null });
        const indexing = await indexKbFile(id);
        logAudit(user.id, "kb.resolve",
          `Conflicto resuelto (eliminar el anterior): "${oldFile?.filename || "?"}" → activo "${file.filename}" (${indexing.chunks} chunks)`, "");
        return NextResponse.json({ success: true, message: `Versión anterior eliminada; "${file.filename}" activo (${indexing.chunks} fragmentos)` });
      }

      case "reactivate": {
        if (file.status === "active") {
          return NextResponse.json({ error: "El archivo ya está activo" }, { status: 400 });
        }
        const indexing = await indexKbFile(id);
        updateKbFile(id, { status: "active" });
        logAudit(user.id, "kb.resolve", `Archivo reactivado: "${file.filename}" (${indexing.chunks} chunks)`, "");
        return NextResponse.json({ success: true, message: `Archivo activo (${indexing.chunks} fragmentos)` });
      }

      case "reindex": {
        const indexing = await indexKbFile(id);
        // Reactivar si estaba en processing o active sin conflicto
        if (file.status !== "hold" || !file.conflict_with) {
          updateKbFile(id, { status: "active" });
        }
        logAudit(user.id, "kb.reindex", `Reindexado: "${file.filename}" (${indexing.chunks} chunks${indexing.truncated ? ", truncado" : ""})`, "");
        return NextResponse.json({ success: true, message: `Reindexado (${indexing.chunks} fragmentos)` });
      }

      case "move": {
        const categoryId = body.categoryId as string | undefined;
        if (!categoryId || !getKbCategoryById(categoryId)) {
          return NextResponse.json({ error: "Categoría inválida" }, { status: 400 });
        }
        updateKbFile(id, { category_id: categoryId });
        updateKbChunksCategory(id, categoryId);
        logAudit(user.id, "kb.move", `Archivo movido: "${file.filename}" → categoría ${categoryId}`, "");
        return NextResponse.json({ success: true, message: "Categoría actualizada" });
      }

      default:
        return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    reqLog.error({ err: msg }, `Error en acción KB ${action}`);
    return NextResponse.json({ error: `Error al aplicar acción: ${msg}` }, { status: 500 });
  }
}
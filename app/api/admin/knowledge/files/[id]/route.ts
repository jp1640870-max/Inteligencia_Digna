export const runtime = "nodejs";

import { NextResponse } from "next/server";
import {
  requireCapability,
} from "@/lib/auth";
import {
  getKbFileById,
  updateKbFile,
  updateKbChunksCategory,
  getKbCategoryById,
  logAudit,
  getAttachmentsByKbFile,
  deleteAttachment,
} from "@/lib/db";
import { indexKbFile, deleteKbFile, resolveKeepBoth } from "@/lib/kb";
import { can } from "@/lib/permissions";
import { childLogger } from "@/lib/logger";
import { deleteObject } from "@/lib/storage";
import type { KbConflictAction } from "@/types";

async function removeStoredObjects(kbFileId: string): Promise<void> {
  const attachments = await getAttachmentsByKbFile(kbFileId);
  for (const attachment of attachments) {
    await deleteObject(attachment.object_key);
    await deleteAttachment(attachment.id);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Borrar es una acción de perímetro, igual que aprobar o descartar: destruye
  // contenido ya publicado y corta el acceso de quien lo tenía concedido. El
  // `editor` puede subir y reclasificar, pero no decidir qué se elimina.
  const { allowed, status, user } = await requireCapability("kb.delete");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { id } = await params;
  const file = await getKbFileById(id);
  if (!file) {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
  }

  await removeStoredObjects(id);
  await deleteKbFile(id);
  await logAudit(user.id, "kb.delete", `Archivo eliminado: "${file.filename}"`, "");

  return NextResponse.json({ success: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, status, user } = await requireCapability("kb.manage");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { id } = await params;
  const body = await req.json();
  const action = body.action as KbConflictAction;
  const reqLog = childLogger({ userId: user.id, fileId: id, action });

  // `editor` prepara contenido: puede subir y reclasificar, pero no decide el
  // destino de un documento ni su visibilidad. Publicar, descartar o
  // reindexar cambia qué es legible para el resto, así que es del perímetro.
  //
  // La condición sale de la matriz de capacidades, no de comparar roles aquí.
  // Con la lista local, cada acción nueva tenía que acordarse de declararse
  // de perímetro, y ese acuerdo es justo lo que se pierde cuando vive lejos
  // de la política.
  const PUBLISH_ACTIONS: KbConflictAction[] = [
    "approve",
    "reject",
    "keep-both",
    "delete-new",
    "delete-old",
    "reactivate",
    "reindex",
  ];
  if (PUBLISH_ACTIONS.includes(action) && !can(user.role, "kb.publish")) {
    return NextResponse.json(
      { error: "Esta acción requiere rol admin o super_admin" },
      { status: 403 },
    );
  }

  const file = await getKbFileById(id);
  if (!file) {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
  }

  try {
    switch (action) {
      case "keep-both": {
        if (file.status !== "hold") {
          return NextResponse.json({ error: "El archivo no está en revisión" }, { status: 400 });
        }
        const renamed = await resolveKeepBoth(id);
        if (!renamed) {
          return NextResponse.json({ error: "No se pudo mantener ambos archivos" }, { status: 400 });
        }
        const indexing = await indexKbFile(id);
        await logAudit(user.id, "kb.resolve", `Conflicto resuelto (mantener ambos): "${renamed.filename}" (${indexing.chunks} chunks)`, "");
        return NextResponse.json({ success: true, message: `Archivo activado como "${renamed.filename}" (${indexing.chunks} fragmentos)` });
      }

      case "delete-new": {
        await removeStoredObjects(id);
        await deleteKbFile(id);
        await logAudit(user.id, "kb.resolve", `Conflicto resuelto (eliminar el nuevo): "${file.filename}"`, "");
        return NextResponse.json({ success: true, message: "Archivo nuevo eliminado" });
      }

      case "delete-old": {
        if (!file.conflict_with) {
          return NextResponse.json({ error: "No hay archivo anterior con conflicto" }, { status: 400 });
        }
        const oldFile = await getKbFileById(file.conflict_with);
        await removeStoredObjects(file.conflict_with);
        await deleteKbFile(file.conflict_with);
        await updateKbFile(id, { status: "active", conflict_with: null });
        const indexing = await indexKbFile(id);
        await logAudit(user.id, "kb.resolve",
          `Conflicto resuelto (eliminar el anterior): "${oldFile?.filename || "?"}" → activo "${file.filename}" (${indexing.chunks} chunks)`, "");
        return NextResponse.json({ success: true, message: `Versión anterior eliminada; "${file.filename}" activo (${indexing.chunks} fragmentos)` });
      }

      case "reactivate": {
        if (file.status === "active") {
          return NextResponse.json({ error: "El archivo ya está activo" }, { status: 400 });
        }
        const indexing = await indexKbFile(id);
        await updateKbFile(id, { status: "active" });
        await logAudit(user.id, "kb.resolve", `Archivo reactivado: "${file.filename}" (${indexing.chunks} chunks)`, "");
        return NextResponse.json({ success: true, message: `Archivo activo (${indexing.chunks} fragmentos)` });
      }

      case "reindex": {
        const indexing = await indexKbFile(id);
        // Reactivar si estaba en processing o active sin conflicto
        if (file.status !== "hold" || !file.conflict_with) {
          await updateKbFile(id, { status: "active" });
        }
        await logAudit(user.id, "kb.reindex", `Reindexado: "${file.filename}" (${indexing.chunks} chunks${indexing.truncated ? ", truncado" : ""})`, "");
        return NextResponse.json({ success: true, message: `Reindexado (${indexing.chunks} fragmentos)` });
      }

      case "move": {
        const categoryId = body.categoryId as string | undefined;
        if (!categoryId || !(await getKbCategoryById(categoryId))) {
          return NextResponse.json({ error: "Categoría inválida" }, { status: 400 });
        }
        await updateKbFile(id, { category_id: categoryId });
        await updateKbChunksCategory(id, categoryId);
        await logAudit(user.id, "kb.move", `Archivo movido: "${file.filename}" → categoría ${categoryId}`, "");
        return NextResponse.json({ success: true, message: "Categoría actualizada" });
      }

      case "approve": {
        // Aprobar es el punto donde el contenido se vuelve buscable, así que
        // indexa y activa. Sin grants sigue sin ser visible para nadie: aprobar
        // y conceder acceso son dos decisiones separadas y auditables.
        if (file.status === "active") {
          return NextResponse.json({ error: "El archivo ya está activo" }, { status: 400 });
        }
        if (file.status === "hold" && file.conflict_with) {
          return NextResponse.json(
            { error: "Resuelve primero el conflicto de nombre" },
            { status: 400 },
          );
        }
        const indexing = await indexKbFile(id);
        // Un archivo que se aprobó sin extraer nada quedaría "activo" pero sin
        // fragmentos: el retrieval no lo encontraría nunca y el estado
        // mentiría sobre la disponibilidad. Se devuelve a `hold` en su lugar.
        if (indexing.chunks === 0) {
          await updateKbFile(id, { status: "hold" });
          return NextResponse.json(
            {
              error:
                "No se extrajo texto del documento. Revisa el formato o el tamaño antes de aprobarlo.",
            },
            { status: 422 },
          );
        }
        await updateKbFile(id, { status: "active" });
        await logAudit(
          user.id,
          "kb.approve",
          `Archivo aprobado: "${file.filename}" (${indexing.chunks} fragmentos). Revisa que tenga grants.`,
          "",
        );
        return NextResponse.json({
          success: true,
          message: `Aprobado e indexado (${indexing.chunks} fragmentos). Los grants son un paso aparte.`,
        });
      }

      case "reject": {
        // Rechazar limpia los objetos y el contenido: si se conserva, el
        // documento sigue en la base sin ningún rastro de que se descartó.
        await removeStoredObjects(id);
        await deleteKbFile(id);
        await logAudit(user.id, "kb.reject", `Archivo rechazado y eliminado: "${file.filename}"`, "");
        return NextResponse.json({ success: true, message: "Archivo rechazado y eliminado" });
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
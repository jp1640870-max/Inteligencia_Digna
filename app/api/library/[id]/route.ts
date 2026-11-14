export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import {
  deleteGeneratedDocument,
  getGeneratedDocumentById,
} from "@/lib/db";
import { deleteObject } from "@/lib/storage";
import { toGeneratedDocumentMeta } from "@/lib/generated-document";
import { isValidUuid } from "@/lib/uuid";

/**
 * Detalle de un documento generado (solo el dueño).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  }
  const document = await getGeneratedDocumentById(id);
  if (!document) {
    return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  }
  if (document.user_id !== userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  return NextResponse.json({ document: toGeneratedDocumentMeta(document) });
}

/**
 * Elimina un documento generado y sus objetos en storage (solo el dueño).
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  }
  const deleted = await deleteGeneratedDocument(id, userId);
  if (!deleted) {
    return NextResponse.json({ error: "Documento no encontrado o no autorizado" }, { status: 404 });
  }

  // Borrar objetos de storage (no bloqueamos la respuesta si falla alguno).
  await Promise.allSettled(deleted.objectKeys.map((key) => deleteObject(key)));

  return NextResponse.json({ success: true, id });
}

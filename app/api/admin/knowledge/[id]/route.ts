import { NextResponse } from "next/server";
import {
  requireCapability,
} from "@/lib/auth";
import { deleteKnowledgeEntry, getKnowledgeEntryById, logAudit, updateKnowledgeEntry } from "@/lib/db";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, status, user } = await requireCapability("kb.delete");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { id } = await params;
  // Se lee el título antes de borrar: el audit_log guarda texto legible, no un
  // id que ya no resuelve a nada.
  const existing = await getKnowledgeEntryById(id);
  await deleteKnowledgeEntry(id);
  await logAudit(user.id, "knowledge.delete", `Entrada eliminada: "${existing?.title ?? id}"`, "");

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
  const { title, content, category } = await req.json();

  if (!title || !content) {
    return NextResponse.json({ error: "Título y contenido son requeridos" }, { status: 400 });
  }

  await updateKnowledgeEntry(id, title, content, category || "general");
  await logAudit(user.id, "knowledge.update", `Entrada actualizada: "${title}"`, "");

  return NextResponse.json({ success: true });
}

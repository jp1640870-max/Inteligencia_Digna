import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { deleteKnowledgeEntry, updateKnowledgeEntry } from "@/lib/db";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed } = await requireRole(["super_admin", "admin"]);
  if (!allowed) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;
  deleteKnowledgeEntry(id);

  return NextResponse.json({ success: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed } = await requireRole(["super_admin", "admin", "editor"]);
  if (!allowed) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const { title, content, category } = await req.json();

  if (!title || !content) {
    return NextResponse.json({ error: "Título y contenido son requeridos" }, { status: 400 });
  }

  updateKnowledgeEntry(id, title, content, category || "general");

  return NextResponse.json({ success: true });
}

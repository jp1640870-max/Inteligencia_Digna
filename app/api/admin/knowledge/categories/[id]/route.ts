import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { updateKbCategory, deleteKbCategory, getKbCategoryById } from "@/lib/db";
import { logAudit } from "@/lib/db";

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
  const label = body.label || undefined;
  const name = body.name || undefined;

  if (!label && !name) {
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
  }

  const updated = updateKbCategory(id, { name, label });
  if (!updated) {
    return NextResponse.json({ error: "No se pudo actualizar (la categoría 'general' es protegida)" }, { status: 400 });
  }

  logAudit(user.id, "kb.category_update", `Categoría actualizada: ${id}`, "");

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, user } = await requireRole(["super_admin", "admin"]);
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const category = getKbCategoryById(id);
  if (!category || category.name === "general") {
    return NextResponse.json({ error: "No se puede eliminar (la categoría 'general' es protegida)" }, { status: 400 });
  }

  const deleted = deleteKbCategory(id);
  if (!deleted) {
    return NextResponse.json({ error: "No se pudo eliminar" }, { status: 400 });
  }

  logAudit(user.id, "kb.category_delete", `Categoría eliminada: ${category.name}`, "");

  return NextResponse.json({ success: true });
}
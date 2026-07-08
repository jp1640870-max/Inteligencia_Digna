import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { deleteProject, getProjectById } from "@/lib/projects";

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const userId = await getUserIdFromRequest();

  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await context.params;

  const project = getProjectById(id);

  if (!project) {
    return NextResponse.json({ error: "Proyecto no existe" }, { status: 404 });
  }

  if (project.user_id !== userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const deleted = deleteProject(id, userId);

  if (!deleted) {
    return NextResponse.json({ error: "No se pudo eliminar" }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}

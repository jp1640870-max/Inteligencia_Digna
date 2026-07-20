import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getHeartById, updateHeart, deleteHeart, logAudit } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed } = await requireRole(["super_admin", "admin"]);
  if (!allowed) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const heart = getHeartById(id);
  if (!heart) {
    return NextResponse.json({ error: "Heart no encontrado" }, { status: 404 });
  }

  return NextResponse.json(heart);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed } = await requireRole(["super_admin", "admin"]);
  if (!allowed) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const data = await req.json();

  delete data.id;
  updateHeart(id, data);

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
  const heart = getHeartById(id);
  if (heart) {
    logAudit(user.id, "delete_heart", `Heart eliminado: ${heart.name}`);
  }
  deleteHeart(id);

  return NextResponse.json({ success: true });
}

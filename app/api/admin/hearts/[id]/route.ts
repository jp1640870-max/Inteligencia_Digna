import { NextResponse } from "next/server";
import {
  requireCapability,
} from "@/lib/auth";
import { getHeartById, updateHeart, deleteHeart, logAudit } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, status } = await requireCapability("hearts.manage");
  if (!allowed) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { id } = await params;
  const heart = await getHeartById(id);
  if (!heart) {
    return NextResponse.json({ error: "Heart no encontrado" }, { status: 404 });
  }

  return NextResponse.json(heart);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, status } = await requireCapability("hearts.manage");
  if (!allowed) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { id } = await params;
  const data = await req.json();

  delete data.id;
  await updateHeart(id, data);

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, status, user } = await requireCapability("hearts.manage");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { id } = await params;
  const heart = await getHeartById(id);
  if (heart) {
    await logAudit(user.id, "delete_heart", `Heart eliminado: ${heart.name}`);
  }
  await deleteHeart(id);

  return NextResponse.json({ success: true });
}

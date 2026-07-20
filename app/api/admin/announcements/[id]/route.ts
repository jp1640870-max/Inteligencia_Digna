import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { updateAnnouncement, deleteAnnouncement } from "@/lib/db";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed } = await requireRole(["super_admin", "admin"]);
  if (!allowed) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { id } = await params;
  const data = await req.json();
  delete data.id;
  updateAnnouncement(id, data);
  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed } = await requireRole(["super_admin", "admin"]);
  if (!allowed) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { id } = await params;
  deleteAnnouncement(id);
  return NextResponse.json({ success: true });
}

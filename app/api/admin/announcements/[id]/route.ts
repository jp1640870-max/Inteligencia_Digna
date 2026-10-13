import { NextResponse } from "next/server";
import {
  requireCapability,
} from "@/lib/auth";
import { updateAnnouncement, deleteAnnouncement, getAnnouncementById, logAudit } from "@/lib/db";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, status, user } = await requireCapability("announcements.write");
  if (!allowed || !user) return NextResponse.json({ error: "No autorizado" }, { status });
  const { id } = await params;
  const data = await req.json();
  delete data.id;
  await updateAnnouncement(id, data);
  await logAudit(user.id, "announcement.update", `Anuncio actualizado (${id}): ${Object.keys(data).join(", ") || "sin cambios"}`, "");
  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, status, user } = await requireCapability("announcements.write");
  if (!allowed || !user) return NextResponse.json({ error: "No autorizado" }, { status });
  const { id } = await params;
  const existing = await getAnnouncementById(id);
  await deleteAnnouncement(id);
  await logAudit(user.id, "announcement.delete", `Anuncio eliminado: "${existing?.title ?? id}"`, "");
  return NextResponse.json({ success: true });
}

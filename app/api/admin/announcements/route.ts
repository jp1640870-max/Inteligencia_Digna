import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  requireCapability,
} from "@/lib/auth";
import { getAnnouncements, createAnnouncement, logAudit } from "@/lib/db";

export async function GET() {
  const { allowed, status } = await requireCapability("announcements.read");
  if (!allowed) return NextResponse.json({ error: "No autorizado" }, { status });
  const announcements = await getAnnouncements();
  return NextResponse.json({ announcements });
}

export async function POST(req: Request) {
  const { allowed, status, user } = await requireCapability("announcements.write");
  if (!allowed || !user) return NextResponse.json({ error: "No autorizado" }, { status });

  const { title, content, type } = await req.json();
  if (!title || !content) {
    return NextResponse.json({ error: "Título y contenido son requeridos" }, { status: 400 });
  }

  const id = uuidv4();
  await createAnnouncement(id, title, content, type || "info", user.id);
  await logAudit(user.id, "announcement.create", `Anuncio creado: "${title}" (${type || "info"})`, "");
  return NextResponse.json({ success: true, id });
}

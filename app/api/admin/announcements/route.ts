import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { requireRole } from "@/lib/auth";
import { getAnnouncements, createAnnouncement } from "@/lib/db";

export async function GET() {
  const { allowed } = await requireRole(["super_admin", "admin", "editor", "viewer"]);
  if (!allowed) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const announcements = getAnnouncements();
  return NextResponse.json({ announcements });
}

export async function POST(req: Request) {
  const { allowed, user } = await requireRole(["super_admin", "admin"]);
  if (!allowed || !user) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const { title, content, type } = await req.json();
  if (!title || !content) {
    return NextResponse.json({ error: "Título y contenido son requeridos" }, { status: 400 });
  }

  const id = uuidv4();
  createAnnouncement(id, title, content, type || "info", user.id);
  return NextResponse.json({ success: true, id });
}

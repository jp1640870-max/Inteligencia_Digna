import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { requireRole, getAuthUserFromRequest } from "@/lib/auth";
import { getKnowledgeEntries, createKnowledgeEntry } from "@/lib/db";

export async function GET(req: Request) {
  const { allowed } = await requireRole(["super_admin", "admin", "editor"]);
  if (!allowed) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category") || undefined;

  const entries = getKnowledgeEntries(category);
  return NextResponse.json({ entries });
}

export async function POST(req: Request) {
  const { allowed, user } = await requireRole(["super_admin", "admin", "editor"]);
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { title, content, category } = await req.json();

  if (!title || !content) {
    return NextResponse.json({ error: "Título y contenido son requeridos" }, { status: 400 });
  }

  const id = uuidv4();
  createKnowledgeEntry(id, title, content, category || "general", user.id);

  return NextResponse.json({ success: true, id });
}

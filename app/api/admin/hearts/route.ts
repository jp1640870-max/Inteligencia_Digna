import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { requireRole } from "@/lib/auth";
import { getAllHearts, createHeart, logAudit } from "@/lib/db";

export async function GET() {
  const { allowed } = await requireRole(["super_admin", "admin"]);
  if (!allowed) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const hearts = getAllHearts();
  return NextResponse.json({ hearts });
}

export async function POST(req: Request) {
  const { allowed, user } = await requireRole(["super_admin", "admin"]);
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { name, role, tone, instructions, limitations, temperature, tools, isPreset } = await req.json();

  if (!name) {
    return NextResponse.json({ error: "Nombre es requerido" }, { status: 400 });
  }

  const id = uuidv4();
  createHeart(id, user.id, name, role, tone, instructions, limitations, temperature, tools, isPreset ? 1 : 0);

  logAudit(user.id, "create_heart", `Heart creado: ${name}${isPreset ? " (preset)" : ""}`);
  return NextResponse.json({ success: true, id });
}

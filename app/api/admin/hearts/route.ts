import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  requireCapability,
} from "@/lib/auth";
import { getAllHearts, createHeart, logAudit } from "@/lib/db";

export async function GET() {
  const { allowed, status } = await requireCapability("hearts.manage");
  if (!allowed) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const hearts = await getAllHearts();
  return NextResponse.json({ hearts });
}

export async function POST(req: Request) {
  const { allowed, status, user } = await requireCapability("hearts.manage");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { name, role, tone, instructions, limitations, temperature, tools, isPreset } = await req.json();

  if (!name) {
    return NextResponse.json({ error: "Nombre es requerido" }, { status: 400 });
  }

  const id = uuidv4();
  await createHeart(id, user.id, name, role, tone, instructions, limitations, temperature, tools, isPreset ? 1 : 0);

  await logAudit(user.id, "create_heart", `Heart creado: ${name}${isPreset ? " (preset)" : ""}`);
  return NextResponse.json({ success: true, id });
}

import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { getHeartById, updateHeart, deleteHeart, logAudit } from "@/lib/db";
import { parseHeartTools, sanitizeHeartInput } from "@/lib/hearts";

async function getManagedHeart(id: string) {
  const heart = await getHeartById(id);
  if (!heart) return null;
  // El panel administra Hearts de empresa y también puede moderar los
  // Hearts personales creados por los usuarios.
  if (heart.scope !== "company" && heart.scope !== "personal") return null;
  return heart;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, status } = await requireCapability("hearts.manage");
  if (!allowed) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { id } = await params;
  const heart = await getManagedHeart(id);
  if (!heart) {
    return NextResponse.json({ error: "Heart no encontrado" }, { status: 404 });
  }

  return NextResponse.json(heart);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, status, user } = await requireCapability("hearts.manage");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { id } = await params;
  const heart = await getManagedHeart(id);
  if (!heart) {
    return NextResponse.json({ error: "Heart no encontrado" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const sanitized = sanitizeHeartInput({
    ...heart,
    tools: parseHeartTools(heart.tools),
    ...body,
  });
  if (!sanitized.ok) {
    return NextResponse.json({ error: sanitized.error }, { status: 400 });
  }

  const data: Record<string, unknown> = {
    name: sanitized.value.name,
    role: sanitized.value.role,
    tone: sanitized.value.tone,
    temperature: sanitized.value.temperature,
  };

  // El comportamiento del agente oficial vive en el backend. Desde el panel
  // solo se ajusta su presentación y si aparece fijado.
  if (!heart.agent_key) {
    data.instructions = sanitized.value.instructions;
    data.limitations = sanitized.value.limitations;
    data.tools = sanitized.value.tools;
  }

  // El fijado global solo aplica a Hearts de empresa. Un Heart personal no
  // debe convertirse en destacado para todos desde la moderación.
  if (heart.scope === "company") {
    if ("isFeatured" in body) {
      data.is_featured = Boolean(body.isFeatured);
    } else if ("is_featured" in body) {
      data.is_featured = Boolean(body.is_featured);
    }
  }

  await updateHeart(id, data);
  const scopeLabel = heart.scope === "company" ? "empresa" : "usuario";
  await logAudit(
    user.id,
    "update_heart",
    `Heart de ${scopeLabel} actualizado: ${sanitized.value.name}`,
  );

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
  const heart = await getManagedHeart(id);
  if (!heart) {
    return NextResponse.json({ error: "Heart no encontrado" }, { status: 404 });
  }
  if (heart.agent_key) {
    return NextResponse.json(
      { error: "El agente oficial no se puede eliminar" },
      { status: 409 },
    );
  }

  const scopeLabel = heart.scope === "company" ? "empresa" : "usuario";
  await logAudit(
    user.id,
    "delete_heart",
    `Heart de ${scopeLabel} eliminado: ${heart.name}`,
  );
  await deleteHeart(id);

  return NextResponse.json({ success: true });
}

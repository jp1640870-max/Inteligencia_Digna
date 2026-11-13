import { NextResponse } from "next/server";
import { getAuthUserFromRequest } from "@/lib/auth";
import {
  canEditHeart,
  getHeartRow,
  parseHeartTools,
  readHeartForUser,
  removeOwnedHeart,
  sanitizeHeartInput,
  updateOwnedHeart,
} from "@/lib/hearts";

type Context = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: Context) {
  const authUser = await getAuthUserFromRequest();
  if (!authUser) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const userId = authUser.id;

  const { id } = await context.params;
  const agent = await readHeartForUser(id, userId);
  if (!agent) {
    return NextResponse.json({ error: "Heart no encontrado" }, { status: 404 });
  }

  return NextResponse.json({ agent });
}

export async function PATCH(req: Request, context: Context) {
  const authUser = await getAuthUserFromRequest();
  if (!authUser) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const userId = authUser.id;

  const { id } = await context.params;
  const heart = await getHeartRow(id);
  if (!heart) {
    return NextResponse.json({ error: "Heart no encontrado" }, { status: 404 });
  }
  if (!canEditHeart(heart, userId)) {
    return NextResponse.json(
      { error: "Solo puedes editar tus propios Hearts" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const sanitized = sanitizeHeartInput({
    ...heart,
    tools: parseHeartTools(heart.tools),
    ...(body && typeof body === "object" && !Array.isArray(body) ? body : {}),
  });
  if (!sanitized.ok) {
    return NextResponse.json({ error: sanitized.error }, { status: 400 });
  }

  const agent = await updateOwnedHeart(id, userId, sanitized.value);
  if (!agent) {
    return NextResponse.json({ error: "Heart no encontrado" }, { status: 404 });
  }

  return NextResponse.json({ agent });
}

export async function DELETE(_req: Request, context: Context) {
  const authUser = await getAuthUserFromRequest();
  if (!authUser) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const userId = authUser.id;

  const { id } = await context.params;
  const heart = await getHeartRow(id);
  if (!heart) {
    return NextResponse.json({ error: "Heart no encontrado" }, { status: 404 });
  }
  if (!canEditHeart(heart, userId)) {
    return NextResponse.json(
      { error: "Solo puedes eliminar tus propios Hearts" },
      { status: 403 },
    );
  }

  const removed = await removeOwnedHeart(id, userId);
  if (!removed) {
    return NextResponse.json({ error: "No se pudo eliminar" }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}

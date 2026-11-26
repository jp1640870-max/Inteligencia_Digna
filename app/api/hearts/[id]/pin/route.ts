import { NextResponse } from "next/server";
import { getAuthUserFromRequest } from "@/lib/auth";
import { setHeartPinnedForUser } from "@/lib/hearts";

type Context = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: Context) {
  const authUser = await getAuthUserFromRequest();
  if (!authUser) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const pinned =
    body && typeof body === "object" && typeof body.pinned === "boolean"
      ? body.pinned
      : null;

  if (pinned === null) {
    return NextResponse.json(
      { error: "El campo pinned debe ser booleano" },
      { status: 400 },
    );
  }

  const agent = await setHeartPinnedForUser(id, authUser.id, pinned);
  if (!agent) {
    return NextResponse.json({ error: "Heart no encontrado" }, { status: 404 });
  }

  return NextResponse.json({ success: true, pinned, agent });
}

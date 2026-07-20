import { NextResponse } from "next/server";
import { requireRole, canViewUser } from "@/lib/auth";
import { getChatWithMessages } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, user: caller } = await requireRole(["super_admin", "admin"]);
  if (!allowed || !caller) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const { id } = await params;
  const chat = getChatWithMessages(id);
  if (!chat) return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });

  // Si el chat pertenece a un super_admin y el caller no es super_admin, ocultar
  if (!canViewUser(caller.role, chat.user_role || "user", caller.id, chat.user_id)) {
    return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
  }

  return NextResponse.json(chat);
}

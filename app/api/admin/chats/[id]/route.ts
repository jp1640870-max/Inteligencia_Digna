import { NextResponse } from "next/server";
import {
  requireCapability,
  canViewUser,
} from "@/lib/auth";
import { getChatWithMessages, logAudit } from "@/lib/db";
import { clientIp } from "@/lib/request";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, status, user: caller } = await requireCapability("chats.read_content");
  if (!allowed || !caller) return NextResponse.json({ error: "No autorizado" }, { status });

  const { id } = await params;
  const chat = await getChatWithMessages(id);
  if (!chat) return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });

  // Si el chat pertenece a un super_admin y el caller no es super_admin, ocultar
  if (!canViewUser(caller.role, chat.user_role || "user", caller.id, chat.user_id)) {
    return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
  }

  // Leer la conversación de otra persona es el acceso más sensible del panel:
  // incluye todo lo que esa persona escribió y lo que el asistente le respondió.
  // Queda registrado quién lo abrió y de quién era.
  await logAudit(
    caller.id,
    "chat.read",
    `Lectura del chat ${id} del usuario ${chat.user_email ?? chat.user_id}`,
    clientIp(req),
  );

  return NextResponse.json(chat);
}

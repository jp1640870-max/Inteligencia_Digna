export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getChatById, addMessage } from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/auth";

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const { chatId, content } = await req.json();
    if (!chatId || !content) {
      return NextResponse.json({ error: "chatId y content requeridos" }, { status: 400 });
    }

    const chat = getChatById(chatId);
    if (!chat) return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    if (chat.user_id !== userId) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    addMessage(chatId, "assistant", content);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("Save partial error:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

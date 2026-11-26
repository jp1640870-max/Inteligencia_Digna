export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getAuthUserFromRequest } from "@/lib/auth";
import { getChatById } from "@/lib/db";
import { resolveOfficialAgent, SUPPORT_AGENT } from "@/lib/official-agents";
import { readHeartForUser } from "@/lib/hearts";
import { buildSupportEscalation } from "@/lib/support-escalation";

/**
 * Prepara una vista previa de escalamiento. No crea tickets, no persiste nada
 * y no se conecta a ServiceDesk. El único dato que acepta del cliente es un
 * motivo opcional; el resto se deriva del chat persistido.
 */
export async function POST(req: Request) {
  const user = await getAuthUserFromRequest();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      chatId?: string;
      reason?: string;
    };
    const chatId = typeof body.chatId === "string" ? body.chatId : "";
    if (!chatId) {
      return NextResponse.json({ error: "chatId requerido" }, { status: 400 });
    }

    const chat = await getChatById(chatId);
    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }
    if (chat.user_id !== user.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    let isSupportChat =
      chat.agent_key === SUPPORT_AGENT.id &&
      Boolean(resolveOfficialAgent(chat.agent_key));

    if (!isSupportChat && chat.heart_id) {
      const heart = await readHeartForUser(chat.heart_id, user.id);
      isSupportChat = heart?.agent_key === SUPPORT_AGENT.id;
    }

    if (!isSupportChat) {
      return NextResponse.json(
        { error: "Este chat no pertenece al agente Soporte Técnico" },
        { status: 403 },
      );
    }

    if (!chat.messages.some((message) => message.role === "user" && message.text?.trim())) {
      return NextResponse.json(
        { error: "Aún no hay una consulta para escalar" },
        { status: 400 },
      );
    }

    const request = buildSupportEscalation({
      user: { name: user.name, email: user.email },
      messages: chat.messages.map((message) => ({
        role: message.role,
        text: message.text,
        kbSources: message.kbSources,
      })),
      reason: body.reason,
    });

    return NextResponse.json({
      preview: true,
      ticketCreated: false,
      request,
    });
  } catch {
    return NextResponse.json(
      { error: "No se pudo preparar la solicitud" },
      { status: 500 },
    );
  }
}

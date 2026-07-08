export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getChatById, getMessagesByChat, truncateMessagesToCount, addMessage } from "@/lib/db";
import { ollamaChatStream } from "@/lib/ollama";
import { buildMessages } from "@/lib/prompt-builder";
import { getUserIdFromRequest } from "@/lib/auth";

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const { chatId } = await req.json();

    const chat = getChatById(chatId);
    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }
    if (chat.user_id !== userId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const messages = getMessagesByChat(chatId);
    const lastMsg = messages[messages.length - 1];

    if (!lastMsg || lastMsg.role !== "ai") {
      return NextResponse.json({ error: "No hay mensaje para regenerar" }, { status: 400 });
    }

    truncateMessagesToCount(chatId, messages.length - 1);

    const remainingMessages = getMessagesByChat(chatId);
    const model = process.env.TEXT_MODEL!;

    const ollamaMessages = buildMessages(remainingMessages);

    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    let fullReply = "";

    const streamOllama = async () => {
      try {
        const generator = ollamaChatStream(model, ollamaMessages);
        for await (const chunk of generator) {
          fullReply += chunk;
          await writer.write(encoder.encode(chunk));
        }

        if (!fullReply || fullReply.length < 2) {
          throw new Error("respuesta vacía");
        }
      } catch {
        try {
          fullReply = "";
          const retryGen = ollamaChatStream(model, ollamaMessages);
          for await (const chunk of retryGen) {
            fullReply += chunk;
            await writer.write(encoder.encode(chunk));
          }

          if (!fullReply || fullReply.length < 2) {
            throw new Error("respuesta vacía");
          }
        } catch {
          const fallback = "No se pudo responder.";
          fullReply = fallback;
          await writer.write(encoder.encode(fallback));
        }
      } finally {
        if (fullReply) {
          addMessage(chatId, "assistant", fullReply);
        }
        await writer.close();
      }
    };

    streamOllama();

    return new Response(readable, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e) {
    console.error(e);
    return new Response("Error: la IA no respondió.", { status: 500 });
  }
}

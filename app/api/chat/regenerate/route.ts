export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getChatById, getMessagesByChat, truncateMessagesToCount, addMessage } from "@/lib/db";
import { ollamaChatStream } from "@/lib/ollama";
import { buildMessages } from "@/lib/prompt-builder";

export async function POST(req: Request) {
  try {
    const { chatId } = await req.json();

    const chat = getChatById(chatId);
    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }

    const messages = getMessagesByChat(chatId);
    const lastMsg = messages[messages.length - 1];

    if (!lastMsg || lastMsg.role !== "ai") {
      return NextResponse.json({ error: "No hay mensaje para regenerar" }, { status: 400 });
    }

    truncateMessagesToCount(chatId, messages.length - 1);

    const remainingMessages = getMessagesByChat(chatId);
    const isVision = remainingMessages.some((m) => m.images && m.images.length > 0);
    const TEXT_MODEL = process.env.TEXT_MODEL!;
    const VISION_MODEL = process.env.VISION_MODEL!;
    const model = isVision ? VISION_MODEL : TEXT_MODEL;

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

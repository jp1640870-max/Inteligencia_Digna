export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getChatById, getMessagesByChat, truncateMessagesToCount, addMessage } from "@/lib/db";
import { ollamaChatStream } from "@/lib/ollama";
import { buildMessages } from "@/lib/prompt-builder";
import { getUserIdFromRequest } from "@/lib/auth";
import { retrieveKb, getKbScopeIdsForUser, formatKbContext, toKbSources } from "@/lib/kb";
import type { KbSource } from "@/types";


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

    // --- KB retrieval para regeneración ---
    let kbContext = "";
    let kbSources: KbSource[] = [];
    try {
      const scopeIds = getKbScopeIdsForUser();
      const lastUserMsg = [...remainingMessages].reverse().find((m) => m.role === "user");
      if (scopeIds.length > 0 && lastUserMsg?.text) {
        const kbHits = await retrieveKb(lastUserMsg.text, scopeIds);
        if (kbHits.length > 0) {
          kbContext = formatKbContext(kbHits);
          kbSources = toKbSources(kbHits);
        }
      }
    } catch {}

    const ollamaMessages = buildMessages(remainingMessages, undefined, undefined, undefined, undefined, undefined, kbContext || undefined);

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
        if (fullReply) {
          console.log("⚡ regeneración abortada por el cliente, parcial:", fullReply.length, "chars");
        } else {
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
            try { await writer.write(encoder.encode(fallback)); } catch {}
          }
        }
      } finally {
        if (fullReply && fullReply !== "No se pudo responder.") {
          addMessage(chatId, "assistant", fullReply, undefined, undefined, kbSources);
        }
        try { await writer.close(); } catch {}
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

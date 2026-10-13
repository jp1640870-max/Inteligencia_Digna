export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getChatById, getMessagesByChat, truncateMessagesToCount, addMessage } from "@/lib/db";
import { ollamaChatStream, getChatModel } from "@/lib/ollama";
import { buildMessages } from "@/lib/prompt-builder";
import { getAuthUserFromRequest } from "@/lib/auth";
import { retrieveKb, formatKbContext, toKbSources } from "@/lib/kb";
import type { KbSource } from "@/types";


export async function POST(req: Request) {
  // Se necesita el rol, no solo el id: el acceso a la KB depende de él.
  const user = await getAuthUserFromRequest();
  const userId = user?.id;
  if (!userId || !user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const { chatId } = await req.json();

    const chat = await getChatById(chatId);
    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }
    if (chat.user_id !== userId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const messages = await getMessagesByChat(chatId);
    const lastMsg = messages[messages.length - 1];

    if (!lastMsg || lastMsg.role !== "ai") {
      return NextResponse.json({ error: "No hay mensaje para regenerar" }, { status: 400 });
    }

    await truncateMessagesToCount(chatId, messages.length - 1);

    const remainingMessages = await getMessagesByChat(chatId);
    const model = getChatModel();

    // --- KB retrieval para regeneración ---
    let kbContext = "";
    let kbSources: KbSource[] = [];
    try {
      const lastUserMsg = [...remainingMessages].reverse().find((m) => m.role === "user");
      if (lastUserMsg?.text) {
        const kbHits = await retrieveKb(lastUserMsg.text, user);
        if (kbHits.length > 0) {
          kbContext = formatKbContext(kbHits);
          kbSources = toKbSources(kbHits);
        }
      }
    } catch {}

    const chatMessages = buildMessages(remainingMessages, undefined, undefined, undefined, undefined, undefined, kbContext || undefined);

    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    let fullReply = "";

    const streamOllama = async () => {
      try {
        const generator = ollamaChatStream(model, chatMessages, { signal: req.signal });
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
            const retryGen = ollamaChatStream(model, chatMessages, { signal: req.signal });
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
          await addMessage(chatId, "assistant", fullReply, undefined, undefined, kbSources);
        }
        try { await writer.close(); } catch {}
      }
    };

    void streamOllama();

    return new Response(readable, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e) {
    console.error(e);
    return new Response("Error: la IA no respondió.", { status: 500 });
  }
}

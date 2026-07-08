export const runtime = "nodejs";

import { NextResponse } from "next/server";
import {
  getChatsByUser,
  getChatById,
  createChat,
  addMessage,
  deleteChat,
  truncateMessagesToCount,
} from "@/lib/db";
import { ollamaChatStream } from "@/lib/ollama";
import { buildMessages } from "@/lib/prompt-builder";
import { getUserIdFromRequest } from "@/lib/auth";

export async function GET(_req: Request) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const chats = getChatsByUser(userId);
  return NextResponse.json(chats);
}

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const chatId = (form.get("chatId") as string) || crypto.randomUUID();
    const message = (form.get("message") as string) || "";
    const filesContent = (form.get("filesContent") as string) || "";
    const editFromIndex = form.get("editFromIndex") as string | null;

    const images: string[] = [];
    form.forEach((value, key) => {
      if (key.startsWith("image_") && typeof value === "string") {
        images.push(value.split(",")[1]);
      }
    });

    const model = process.env.TEXT_MODEL!;

    let chat;
    if (editFromIndex) {
      chat = getChatById(chatId);
      if (chat && chat.user_id !== userId) {
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      }
      truncateMessagesToCount(chatId, parseInt(editFromIndex));
      chat = getChatById(chatId);
    } else {
      chat = getChatById(chatId);
      if (!chat) {
        createChat(chatId, userId, message.slice(0, 30));
        chat = getChatById(chatId);
      } else if (chat.user_id !== userId) {
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      }
    }

    const history = chat?.messages || [];

    const dbMessage = filesContent
      ? `[Archivos adjuntos]\n\n${message}\n\n---\n${filesContent}`
      : message;
    addMessage(chatId, "user", dbMessage, images);

    const ollamaMessages = buildMessages(history, message, filesContent || undefined);

    if (images.length > 0 && ollamaMessages.length > 0) {
      const lastMsg = ollamaMessages[ollamaMessages.length - 1];
      lastMsg.images = images;
    }

    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    let fullReply = "";

    const streamOllama = async () => {
      try {
        console.log("🤖 Ollama modelo:", model, "| mensajes:", ollamaMessages.length);
        const generator = ollamaChatStream(model, ollamaMessages);
        let cont = 0;
        for await (const chunk of generator) {
          cont++;
          fullReply += chunk;
          await writer.write(encoder.encode(chunk));
        }
        console.log(`🤖 OK: ${cont} chunks, ${fullReply.length} chars`);

        if (!fullReply || fullReply.length < 2) {
          throw new Error("respuesta vacía");
        }
      } catch {
        console.log("⚡ retry con mismo modelo");

        try {
          fullReply = "";
          const retryGen = ollamaChatStream(model, ollamaMessages);
          let cont2 = 0;
          for await (const chunk of retryGen) {
            cont2++;
            fullReply += chunk;
            await writer.write(encoder.encode(chunk));
          }
          console.log(`⚡ Retry OK: ${cont2} chunks, ${fullReply.length} chars`);

          if (!fullReply || fullReply.length < 2) {
            console.log("⚡ Retry vacío también");
            throw new Error("respuesta vacía");
          }
        } catch {
          const fallback = "No se pudo responder.";
          fullReply = fallback;
          await writer.write(encoder.encode(fallback));
        }
      } finally {
        fullReply = fullReply.trim();

        if (fullReply) {
          addMessage(chatId, "assistant", fullReply);
          console.log("💾 DB guardado:", fullReply.length, "chars");
        } else {
          console.log("⚠️ No se guardó en DB (fullReply vacío)");
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

export async function DELETE(req: Request) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    const chat = getChatById(id);
    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }
    if (chat.user_id !== userId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    deleteChat(id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Error al eliminar" }, { status: 500 });
  }
}

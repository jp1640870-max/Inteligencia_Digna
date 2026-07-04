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

const DEV_USER_ID = "soporte-dev-user-id";

export async function GET() {
  const chats = getChatsByUser(DEV_USER_ID);
  return NextResponse.json(chats);
}

export async function POST(req: Request) {
  const userId = DEV_USER_ID;

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

    const isVision = images.length > 0;
    const TEXT_MODEL = process.env.TEXT_MODEL!;
    const VISION_MODEL = process.env.VISION_MODEL!;
    const model = isVision ? VISION_MODEL : TEXT_MODEL;

    let chat;
    if (editFromIndex) {
      truncateMessagesToCount(chatId, parseInt(editFromIndex));
      chat = getChatById(chatId);
    } else {
      chat = getChatById(chatId);
      if (!chat) {
        createChat(chatId, userId, message.slice(0, 30));
        chat = getChatById(chatId);
      }
    }

    const history = chat?.messages || [];

    const dbMessage = filesContent
      ? `[Archivos adjuntos]\n\n${message}\n\n---\n${filesContent}`
      : message;
    addMessage(chatId, "user", dbMessage, images);

    const ollamaMessages = buildMessages(history, message, filesContent || undefined);

    if (isVision && ollamaMessages.length > 0) {
      const lastMsg = ollamaMessages[ollamaMessages.length - 1];
      lastMsg.images = images;
    }

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
        console.log("⚡ retry con mismo modelo");

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
        fullReply = fullReply
          .replace(/<[^>]*>/g, "")
          .replace(/\(.*?\)/g, "")
          .replace(/[^\x00-\x7FáéíóúñÁÉÍÓÚÑ¿¡.,!?()\s]/g, "")
          .trim();

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

export async function DELETE(req: Request) {

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    deleteChat(id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Error al eliminar" }, { status: 500 });
  }
}

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import {
  getChatsByUser,
  getChatById,
  createChat,
  addMessage,
  deleteChat,
  updateChatTitle,
  truncateMessagesToCount,
} from "@/lib/db";
import { ollamaChatStream } from "@/lib/ollama";
import { buildMessages } from "@/lib/prompt-builder";
import { getUserIdFromRequest } from "@/lib/auth";
import { getProjectById } from "@/lib/projects";

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
    const projectId = form.get("projectId") as string | null;

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

    let projectContext = "";

    if (projectId) {
      const project = getProjectById(projectId);
      if (project && project.user_id === userId) {
        const projectFiles = Array.isArray(project.files)
          ? (project.files as Array<{ name: string; content: string }>)
          : [];

        projectContext = `Nombre del proyecto: ${project.name}

Instrucciones del proyecto:
${project.instructions}

Archivos del proyecto:
${projectFiles.map((f) => `Archivo: ${f.name}\n${f.content}`).join("\n\n")}`;
      }
    }

    const dbMessage = filesContent
      ? `[Archivos adjuntos]\n\n${message}\n\n---\n${filesContent}`
      : message;
    addMessage(chatId, "user", dbMessage, images);

    const ollamaMessages = buildMessages(history, message, filesContent || undefined, projectContext || undefined);

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

export async function PATCH(req: Request) {
  const userId = await getUserIdFromRequest();

  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const id = body.id;
    const title = String(body.title || "").trim();

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    if (!title) {
      return NextResponse.json({ error: "Título requerido" }, { status: 400 });
    }

    const chat = getChatById(id);

    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }

    if (chat.user_id !== userId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const updated = updateChatTitle(id, userId, title);

    if (!updated) {
      return NextResponse.json({ error: "No se pudo renombrar" }, { status: 400 });
    }

    return NextResponse.json({ success: true, id, title });
  } catch {
    return NextResponse.json({ error: "Error al renombrar" }, { status: 500 });
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

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { ollamaGenerateImage, buildDetailedImagePrompt } from "@/lib/imagegen";
import { comfyGenerateImage } from "@/lib/comfyui";
import { getChatById, createChat, addMessage } from "@/lib/db";

type HistoryItem = { role: "user" | "ai"; text?: string; images?: string[] };

function buildHistoryContext(history: HistoryItem[], maxItems = 6): string {
  const recent = history
    .filter((m) => m.text && m.text.trim())
    .slice(-maxItems)
    .map((m) => {
      const who = m.role === "user" ? "Usuario" : "Asistente";
      return `${who}: ${m.text}`;
    })
    .join("\n");
  return recent;
}

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const prompt = String(body.prompt || "").trim();
    const chatId = String(body.chatId || "").trim();
    const originalMessage = String(body.originalMessage || prompt).trim();

    if (!prompt) {
      return NextResponse.json(
        { error: "Escribe una instrucción para generar la imagen" },
        { status: 400 }
      );
    }

    // Garantizar que el chat exista para que la imagen se guarde en el historial
    const existingChat = chatId ? getChatById(chatId) : null;
    if (chatId && !existingChat) {
      try {
        createChat(chatId, userId, originalMessage.slice(0, 30) || "Imagen");
      } catch (e) {
        console.log("[api/image] No se pudo crear el chat:", e instanceof Error ? e.message : String(e));
      }
    }

    // Contexto del historial del chat
    const history = existingChat?.messages || (chatId ? getChatById(chatId)?.messages || [] : []);
    let context = "";
    if (Array.isArray(history)) {
      context = buildHistoryContext(history);
    }

    // Sin búsqueda web: las referencias para el prompt de imagen están
    // desactivadas. El prompt se construye solo con el texto del usuario y el
    // contexto del chat.
    const finalPrompt = await buildDetailedImagePrompt(prompt, context, "");
    console.log(`🖼️ Prompt por texto (${finalPrompt.length} chars) -> ComfyUI (SD-Turbo/Qwen)`);

    const { width, height, steps, seed } = body;
    const imgOpts = {
      width: typeof width === "number" ? width : undefined,
      height: typeof height === "number" ? height : undefined,
      steps: typeof steps === "number" ? steps : undefined,
      seed: typeof seed === "number" ? seed : undefined,
    };

    // Backend de generación: ComfyUI con el workflow primario (COMFY_WORKFLOW) y
    // respaldo (COMFY_WORKFLOW_FALLBACK). El fallback a Ollama está desactivado
    // (OLLAMA ya no tiene modelos de imagen); solo se activa con
    // IMAGE_FALLBACK_OLLAMA=1.
    const backend = (process.env.IMAGE_BACKEND || "comfyui").toLowerCase();
    const allowOllamaFallback = process.env.IMAGE_FALLBACK_OLLAMA === "1";
    let image: string;
    if (backend === "comfyui" && process.env.COMFY_URL) {
      try {
        image = await comfyGenerateImage(finalPrompt, imgOpts);
        console.log(`🖼️ Imagen generada con ComfyUI (SD-Turbo primario / Qwen respaldo)`);
      } catch (comfyErr) {
        const msg = comfyErr instanceof Error ? comfyErr.message : String(comfyErr);
        if (allowOllamaFallback) {
          console.error(`🖼️ ComfyUI falló, fallback a Ollama: ${msg}`);
          image = await ollamaGenerateImage(finalPrompt, imgOpts);
        } else {
          console.error(`🖼️ ComfyUI falló: ${msg}`);
          throw new Error(msg);
        }
      }
    } else {
      image = await ollamaGenerateImage(finalPrompt, imgOpts);
    }

    if (chatId) {
      try {
        addMessage(chatId, "user", `🖼️ ${originalMessage}`);
        addMessage(chatId, "assistant", "Imagen generada", [image]);
      } catch (e) {
        console.log("[api/image] No se pudo guardar el mensaje:", e instanceof Error ? e.message : String(e));
      }
    }

    return NextResponse.json({ success: true, image });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/image]", msg);
    return NextResponse.json(
      {
        error: `No se pudo generar la imagen. ${msg}`,
        hint: "La generación de imágenes usa ComfyUI con SD-Turbo (COMFY_WORKFLOW) y respaldo Qwen Image 2.1 (COMFY_WORKFLOW_FALLBACK). Verifica que ComfyUI esté corriendo en el DGX (servicio comfyui; crontab @reboot) y que el puerto 8188 esté abierto.",
      },
      { status: 500 }
    );
  }
}
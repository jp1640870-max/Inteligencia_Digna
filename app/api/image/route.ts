export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { ollamaGenerateImage, buildDetailedImagePrompt } from "@/lib/imagegen";
import { comfyGenerateImage } from "@/lib/comfyui";
import { flux2GenerateImage, type Flux2Reference } from "@/lib/flux2-klein";
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

    // Imágenes de referencia para edición (data URLs o base64). Se aceptan en
    // `referenceImages`, `references` o `images` (adjuntos del chat).
    const rawReferences = [
      ...(Array.isArray(body.referenceImages) ? body.referenceImages : []),
      ...(Array.isArray(body.references) ? body.references : []),
      ...(Array.isArray(body.images) ? body.images : []),
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

    const references: Flux2Reference[] = Array.from(new Set(rawReferences)).map(
      (data, index) => ({ data, filename: `referencia-${index + 1}` })
    );

    // En edición con referencia el prompt es la instrucción directa (sin
    // reescribirlo) para no perder la intención del cambio. En texto→imagen se
    // enriquece con el contexto del chat.
    const finalPrompt =
      references.length > 0
        ? prompt
        : await buildDetailedImagePrompt(prompt, context, "");
    console.log(
      `🖼️ Prompt (${finalPrompt.length} chars, ${references.length} referencia(s)) -> FLUX.2 Klein 4B`
    );

    const { width, height, steps, seed } = body;
    const imgOpts = {
      width: typeof width === "number" ? width : undefined,
      height: typeof height === "number" ? height : undefined,
      steps: typeof steps === "number" ? steps : undefined,
      seed: typeof seed === "number" ? seed : undefined,
    };

    // Backend de generación. Por defecto FLUX.2 Klein 4B vía ComfyUI (T2I o
    // edición con referencias). IMAGE_BACKEND=comfyui conserva los workflows
    // antiguos (SD-Turbo/Qwen) y el fallback a Ollama solo se activa con
    // IMAGE_FALLBACK_OLLAMA=1.
    const backend = (process.env.IMAGE_BACKEND || "flux2-klein").toLowerCase();
    const allowOllamaFallback = process.env.IMAGE_FALLBACK_OLLAMA === "1";
    const isFlux2 =
      backend === "flux2" ||
      backend === "flux2-klein" ||
      backend === "flux2_klein";

    let image: string;
    if (isFlux2) {
      if (!process.env.COMFY_URL) {
        throw new Error(
          "FLUX.2 Klein requiere COMFY_URL (por defecto http://127.0.0.1:8188 con el túnel SSH)."
        );
      }
      image = await flux2GenerateImage(finalPrompt, {
        ...imgOpts,
        references,
      });
      console.log(
        `🖼️ Imagen generada con FLUX.2 Klein 4B (${
          references.length > 0 ? "edición con referencia" : "texto→imagen"
        })`
      );
    } else if (backend === "comfyui" && process.env.COMFY_URL) {
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
        hint: "La generación de imágenes usa FLUX.2 Klein 4B vía ComfyUI (FLUX2_UNET/FLUX2_CLIP/FLUX2_VAE). Verifica que ComfyUI esté corriendo en el DGX (puerto 8188) y que COMFY_URL sea accesible: con el túnel SSH usa http://127.0.0.1:8188 (scripts/comfy-tunnel.ps1).",
      },
      { status: 500 }
    );
  }
}
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { extractText } from "@/lib/file-processor";
import { getUserIdFromRequest } from "@/lib/auth";
import { getChatById } from "@/lib/db";
import { getProjectById } from "@/lib/projects";
import { indexDocument } from "@/lib/rag";

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest();
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  try {
    const form = await req.formData();
    const files = form.getAll("files") as File[];
    const chatId = (form.get("chatId") as string) || null;
    const projectId = (form.get("projectId") as string) || null;
    const maxBytes = Math.max(1, Number(process.env.MAX_UPLOAD_MB || "20")) * 1024 * 1024;

    if (chatId) {
      const chat = await getChatById(chatId);
      if (!chat || chat.user_id !== userId) return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }
    if (projectId) {
      const project = await getProjectById(projectId);
      if (!project || project.user_id !== userId) return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
    }

    const results: Array<{ name: string; type: string; content: string; size: number }> = [];
    for (const file of files) {
      if (file.size > maxBytes) {
        return NextResponse.json({ error: `El archivo ${file.name} excede el límite permitido` }, { status: 413 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const content = await extractText(buffer, file.name);
      results.push({
        name: file.name,
        type: file.name.split(".").pop()?.toLowerCase() || "unknown",
        content,
        size: file.size,
      });
    }

    if (chatId) {
      for (const file of results) {
        if (file.content.length > 50) {
          await indexDocument(chatId, userId, file.name, file.content, projectId || undefined);
        }
      }
    }

    return NextResponse.json({ files: results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Error al procesar archivos" }, { status: 500 });
  }
}

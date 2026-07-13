export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { extractText } from "@/lib/file-processor";
import { getUserIdFromRequest } from "@/lib/auth";
import { indexDocument } from "@/lib/rag";

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const filesEntry = form.getAll("files") as File[];
    const chatId = (form.get("chatId") as string) || null;
    const projectId = (form.get("projectId") as string) || null;
    const results: Array<{ name: string; type: string; content: string; size: number }> = [];

    for (const file of filesEntry) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const content = await extractText(buffer, file.name);
      results.push({
        name: file.name,
        type: file.name.split(".").pop()?.toLowerCase() || "unknown",
        content,
        size: file.size,
      });
    }

    // Index each file for RAG (fire and forget — non-blocking)
    if (chatId) {
      for (const file of results) {
        if (file.content && file.content.length > 50) {
          indexDocument(chatId, userId, file.name, file.content, projectId || undefined)
            .then(() => console.log(`📚 RAG indexado: ${file.name}`))
            .catch((e) => console.log(`📚 RAG error indexing ${file.name}: ${e}`));
        }
      }
    }

    return NextResponse.json({ files: results });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Error al procesar archivos" }, { status: 500 });
  }
}

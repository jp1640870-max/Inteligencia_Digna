export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { editDocument } from "@/lib/document-editor";

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const instruction = (form.get("instruction") as string) || "";
    const chatId = form.get("chatId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No se recibió ningún archivo" }, { status: 400 });
    }

    if (!instruction.trim()) {
      return NextResponse.json({ error: "Instrucción de edición requerida" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { result, buffer: modifiedBuffer } = await editDocument(buffer, file.name, instruction);

    if (!result.success || !modifiedBuffer) {
      return NextResponse.json(
        { error: result.error || "No se pudo editar el documento" },
        { status: 422 }
      );
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const contentTypeMap: Record<string, string> = {
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      xls: "application/vnd.ms-excel",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pdf: "application/pdf",
    };

    return new Response(new Uint8Array(modifiedBuffer), {
      headers: {
        "Content-Type": contentTypeMap[ext] || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${result.filename}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
        "Cache-Control": "no-store",
        "X-Edit-Result": JSON.stringify({
          success: true,
          format: result.format,
          changesCount: result.changesCount,
          originalName: result.originalName,
        }),
      },
    });
  } catch (e) {
    console.error("Error editing document:", e);
    return NextResponse.json(
      { error: "Error al procesar la edición del documento" },
      { status: 500 }
    );
  }
}

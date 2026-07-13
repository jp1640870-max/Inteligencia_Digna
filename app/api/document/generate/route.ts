export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { generateDocument } from "@/lib/document-generator";
import type { DocGenStructure } from "@/types";

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const structure = body.structure as DocGenStructure | undefined;

    if (!structure) {
      return NextResponse.json({ error: "Estructura del documento requerida" }, { status: 400 });
    }

    if (!structure.format || !["xlsx", "docx", "pdf"].includes(structure.format)) {
      return NextResponse.json({ error: "Formato no soportado. Usa xlsx, docx o pdf" }, { status: 400 });
    }

    if (!structure.filename) {
      structure.filename = `documento.${structure.format}`;
    }

    const { buffer, filename } = await generateDocument(structure);

    const contentTypeMap: Record<string, string> = {
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pdf: "application/pdf",
    };

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentTypeMap[structure.format] || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
        "X-Gen-Result": JSON.stringify({
          success: true,
          format: structure.format,
          filename,
          changesCount: structure.sheets?.[0]?.rows?.length || structure.content?.length || 0,
        }),
      },
    });
  } catch (e) {
    console.error("Error generating document:", e);
    return NextResponse.json(
      { error: "Error al generar el documento" },
      { status: 500 }
    );
  }
}

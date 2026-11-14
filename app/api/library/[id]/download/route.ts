export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { getGeneratedDocumentById } from "@/lib/db";
import { getObject } from "@/lib/storage";
import {
  contentDispositionHeader,
  documentMimeType,
} from "@/lib/generated-document";
import { isValidUuid } from "@/lib/uuid";

/**
 * Descarga el binario de un documento generado (solo el dueño).
 *
 * `?format=docx` devuelve el DOCX fuente cuando el principal es PDF.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  }
  const document = await getGeneratedDocumentById(id);
  if (!document) {
    return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  }
  if (document.user_id !== userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  if (document.status !== "ready") {
    return NextResponse.json(
      { error: "El documento no está listo para descargar" },
      { status: 409 },
    );
  }

  const { searchParams } = new URL(req.url);
  const wantsDocx =
    searchParams.get("format")?.toLowerCase() === "docx" &&
    Boolean(document.docx_object_key);
  const objectKey = wantsDocx ? document.docx_object_key! : document.object_key;
  const filename = wantsDocx
    ? document.filename.replace(/\.pdf$/i, ".docx")
    : document.filename;
  const mimeType = wantsDocx ? documentMimeType("docx") : document.mime_type;

  let buffer: Buffer;
  try {
    buffer = await getObject(objectKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[library/download] No se pudo leer ${objectKey}: ${message}`);
    const notFound = /NoSuchKey|NotFound|404/.test(message);
    return NextResponse.json(
      {
        error: notFound
          ? "El archivo almacenado no existe en el bucket."
          : "El storage de archivos no está disponible.",
        detail: message,
      },
      { status: notFound ? 404 : 503 },
    );
  }

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(buffer.length),
      "Content-Disposition": contentDispositionHeader("attachment", filename),
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

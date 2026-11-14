export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { getGeneratedDocumentById } from "@/lib/db";
import { getObject } from "@/lib/storage";
import { contentDispositionHeader } from "@/lib/generated-document";
import { isValidUuid } from "@/lib/uuid";

/**
 * Vista previa inline de un documento generado (solo el dueño).
 *
 * Sirve el binario con `Content-Disposition: inline` para que se pueda
 * mostrar en un `<iframe>` o `<embed>`. PDF funciona nativamente; DOCX/XLSX
 * dependen del visor del navegador o de una conversión previa.
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
      { error: "El documento no está listo para vista previa" },
      { status: 409 },
    );
  }

  let buffer: Buffer;
  try {
    buffer = await getObject(document.object_key);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[library/preview] No se pudo leer ${document.object_key}: ${message}`);
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
      "Content-Type": document.mime_type,
      "Content-Length": String(buffer.length),
      "Content-Disposition": contentDispositionHeader("inline", document.filename),
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

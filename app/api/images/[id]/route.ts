export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { getGeneratedImageById } from "@/lib/images/repository";
import { getObject } from "@/lib/storage";
import { isValidUuid } from "@/lib/uuid";

function contentDisposition(kind: "inline" | "attachment", filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Sirve una imagen generada. Solo el dueño puede leerla. */
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
    return NextResponse.json({ error: "Imagen no encontrada" }, { status: 404 });
  }

  const found = await getGeneratedImageById(id);
  if (!found) {
    return NextResponse.json({ error: "Imagen no encontrada" }, { status: 404 });
  }
  if (found.user_id !== userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  let buffer: Buffer;
  try {
    buffer = await getObject(found.object_key);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const notFound = /NoSuchKey|NotFound|404/.test(message);
    return NextResponse.json(
      {
        error: notFound
          ? "La imagen no existe en el almacenamiento."
          : "El almacenamiento de imágenes no está disponible.",
        detail: message,
      },
      { status: notFound ? 404 : 503 },
    );
  }

  const { searchParams } = new URL(req.url);
  const download = searchParams.get("download") === "1";

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": found.mime_type || "image/png",
      "Content-Length": String(buffer.length),
      "Content-Disposition": contentDisposition(
        download ? "attachment" : "inline",
        found.original_filename,
      ),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

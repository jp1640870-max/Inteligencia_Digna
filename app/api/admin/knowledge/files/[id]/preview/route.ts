export const runtime = "nodejs";

import { NextResponse } from "next/server";
import {
  requireCapability,
} from "@/lib/auth";
import { userCanReadKbFile } from "@/lib/kb-access";
import { getKbFileById, logAudit, toKbFileSummary } from "@/lib/db";
import { clientIp } from "@/lib/request";

/**
 * Vista previa de un archivo: metadatos + texto extraído, bajo demanda.
 *
 * El listado ya no incluye `content`, porque un panel con 500 documentos
 * volcaba la KB entera por el socket sin que nadie la pidiera. Aquí sí se
 * devuelve, y por eso queda auditado: leer el contenido es un acceso a dato,
 * no una lectura de interfaz.
 *
 * `kb.read` solo dice que el rol entra a la lectura. Lo que decide si este
 * archivo concreto sale es `userCanReadKbFile`: un `editor` sin grant no
 * puede ver el texto de documentos ajenos, y el bypass del perímetro no se
 * aplica en un endpoint que devuelve contenido.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { allowed, status, user } = await requireCapability("kb.read");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { id } = await params;
  const file = await getKbFileById(id);
  if (!file) {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
  }

  if (!(await userCanReadKbFile(user, file.id))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  await logAudit(user.id, "kb.preview", `Vista previa del archivo: "${file.filename}"`, clientIp(req));

  return NextResponse.json({
    file: toKbFileSummary(file),
    content: file.content,
    truncated: false,
  });
}

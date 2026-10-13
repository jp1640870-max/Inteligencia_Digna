import {
  requireCapability,
} from "@/lib/auth";
import { userCanReadKbFile } from "@/lib/kb-access";
import { getAttachmentsByKbFile, getKbFileById, logAudit } from "@/lib/db";
import { getObject } from "@/lib/storage";
import { clientIp } from "@/lib/request";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, status, user } = await requireCapability("kb.read");
  if (!allowed || !user) return Response.json({ error: "No autorizado" }, { status });
  const { id } = await params;
  const file = await getKbFileById(id);
  if (!file) return Response.json({ error: "Archivo no encontrado" }, { status: 404 });

  // Misma comprobación que la vista previa y por el mismo motivo: aquí sale el
  // original entero, no un fragmento. `kb.read` autoriza a leer la KB; este
  // predicado dice de qué archivo.
  if (!(await userCanReadKbFile(user, file.id))) {
    return Response.json({ error: "No autorizado" }, { status: 403 });
  }

  // Descargar el original es la lectura más sensible del panel: sale el
  // contenido íntegro, no un fragmento. Queda en el audit_log quién y qué.
  await logAudit(user.id, "kb.download", `Descarga del archivo: "${file.filename}"`, clientIp(req));
  const attachments = await getAttachmentsByKbFile(id);
  const attachment = attachments[0];
  if (!attachment) return Response.json({ error: "El archivo no tiene objeto almacenado" }, { status: 404 });

  let buffer: Buffer;
  try {
    buffer = await getObject(attachment.object_key);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[kb/download] No se pudo leer ${attachment.object_key}: ${message}`);
    const notFound = /NoSuchKey|NotFound|404/.test(message);
    return Response.json(
      {
        error: notFound
          ? "El archivo almacenado no existe en el bucket de storage."
          : "El storage de archivos no está disponible. Verifica que MinIO/S3 esté levantado.",
        detail: message,
      },
      { status: notFound ? 404 : 503 },
    );
  }

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": attachment.mime_type,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.original_filename)}"`,
      "Cache-Control": "no-store",
    },
  });
}

import { requireRole } from "@/lib/auth";
import { getAttachmentsByKbFile, getKbFileById } from "@/lib/db";
import { getObject } from "@/lib/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed } = await requireRole(["super_admin", "admin", "editor"]);
  if (!allowed) return Response.json({ error: "No autorizado" }, { status: 403 });
  const { id } = await params;
  const file = await getKbFileById(id);
  if (!file) return Response.json({ error: "Archivo no encontrado" }, { status: 404 });
  const attachments = await getAttachmentsByKbFile(id);
  const attachment = attachments[0];
  if (!attachment) return Response.json({ error: "El archivo no tiene objeto almacenado" }, { status: 404 });
  const buffer = await getObject(attachment.object_key);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": attachment.mime_type,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.original_filename)}"`,
      "Cache-Control": "no-store",
    },
  });
}

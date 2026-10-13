import { NextResponse } from "next/server";
import {
  requireCapability,
} from "@/lib/auth";
import {
  getKbAccessGrants,
  getKbFileById,
  getAreaById,
  getUserGroupById,
  grantKbFileAccessBulk,
  logAudit,
  revokeKbFileAccessBulk,
} from "@/lib/db";
import type { PrincipalType } from "@/types";

/**
 * Otorgamiento y revocación de lectura sobre archivos de la KB.
 *
 * Reservado al perímetro (`admin` y `super_admin`). `editor` prepara contenido
 * pero no decide quién lo lee: si pudiera otorgar, su subida quedaría
 * accesible por su propia decisión sin nadie más que lo validara.
 *
 * Concede o revoca un archivo cada vez, aunque el frontend pueda enviar varios.
 * El motivo es de auditoría: "se le da a Legal el documento X" es una decisión
 * legible; "se le sincronizaron 40 categorías" no lo es.
 */
export async function POST(req: Request) {
  const { allowed, status, user } = await requireCapability("kb.grants");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const body = await req.json();
  const action = body.action === "revoke" ? "revoke" : "grant";
  const principalType = body.principalType;
  const principalId = typeof body.principalId === "string" ? body.principalId : "";
  const fileIds = Array.isArray(body.fileIds)
    ? body.fileIds.filter((id: unknown): id is string => typeof id === "string")
    : [];

  if (principalType !== "area" && principalType !== "group") {
    return NextResponse.json(
      { error: "principalType debe ser 'area' o 'group'" },
      { status: 400 },
    );
  }
  if (!principalId) {
    return NextResponse.json({ error: "principalId es requerido" }, { status: 400 });
  }
  if (fileIds.length === 0) {
    return NextResponse.json({ error: "Selecciona al menos un archivo" }, { status: 400 });
  }

  const principal =
    principalType === "area" ? await getAreaById(principalId) : await getUserGroupById(principalId);
  if (!principal) {
    return NextResponse.json({ error: "El área o grupo no existe" }, { status: 404 });
  }
  // Solo bloquear el principal al conceder. Al revocar debe permitirse:
  // desactivar un área es justamente el mecanismo de urgencia, y si la
  // revocación quedara bloqueada el operador tendría que reactivar el área
  // para poder dejarla sin acceso, que es lo contrario de un apagado rápido.
  if (action === "grant" && !principal.is_active) {
    return NextResponse.json(
      { error: `${principal.name} está desactivado: reactívalo antes de conceder acceso` },
      { status: 409 },
    );
  }

  // Resolver nombres antes de tocar nada, para que el audit_log guarde texto
  // legible y no una lista de UUIDs.
  const names = await resolveFilenames(fileIds, action);
  if (names.length === 0) {
    return NextResponse.json({ error: "Ninguno de los archivos existe" }, { status: 404 });
  }

  const principalLabel = `${principal.name} (${principal.key})`;

  if (action === "revoke") {
    const count = await revokeKbFileAccessBulk({
      principalType: principalType as PrincipalType,
      principalId,
      kbFileIds: names.map((entry) => entry.id),
    });
    await logAudit(
      user.id,
      "kb.access_revoke",
      `Acceso revocado a ${principalLabel} en ${count} archivo(s): ${names
        .map((entry) => entry.filename)
        .join(", ")}`,
      "",
    );
    return NextResponse.json({ success: true, affected: count, action });
  }

  const count = await grantKbFileAccessBulk({
    principalType: principalType as PrincipalType,
    principalId,
    kbFileIds: names.map((entry) => entry.id),
    grantedBy: user.id,
  });
  await logAudit(
    user.id,
    "kb.access_grant",
    `Acceso concedido a ${principalLabel} en ${count} archivo(s): ${names
      .map((entry) => entry.filename)
      .join(", ")}`,
    "",
  );
  return NextResponse.json({ success: true, affected: count, action });
}

/** Grants de un archivo, para pintar la interfaz de accesos. */
export async function GET(req: Request) {
  const { allowed, status, user } = await requireCapability("kb.grants");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const url = new URL(req.url);
  const fileId = url.searchParams.get("fileId");
  const principalId = url.searchParams.get("principalId");
  const principalType = url.searchParams.get("principalType");

  if (!fileId && !principalId) {
    return NextResponse.json({ error: "Indica fileId o principalId" }, { status: 400 });
  }

  const grants = await getKbAccessGrants({
    fileId: fileId ?? undefined,
    principalId: principalId ?? undefined,
    principalType:
      principalType === "area" || principalType === "group" ? principalType : undefined,
  });
  return NextResponse.json({ grants });
}

/**
 * Resuelve los archivos a nombre legible para el audit_log.
 *
 * En modo `grant` se descarta todo lo que no esté `active`: publicar no es
 * lo mismo que legible.
 *
 * Conceder acceso a un `pending_review` haría que un documento no aprobado
 * fuera legible sin pasar por la cola de revisión. Además se filtra aquí en
 * vez de confiar en el botón de la UI, porque la UI no es el límite de seguridad.
 */
async function resolveFilenames(
  fileIds: string[],
  mode: "grant" | "revoke",
): Promise<Array<{ id: string; filename: string }>> {
  const results: Array<{ id: string; filename: string }> = [];
  for (const id of fileIds) {
    // getKbFileById para reutilizar la normalización y no duplicar el SQL.
    const file = await getKbFileById(id);
    if (!file) continue;
    if (mode === "grant" && file.status !== "active") continue;
    results.push({ id: file.id, filename: file.filename });
  }
  return results;
}

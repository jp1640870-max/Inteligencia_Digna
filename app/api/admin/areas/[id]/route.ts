import { NextResponse } from "next/server";
import {
  requireCapability,
} from "@/lib/auth";
import { deactivateArea, getAreaById, getKbAccessGrants, getAreaMemberIds, updateArea, logAudit } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Detalle de un área, con sus miembros y sus grants.
 *
 * Restringido al perímetro porque la respuesta incluye la lista de grants: qué
 * documentos están concedidos a esta área y quién los aprobó. `editor` puede
 * ver el catálogo de áreas (`org.read`) porque lo necesita para trabajar, pero
 * no necesita el detalle de la ACL, y por eso esta ruta no lo admite. La
 * pantalla de Accesos, que sí lo necesita, es de perímetro.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { allowed, status } = await requireCapability("org.read.detail");
  if (!allowed) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { id } = await ctx.params;
  const area = await getAreaById(id);
  if (!area) {
    return NextResponse.json({ error: "Área no encontrada" }, { status: 404 });
  }

  const [memberIds, grants] = await Promise.all([
    getAreaMemberIds(id),
    getKbAccessGrants({ principalType: "area", principalId: id }),
  ]);
  return NextResponse.json({ area, memberIds, grants });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { allowed, status, user } = await requireCapability("org.manage");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { id } = await ctx.params;
  const body = await req.json();

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.description === "string") patch.description = body.description.trim();
  if (typeof body.is_active === "boolean") patch.is_active = body.is_active;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
  }

  const ok = await updateArea(id, patch);
  if (!ok) {
    return NextResponse.json({ error: "Área no encontrada" }, { status: 404 });
  }

  const area = await getAreaById(id);
  await logAudit(
    user.id,
    "area.update",
    `Área actualizada: ${area?.name ?? id} (${Object.keys(patch).join(", ")})`,
    "",
  );
  return NextResponse.json({ success: true, area });
}

/**
 * Desactivar, no borrar.
 *
 * Los grants sobreviven a la desactivación porque `principal_id` no lleva FK
 * (es polimórfico con grupos). Si borráramos la fila, el rastro de auditoría
 * quedaría apuntando a un área inexistente y no sabríamos quién tenía acceso.
 * Al reactivar el área, los permisos vuelven como estaban.
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { allowed, status, user } = await requireCapability("org.manage");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { id } = await ctx.params;
  const area = await getAreaById(id);
  if (!area) {
    return NextResponse.json({ error: "Área no encontrada" }, { status: 404 });
  }

  const ok = await deactivateArea(id);
  if (!ok) {
    return NextResponse.json({ error: "No se pudo desactivar el área" }, { status: 500 });
  }

  await logAudit(
    user.id,
    "area.deactivate",
    `Área desactivada: ${area.name} (${area.key}). Sus grants dejan de resolver acceso.`,
    "",
  );
  return NextResponse.json({ success: true });
}

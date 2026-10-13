import { NextResponse } from "next/server";
import {
  requireCapability,
} from "@/lib/auth";
import {
  deactivateUserGroup,
  getGroupMemberIds,
  getKbAccessGrants,
  getUserGroupById,
  logAudit,
  updateUserGroup,
} from "@/lib/db";
import { query } from "@/lib/db-connection";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Detalle de un grupo, con sus miembros y sus grants.
 *
 * Perímetro, por el mismo motivo que el detalle de un área: la respuesta
 * incluye la ACL del grupo.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { allowed, status } = await requireCapability("org.read.detail");
  if (!allowed) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { id } = await ctx.params;
  const group = await getUserGroupById(id);
  if (!group) {
    return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });
  }

  const [userIds, grants] = await Promise.all([
    getGroupMemberIds(id),
    getKbAccessGrants({ principalType: "group", principalId: id }),
  ]);

  let members: unknown[] = [];
  if (userIds.length > 0) {
    const result = await query(
      `SELECT u.id, u.email, u.name, u.role
         FROM users u
        WHERE u.id = ANY($1::uuid[])
        ORDER BY u.email`,
      [userIds],
    );
    members = result.rows;
  }

  return NextResponse.json({ group, members, grants });
}

/**
 * Edición de un grupo.
 *
 * `is_active` no se acepta aquí a propósito. Desactivar un grupo revoca sus
 * grants, y esa operación la hace `deactivateUserGroup` en transacción; si el
 * PATCH también pudiera bajarlo, desactivar un grupo dejaría de significar
 * "revoca" en cuanto el operador usara una ruta en vez de otra. Además
 * `updateUserGroup` ya no incluye `is_active` entre los campos actualizables, así
 * que la invariante no depende de esta comprobación: depende de que la única
 * forma de desactivarlo sea esta que la cumple.
 *
 * Devolver 400 y no ignorar el campo en silencio, porque un PATCH que dice
 * `is_active: false` y responde 200 deja a quien lo llamó creyendo que el
 * acceso está cortado cuando no lo está.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { allowed, status, user } = await requireCapability("org.manage");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { id } = await ctx.params;
  const body = await req.json();

  if (typeof body.is_active === "boolean") {
    return NextResponse.json(
      { error: "Para desactivar un grupo usa DELETE: la desactivación revoca sus grants" },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.description === "string") patch.description = body.description.trim();

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
  }

  const ok = await updateUserGroup(id, patch);
  if (!ok) {
    return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });
  }

  const group = await getUserGroupById(id);
  await logAudit(
    user.id,
    "group.update",
    `Grupo actualizado: ${group?.name ?? id} (${Object.keys(patch).join(", ")})`,
    "",
  );
  return NextResponse.json({ success: true, group });
}

/**
 * Desactivar un grupo revoca sus grants, a diferencia de las áreas.
 *
 * La asimetría es intencionada: un área es una organización de la que hay que
 * poder conservar el histórico, mientras que un grupo transversal es un recurso
 * puntual. Aun así, desactivar basta para cortar el acceso; borrar los grants
 * deja el `audit_log` legible con nombres en lugar de ids huérfanos.
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { allowed, status, user } = await requireCapability("org.manage");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { id } = await ctx.params;
  const group = await getUserGroupById(id);
  if (!group) {
    return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });
  }
  if (group.is_system) {
    return NextResponse.json(
      { error: "Los grupos del sistema no se pueden desactivar" },
      { status: 403 },
    );
  }

  const ok = await deactivateUserGroup(id);
  if (!ok) {
    return NextResponse.json({ error: "No se pudo desactivar el grupo" }, { status: 500 });
  }

  await logAudit(
    user.id,
    "group.deactivate",
    `Grupo desactivado: ${group.name} (${group.key}). Se revocaron sus grants.`,
    "",
  );
  return NextResponse.json({ success: true });
}

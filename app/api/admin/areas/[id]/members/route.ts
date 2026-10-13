import { NextResponse } from "next/server";
import {
  requireCapability,
} from "@/lib/auth";
import { addAreaMember, getAreaById, getAreaMemberIds, logAudit, removeAreaMember } from "@/lib/db";
import { query } from "@/lib/db-connection";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Altas y bajas de un área.
 *
 * Entrar en un área no es lo mismo que obtener acceso: solo recupera los grants
 * que el área ya tiene. Quien entra sin que el área tenga ningún grant se queda
 * sin leer la KB (fail closed), y eso es intencional: el segundo control es el
 * grant.
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

  const userIds = await getAreaMemberIds(id);
  if (userIds.length === 0) return NextResponse.json({ area, members: [] });

  const members = await query(
    `SELECT u.id, u.email, u.name, u.role
       FROM users u
      WHERE u.id = ANY($1::uuid[])
      ORDER BY u.email`,
    [userIds],
  );
  return NextResponse.json({ area, members: members.rows });
}

export async function POST(req: Request, ctx: Ctx) {
  const { allowed, status, user } = await requireCapability("org.manage");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { id } = await ctx.params;
  const body = await req.json();
  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!userId) {
    return NextResponse.json({ error: "userId es requerido" }, { status: 400 });
  }

  const area = await getAreaById(id);
  if (!area) {
    return NextResponse.json({ error: "Área no encontrada" }, { status: 404 });
  }

  const target = await query<{ email: string; role: string }>(
    "SELECT email, role FROM users WHERE id = $1",
    [userId],
  );
  if (!target.rows[0]) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  const added = await addAreaMember(id, userId, user.id);
  await logAudit(
    user.id,
    "area.member_add",
    `${target.rows[0].email} añadido a ${area.name} (${area.key})`,
    "",
  );

  return NextResponse.json({
    success: true,
    added,
    // Idempotente: si ya era miembro, `added` es false pero el alta no es un error.
    detail: added
      ? `${target.rows[0].email} accede ahora a los ${await countAreaGrants(id)} archivos concedidos al área.`
      : "El usuario ya pertenecía al área.",
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { allowed, status, user } = await requireCapability("org.manage");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { id } = await ctx.params;
  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  if (!userId) {
    return NextResponse.json({ error: "userId es requerido" }, { status: 400 });
  }

  const area = await getAreaById(id);
  if (!area) {
    return NextResponse.json({ error: "Área no encontrada" }, { status: 404 });
  }

  const target = await query<{ email: string }>("SELECT email FROM users WHERE id = $1", [userId]);
  const removed = await removeAreaMember(id, userId);
  if (!removed) {
    return NextResponse.json({ error: "El usuario no pertenecía al área" }, { status: 404 });
  }

  await logAudit(
    user.id,
    "area.member_remove",
    `${target.rows[0]?.email ?? userId} retirado de ${area.name} (${area.key}). Pierde el acceso heredado del área.`,
    "",
  );
  return NextResponse.json({ success: true });
}

async function countAreaGrants(areaId: string): Promise<number> {
  const result = await query<{ count: number }>(
    "SELECT count(*)::int AS count FROM kb_access_grants WHERE principal_type = 'area' AND principal_id = $1",
    [areaId],
  );
  return result.rows[0]?.count ?? 0;
}

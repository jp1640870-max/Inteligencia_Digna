import { NextResponse } from "next/server";
import {
  requireCapability,
} from "@/lib/auth";
import { addGroupMember, getGroupMemberIds, getUserGroupById, logAudit, removeGroupMember } from "@/lib/db";
import { query } from "@/lib/db-connection";

type Ctx = { params: Promise<{ id: string }> };

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

  const userIds = await getGroupMemberIds(id);
  if (userIds.length === 0) return NextResponse.json({ group, members: [] });

  const members = await query(
    `SELECT u.id, u.email, u.name, u.role
       FROM users u
      WHERE u.id = ANY($1::uuid[])
      ORDER BY u.email`,
    [userIds],
  );
  return NextResponse.json({ group, members: members.rows });
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

  const group = await getUserGroupById(id);
  if (!group) {
    return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });
  }

  const target = await query<{ email: string }>("SELECT email FROM users WHERE id = $1", [userId]);
  if (!target.rows[0]) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  const added = await addGroupMember(id, userId, user.id);
  await logAudit(
    user.id,
    "group.member_add",
    `${target.rows[0].email} añadido a ${group.name} (${group.key})`,
    "",
  );

  return NextResponse.json({
    success: true,
    added,
    detail: added
      ? `${target.rows[0].email} accede ahora a los archivos concedidos al grupo.`
      : "El usuario ya pertenecía al grupo.",
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

  const group = await getUserGroupById(id);
  if (!group) {
    return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });
  }

  const target = await query<{ email: string }>("SELECT email FROM users WHERE id = $1", [userId]);
  const removed = await removeGroupMember(id, userId);
  if (!removed) {
    return NextResponse.json({ error: "El usuario no pertenecía al grupo" }, { status: 404 });
  }

  await logAudit(
    user.id,
    "group.member_remove",
    `${target.rows[0]?.email ?? userId} retirado de ${group.name} (${group.key})`,
    "",
  );
  return NextResponse.json({ success: true });
}

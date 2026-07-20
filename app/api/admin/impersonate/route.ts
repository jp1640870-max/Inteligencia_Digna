import { NextResponse } from "next/server";
import { requireRole, signToken } from "@/lib/auth";
import { getUserById, logAudit } from "@/lib/db";

export async function POST(req: Request) {
  const { allowed, user } = await requireRole(["super_admin"]);
  if (!allowed || !user) {
    return NextResponse.json({ error: "Solo super_admin puede impersonar" }, { status: 403 });
  }

  const { targetUserId } = await req.json();
  if (!targetUserId) {
    return NextResponse.json({ error: "targetUserId requerido" }, { status: 400 });
  }

  if (targetUserId === user.id) {
    return NextResponse.json({ error: "No puedes impersonarte a ti mismo" }, { status: 400 });
  }

  const target = getUserById(targetUserId);
  if (!target) {
    return NextResponse.json({ error: "Usuario target no existe" }, { status: 404 });
  }

  // Generar token de impersonación
  const token = signToken({
    userId: target.id,
    email: target.email,
    role: target.role || "user",
  });

  logAudit(user.id, "impersonate", `Admin impersonó a ${target.email}`, req.headers.get("x-forwarded-for") || "");

  return NextResponse.json({
    token,
    user: {
      id: target.id,
      email: target.email,
      name: target.name,
      role: target.role || "user",
    },
    message: `Ahora eres ${target.email}. Para volver a tu cuenta, cierra sesión y vuelve a entrar.`,
  });
}

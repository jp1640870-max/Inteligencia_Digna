import { NextResponse } from "next/server";
import { requireRole, hashPassword, canManageUser, canViewUser, isUserRole, canAssignRole } from "@/lib/auth";
import { updateUserRole, updateUserPassword, deleteUserById, getUserById, getUserByIdFull, logAudit } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, user: caller } = await requireRole(["super_admin", "admin", "editor", "viewer"]);
  if (!allowed || !caller) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const target = await getUserById(id);

  if (!target) {
    return NextResponse.json({ error: "Usuario no existe" }, { status: 404 });
  }

  // Super_admin es invisible para todos excepto sí mismo
  if (!canViewUser(caller.role, target.role, caller.id, target.id)) {
    return NextResponse.json({ error: "Usuario no existe" }, { status: 404 });
  }

  const user = await getUserByIdFull(id);
  if (!user) {
    return NextResponse.json({ error: "Usuario no existe" }, { status: 404 });
  }

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    picture: user.picture,
    google_id: user.google_id,
    created_at: user.created_at,
    projectCount: user.projectCount,
    chatCount: user.chatCount,
    recentChats: user.recentChats,
    recentProjects: user.recentProjects,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, user: caller } = await requireRole(["super_admin", "admin", "editor"]);
  if (!allowed || !caller) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  const target = await getUserById(id);
  if (!target) {
    return NextResponse.json({ error: "Usuario no existe" }, { status: 404 });
  }

  // Super_admin es invisible
  if (!canViewUser(caller.role, target.role, caller.id, target.id)) {
    return NextResponse.json({ error: "Usuario no existe" }, { status: 404 });
  }

  // Verificar jerarquía: ¿puede caller gestionar a target?
  if (!canManageUser(caller.role, target.role)) {
    return NextResponse.json({ error: "No tienes permiso para editar a este usuario" }, { status: 403 });
  }

  if (body.role !== undefined) {
    if (!isUserRole(body.role)) {
      return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
    }
    if (!canAssignRole(caller.role, body.role)) {
      return NextResponse.json({ error: "No tienes permiso para asignar ese rol" }, { status: 403 });
    }

    const ok = await updateUserRole(id, body.role);
    if (!ok) {
      return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
    }
    await logAudit(caller.id, "role_change", `Rol cambiado: ${target.email} → ${body.role} (era ${target.role || "user"})`);
  }

  // Cambiar contraseña (solo si no tiene google_id)
  if (body.password !== undefined) {
    if (target.google_id) {
      return NextResponse.json({ error: "No se puede cambiar contraseña de usuarios con Google OAuth" }, { status: 400 });
    }
    if (typeof body.password !== "string" || body.password.length < 6) {
      return NextResponse.json({ error: "La contraseña debe tener al menos 6 caracteres" }, { status: 400 });
    }
    const passwordHash = hashPassword(body.password);
    await updateUserPassword(id, passwordHash);
    await logAudit(caller.id, "password_change", `Contraseña cambiada: ${target.email}`);
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireRole(["super_admin", "admin"]);
  if (!result.allowed || !result.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;

  // No eliminarse a sí mismo
  if (id === result.user.id) {
    return NextResponse.json({ error: "No puedes eliminarte a ti mismo" }, { status: 400 });
  }

  const target = await getUserById(id);
  if (!target) {
    return NextResponse.json({ error: "Usuario no existe" }, { status: 404 });
  }

  // Super_admin invisible
  if (!canViewUser(result.user.role, target.role, result.user.id, target.id)) {
    return NextResponse.json({ error: "Usuario no existe" }, { status: 404 });
  }

  // Jerarquía: admin no puede eliminar a otro admin
  if (!canManageUser(result.user.role, target.role)) {
    return NextResponse.json({ error: "No tienes permiso para eliminar a este usuario" }, { status: 403 });
  }

  await logAudit(result.user.id, "delete_user", `Usuario eliminado: ${target.email} (${target.name || "sin nombre"})`);
  await deleteUserById(id);
  return NextResponse.json({ success: true });
}

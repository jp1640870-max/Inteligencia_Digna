import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { requireRole, hashPassword, filterVisibleUsers, isUserGroupRole } from "@/lib/auth";
import { getAllUsers, createUser, getUserByEmail, logAudit } from "@/lib/db";

export async function GET() {
  const { allowed, user } = await requireRole(["super_admin", "admin", "editor", "viewer"]);
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const all = getAllUsers();
  const users = filterVisibleUsers(all, user);
  return NextResponse.json({ users, requester: user?.id });
}

export async function POST(req: Request) {
  const { allowed, user } = await requireRole(["super_admin", "admin", "editor"]);
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { email, password, name, role } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Email y contraseña son requeridos" }, { status: 400 });
  }

  const existing = getUserByEmail(email);
  if (existing) {
    return NextResponse.json({ error: "El email ya está registrado" }, { status: 409 });
  }

  const userRole = role || "user";

  // Editor solo puede crear usuarios del grupo "user"
  if (user.role === "editor" && !isUserGroupRole(userRole)) {
    return NextResponse.json({ error: "No tienes permiso para crear usuarios con ese rol" }, { status: 403 });
  }

  const id = uuidv4();
  const passwordHash = hashPassword(password);

  createUser(id, email, name || null, passwordHash, undefined, undefined, userRole);
  logAudit(user.id, "create_user", `Usuario creado desde panel: ${email} (rol: ${userRole})`);

  return NextResponse.json({ success: true, id, email, name: name || null, role: userRole });
}

import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { requireRole, hashPassword, filterVisibleUsers, isUserRole, canAssignRole } from "@/lib/auth";
import { getAllUsers, createUser, getUserByEmail, logAudit } from "@/lib/db";

export async function GET() {
  const { allowed, user } = await requireRole(["super_admin", "admin", "editor", "viewer"]);
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const all = await getAllUsers();
  const users = filterVisibleUsers(all, user).map((entry) => ({
    id: entry.id,
    email: entry.email,
    name: entry.name,
    google_id: entry.google_id,
    picture: entry.picture,
    role: entry.role,
    created_at: entry.created_at,
    chat_count: entry.chat_count,
    project_count: entry.project_count,
  }));
  return NextResponse.json({ users, requester: user.id });
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

  const existing = await getUserByEmail(email);
  if (existing) {
    return NextResponse.json({ error: "El email ya está registrado" }, { status: 409 });
  }

  const userRole = role ?? "user";
  if (!isUserRole(userRole)) {
    return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
  }
  if (!canAssignRole(user.role, userRole)) {
    return NextResponse.json({ error: "No tienes permiso para crear usuarios con ese rol" }, { status: 403 });
  }

  const id = uuidv4();
  const passwordHash = hashPassword(password);

  await createUser(id, email, name || null, passwordHash, undefined, undefined, userRole);
  await logAudit(user.id, "create_user", `Usuario creado desde panel: ${email} (rol: ${userRole})`);

  return NextResponse.json({ success: true, id, email, name: name || null, role: userRole });
}

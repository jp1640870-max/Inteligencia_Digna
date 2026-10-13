import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  requireCapability,
  hashPassword,
  filterVisibleUsers,
  matchesMembershipFilters,
  isUserRole,
  canAssignRole,
} from "@/lib/auth";
import { getAllUsers, createUser, getUserByEmail, logAudit } from "@/lib/db";

/**
 * `areaId` y `groupId` se combinan con AND; `SIN_AREA` selecciona a quien no
 * pertenece a ninguna área.
 *
 * El recorte se hace aquí y no en el cliente porque `getAllUsers` ya trae las
 * membresías de cada usuario, así que filtrar evita mandar el padrón entero y
 * descartarlo en el navegador. La búsqueda por texto sí queda en el cliente: es
 * presentación y no revela nada que la respuesta ya no traiga.
 *
 * Un área o grupo desconocido devuelve vacío en vez de toda la lista: quien lo
 * pidió buscaba a los miembros de algo que ya no existe.
 *
 * El predicado vive en `lib/auth` para poder testearlo sin base de datos.
 */
export async function GET(req: Request) {
  const { allowed, status, user } = await requireCapability("users.read");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
  }

  const { searchParams } = new URL(req.url);
  const filters = {
    areaId: searchParams.get("areaId"),
    groupId: searchParams.get("groupId"),
  };

  const users = filterVisibleUsers(await getAllUsers(), user)
    .filter((entry) => matchesMembershipFilters(entry, filters))
    .map((entry) => ({
      id: entry.id,
      email: entry.email,
      name: entry.name,
      google_id: entry.google_id,
      picture: entry.picture,
      role: entry.role,
      created_at: entry.created_at,
      chat_count: entry.chat_count,
      project_count: entry.project_count,
      area_ids: entry.area_ids ?? [],
      group_ids: entry.group_ids ?? [],
    }));

  return NextResponse.json({ users, requester: user.id });
}

export async function POST(req: Request) {
  const { allowed, status, user } = await requireCapability("users.write");
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status });
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

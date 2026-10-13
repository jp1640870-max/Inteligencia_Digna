import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { getUserById } from "@/lib/db";
import { SIN_AREA, assignableRolesFor } from "@/types";
import type { UserRole } from "@/types";
import { can } from "@/lib/permissions";
import type { Capability } from "@/lib/permissions";

const JWT_SECRET = env.JWT_SECRET;

// ─── Tipos extendidos del payload ───

export type TokenPayload = {
  userId: string;
  email: string;
  role: UserRole;
};

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  role: UserRole;
};

const VALID_USER_ROLES = new Set<UserRole>([
  "super_admin",
  "admin",
  "editor",
  "user",
]);

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && VALID_USER_ROLES.has(value as UserRole);
}

export function canAssignRole(actorRole: string, role: unknown): role is UserRole {
  if (!isUserRole(role)) return false;
  return assignableRolesFor(actorRole).includes(role);
}

// ─── Password ───

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

// ─── JWT ───

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

// ─── Helpers para API routes ───

/**
 * Obtiene el userId desde la cookie de sesión.
 */
export async function getUserIdFromRequest(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("token")?.value;
    if (!token) return null;
    const payload = verifyToken(token);
    return payload?.userId || null;
  } catch (e) {
    console.error("[getUserIdFromRequest]", e);
    return null;
  }
}

/**
 * Obtiene el payload completo del token (userId + email + role).
 */
export async function getTokenPayloadFromRequest(): Promise<TokenPayload | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("token")?.value;
    if (!token) return null;
    return verifyToken(token);
  } catch {
    return null;
  }
}

/**
 * Obtiene la información completa del usuario autenticado.
 * Busca en DB para tener datos frescos (picture, role actualizado).
 */
export async function getAuthUserFromRequest(): Promise<AuthUser | null> {
  try {
    const payload = await getTokenPayloadFromRequest();
    if (!payload) return null;

    // Buscar en DB para datos frescos
    const user = await getUserById(payload.userId);
    if (!user || !isUserRole(user.role)) return null;

    return {
      id: user.id,
      email: user.email,
      name: user.name || null,
      picture: user.picture || null,
      role: user.role || "user",
    };
  } catch {
    return null;
  }
}

/**
 * Verifica que el usuario autenticado tenga un rol permitido.
 *
 * Devuelve `allowed: false` tanto si no hay sesión como si el rol no está en
 * la lista, porque quien llama solo necesita saber si puede pasar. Para saber
 * *por qué* no puede, usar `requireCapability`, que distingue los dos casos.
 */
export async function requireRole(
  allowedRoles: UserRole[]
): Promise<{ allowed: boolean; user: AuthUser | null }> {
  const user = await getAuthUserFromRequest();
  if (!user) return { allowed: false, user: null };
  return { allowed: allowedRoles.includes(user.role), user };
}

/**
 * Verifica que el usuario tenga una capacidad.
 *
 * Es la forma que usan las rutas del panel: la respuesta a "¿puede entrar aquí?"
 * sale de la matriz de `lib/permissions.ts`, no de una lista de roles escrita
 * en la propia ruta.
 *
 * A diferencia de `requireRole`, distingue no tener sesión de no tener
 * permiso, porque la respuesta HTTP también lo distingue: sin sesión es 401 y
 * quien no puede entrar por su rol es 403. Con `requireRole` ambos casos
 * terminaban en 403, lo que hace que un fallo de sesión parezca un problema de
 * permisos y al cliente le cuesta más distinguirlo.
 */
export async function requireCapability(
  capability: Capability
): Promise<{ allowed: boolean; status: 200 | 401 | 403; user: AuthUser | null }> {
  const user = await getAuthUserFromRequest();
  if (!user) return { allowed: false, status: 401, user: null };
  if (!can(user.role, capability)) return { allowed: false, status: 403, user };
  return { allowed: true, status: 200, user };
}

/**
 * ¿El actor puede gestionar (editar rol o password) al target?
 *
 * Es la jerarquía, no la capacidad: `users.write` abre la puerta y esta
 * función decide a quién se le deja cruzar. Reglas:
 * - super_admin gestiona a todos
 * - admin gestiona a todos excepto super_admin
 * - editor solo gestiona usuarios del rol `user`
 * - user no gestiona a nadie
 */
export function canManageUser(actorRole: string, targetRole: string): boolean {
  if (!isUserRole(actorRole) || !isUserRole(targetRole)) return false;
  if (actorRole === "super_admin") return true;
  if (actorRole === "admin") return targetRole !== "super_admin";
  if (actorRole === "editor") return isUserGroupRole(targetRole);
  return false;
}

/**
 * Roles que `editor` puede gestionar.
 *
 * La migración 003 eliminó `viewer`, `power_user` y `restricted`, así que hoy
 * solo queda `user`. Sigue siendo una función para que añadir un rol por
 * debajo de `editor` sea un cambio en un sitio y no en varios `if`.
 */
export function isUserGroupRole(role: string): boolean {
  return role === "user";
}

/**
 * ¿El actor puede ver a este usuario?
 * Solo regla: super_admin es invisible para todos excepto sí mismo.
 */
export function canViewUser(actorRole: string, targetRole: string, actorId: string, targetId: string): boolean {
  if (!isUserRole(actorRole) || !isUserRole(targetRole)) return false;
  if (targetRole !== "super_admin") return true;
  return actorId === targetId; // solo el propio super_admin se ve a sí mismo
}

/**
 * Filtra una lista de usuarios aplicando la misma regla que {@link canViewUser}:
 * un `super_admin` solo es visible para sí mismo, ni siquiera entre pares.
 *
 * Sin esta correspondencia, la vista de detalle respondería 403 para un
 * `super_admin` que sí aparece en la lista: dos reglas que se contradicen.
 */
export function filterVisibleUsers<T extends { id: string; role: string }>(
  users: T[],
  caller: { id: string; role: string },
): T[] {
  return users.filter((u) => canViewUser(caller.role, u.role, caller.id, u.id));
}

/**
 * Aplica los filtros de pertenencia del listado de usuarios.
 *
 * Área y grupo se combinan con AND: con ambos activos salen quienes pertenecen
 * al área Y al grupo. Un filtro vacío no restringe.
 *
 * Un filtro con id desconocido recorta y devuelve vacío, que es lo correcto:
 * si el área ya no existe, nadie pertenece a ella. El caso legítimo de "pertenece
 * a ninguna" se pide con el centinela `SIN_AREA`, no con un id inexistente.
 */
export function matchesMembershipFilters(
  entry: { area_ids?: string[]; group_ids?: string[] },
  filters: { areaId?: string | null; groupId?: string | null },
): boolean {
  const areas = entry.area_ids ?? [];
  const groups = entry.group_ids ?? [];

  if (filters.areaId === SIN_AREA) {
    if (areas.length > 0) return false;
  } else if (filters.areaId && !areas.includes(filters.areaId)) {
    return false;
  }

  if (filters.groupId && !groups.includes(filters.groupId)) {
    return false;
  }
  return true;
}

/**
 * Filtra una lista de chats/proyectos: remueve los de super_admin si el caller no es super_admin.
 */
export function filterVisibleItems<T extends { user_role?: unknown }>(items: T[], caller: { id: string; role: string }): T[] {
  if (caller.role === "super_admin") return items;
  return items.filter((item) => item.user_role !== "super_admin");
}

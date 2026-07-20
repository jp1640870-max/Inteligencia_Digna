import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { getUserById } from "@/lib/db";
import type { UserRole } from "@/types";

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
    const user = getUserById(payload.userId);
    if (!user) return null;

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
 * Si no, retorna false. Si no hay usuario, retorna false.
 */
export async function requireRole(
  allowedRoles: UserRole[]
): Promise<{ allowed: boolean; user: AuthUser | null }> {
  const user = await getAuthUserFromRequest();
  if (!user) return { allowed: false, user: null };
  return { allowed: allowedRoles.includes(user.role), user };
}

// ─── Jerarquía de roles ───

/**
 * Nivel numérico para cada rol.
 * Más alto = más permisos.
 */
const ROLE_LEVEL: Record<string, number> = {
  super_admin: 100,
  admin: 80,
  editor: 60,
  viewer: 40,
  power_user: 20,
  user: 20,
  restricted: 10,
};

export function getRoleLevel(role: string): number {
  return ROLE_LEVEL[role] ?? 0;
}

/**
 * ¿El actor puede gestionar (editar rol/password) al target?
 * Reglas:
 * - super_admin gestiona a todos
 * - admin gestiona a todos excepto super_admin
 * - editor solo gestiona usuarios del "grupo user"
 * - viewer y menores no gestionan a nadie
 */
export function canManageUser(actorRole: string, targetRole: string): boolean {
  if (actorRole === "super_admin") return true;
  if (actorRole === "admin") return targetRole !== "super_admin";
  if (actorRole === "editor") return isUserGroupRole(targetRole);
  return false; // viewer, user, etc.
}

/**
 * Roles del "grupo user" (los que editor puede gestionar).
 * Se expandirá cuando se definan power_user, restricted, etc.
 */
export function isUserGroupRole(role: string): boolean {
  return role === "user";
}

/**
 * ¿El actor puede ver a este usuario?
 * Solo regla: super_admin es invisible para todos excepto sí mismo.
 */
export function canViewUser(actorRole: string, targetRole: string, actorId: string, targetId: string): boolean {
  if (targetRole !== "super_admin") return true;
  return actorId === targetId; // solo el propio super_admin se ve a sí mismo
}

/**
 * Filtra una lista de usuarios: remueve super_admin si el caller no es super_admin.
 * Además remueve al propio caller si es super_admin (no se necesita en listas).
 * NOTA: el propio super_admin sí debe verse a sí mismo en la lista.
 */
export function filterVisibleUsers(users: any[], caller: { id: string; role: string }): any[] {
  if (caller.role === "super_admin") return users;
  return users.filter((u) => u.role !== "super_admin");
}

/**
 * Filtra una lista de chats/proyectos: remueve los de super_admin si el caller no es super_admin.
 */
export function filterVisibleItems(items: any[], caller: { id: string; role: string }): any[] {
  if (caller.role === "super_admin") return items;
  return items.filter((item: any) => item.user_role !== "super_admin");
}

import type { UserRole } from "@/types";

/**
 * Capacidades del panel de administración.
 *
 * Este módulo es la única fuente de verdad sobre *qué puede hacer* cada rol.
 * Antes de existir, cada ruta declaraba sus propios roles literales
 * (`requireRole(["super_admin", "admin", "editor"])`) y esa misma matriz estaba
 * copiada en unas diez rutas y en otras tantas páginas del panel. Con dos
 * copias de una verdad, cualquier cambio necesitaba dos ediciones y las
 * divergencias aparecían solas: `editor` leía la base de conocimiento entera
 * por `preview` y `download` porque esas dos rutas admitían un rol que la
 * política de lectura les negaba.
 *
 * Un capability responde *a qué pantallas y acciones entra el usuario*, no
 * *qué filas ve*. Son dos capas distintas y ninguna sustituye a la otra:
 *
 *   - Aquí: `can(role, "kb.read")` decide si el endpoint se atiende.
 *   - En `lib/kb-access.ts`: el ACL decide qué archivos concretos lee quien
 *     entra. Un `editor` tiene `kb.read` y aun así solo lee lo que tiene por
 *     grant o lo que él mismo subió.
 *
 * La matriz recoge lo que las rutas ya hacían: consolidar no amplía ni reduce
 * ningún permiso. El único cambio de comportamiento deliberado es `kb.read`
 * para `editor`, que pasa a estar filtrado por ACL.
 */
export type Capability =
  // Entrada al panel
  | "admin.access"

  // Base de conocimiento. `kb.read` permite entrar a las lecturas; cuáles
  // archivos son legibles lo decide el ACL, no esta matriz.
  | "kb.read" // listado, metadatos, vista previa y descarga del original
  | "kb.read.all" // leer contenido ignorando el ACL: solo el perímetro
  | "kb.upload" // subir contenido nuevo o reemplazar entradas de texto
  | "kb.manage" // reclasificar, mover entre categorías, editar
  | "kb.publish" // aprobar, rechazar, resolver conflictos, reindexar
  | "kb.delete"
  | "kb.grants" // otorgar y revocar lectura sobre archivos

  // Áreas y grupos
  | "org.read" // catálogos y membresías
  | "org.read.detail" // detalle de un área o grupo, con sus grants
  | "org.manage" // alta, edición, desactivación y membresías

  // Usuarios
  | "users.read"
  | "users.write" // crear, editar, cambiar rol y password
  | "users.delete"

  // Control y operación
  | "panel.read" // vistas agregadas del panel: estadísticas, informes, listados
  | "config.read" // consulta de la configuración
  | "config.write"
  | "config.destroy" // borrado de la configuración
  | "audit.read"
  | "sessions.read"
  | "backups.manage"
  | "hearts.manage"
  | "chats.read_content" // contenido de un chat ajeno
  | "announcements.read"
  | "announcements.write"
  | "impersonate"; // assume de identidad

/**
 * Todas las capacidades, en el orden en que aparecen en la matriz de abajo.
 *
 * Declararlas una vez aquí evita que `ALL_CAPABILITIES` se desincronice de la
 * matriz: los tests recorren esta lista fila por fila para comprobar cada rol.
 */
export const ALL_CAPABILITIES: readonly Capability[] = [
  "admin.access",
  "kb.read",
  "kb.read.all",
  "kb.upload",
  "kb.manage",
  "kb.publish",
  "kb.delete",
  "kb.grants",
  "org.read",
  "org.read.detail",
  "org.manage",
  "users.read",
  "users.write",
  "users.delete",
  "panel.read",
  "config.read",
  "config.write",
  "config.destroy",
  "audit.read",
  "sessions.read",
  "backups.manage",
  "hearts.manage",
  "chats.read_content",
  "announcements.read",
  "announcements.write",
  "impersonate",
];

/**
 * Lo que puede hacer cada rol.
 *
 * Se declara explícita y completa, sin negaciones: una capability ausente de
 * una fila es un "no" que se lee de un vistazo, y añadir un rol obliga a
 * escribir su fila entera en lugar de heredar silenciosamente lo de otro.
 *
 * La relación entre `super_admin` y `admin` es vertical y mínima: `super_admin`
 * existe para poder administrar a los `admin`. Por eso la única diferencia
 * entre ambas filas son `config.destroy` e `impersonate`. `admin` tiene
 * bypass de lectura sobre la base de conocimiento, igual que `super_admin`, y
 * ese bypass es detective (auditoría + revisión periódica), no preventivo.
 *
 * `editor` prepara contenido y no decide: no aprueba, no otorga acceso ni ve
 * la ACL de otras personas. `users.write` lo tiene, pero la ruta lo acota con
 * `canManageUser`, que solo le deja tocar a usuarios de rol `user`. Esa es la
 * diferencia entre una capacidad y una jerarquía: la capability abre la
 * puerta, la jerarquía decide a quién se le deja cruzar.
 *
 * `kb.read.all` es el bypass del perímetro con nombre propio. Existe para que
 * un endpoint que devuelve contenido sin filtrar por ACL no tenga que
 * esconderse detrás de `requireRole`, donde no se distingue de un `kb.read`
 * normal. Usarla es un acto deliberado y visible en la revisión. `kb.read` y
 * `kb.read.all` no son intercambiables aunque hoy coincidan en qué rutas las
 * usan.
 *
 * `user` no entra al panel, así que no tiene ninguna.
 */
const MATRIX: Record<UserRole, readonly Capability[]> = {
  super_admin: ALL_CAPABILITIES,
  admin: ALL_CAPABILITIES.filter(
    (capability) => capability !== "config.destroy" && capability !== "impersonate",
  ),
  editor: [
    "admin.access",
    "kb.read",
    "kb.upload",
    "kb.manage",
    "org.read",
    "users.read",
    "users.write",
    "panel.read",
    "config.read",
    "announcements.read",
  ],
  user: [],
};

/**
 * ¿El rol tiene esta capacidad?
 *
 * Deniega por defecto: una capability ausente de la fila del rol es `false`.
 * `user` y cualquier valor que no sea un rol válido caen aquí sin necesitar una
 * comprobación aparte.
 */
export function can(role: unknown, capability: Capability): boolean {
  if (!isUserRoleInMatrix(role)) return false;
  return MATRIX[role].includes(capability);
}

/** Capacidades de un rol, para documentación, navegación y tests. */
export function capabilitiesFor(role: unknown): readonly Capability[] {
  if (!isUserRoleInMatrix(role)) return [];
  return MATRIX[role];
}

/** Roles que tienen una capacidad. La inversa de la matriz, para los tests. */
export function rolesWith(capability: Capability): UserRole[] {
  return (Object.keys(MATRIX) as UserRole[]).filter((role) => MATRIX[role].includes(capability));
}

/**
 * ¿El rol entra al panel de administración?
 *
 * Equivale a `admin.access`, pero con nombre propio porque el guard del layout
 * y la navegación del panel se leen en términos de "quién entra", no de
 * "qué puede hacer una vez dentro".
 */
export function canAccessAdminPanel(role: unknown): boolean {
  return can(role, "admin.access");
}

function isUserRoleInMatrix(role: unknown): role is UserRole {
  return role === "super_admin" || role === "admin" || role === "editor" || role === "user";
}

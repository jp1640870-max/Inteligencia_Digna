export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type Msg = {
  id?: number;
  role: "user" | "ai";
  text?: string;
  images?: string[];
  files?: { name: string }[];
  editResult?: EditResult;
  searching?: boolean;
  sources?: SearchResult[];
};

export type Chat = {
  id: string;
  title: string;
  messages: Msg[];
  created_at?: string;
  updated_at?: string;
};

// ─── Roles de usuario ───
//
// `super_admin` y `admin` hacen lo mismo en cuanto a capacidades. La única
// diferencia es vertical: `super_admin` administra a los `admin`. El control del
// perímetro es detective (auditoría + revisión periódica), no preventivo.
export type UserRole =
  | "super_admin"   // Acceso total + gestión de los demás administradores
  | "admin"         // Perímetro: usuarios, áreas, grupos, grants, contenido
  | "editor"        // Prepara contenido (sube archivos); no aprueba ni otorga
  | "user";         // Acceso a la KB según sus áreas y grupos

export const ADMIN_ROLES: UserRole[] = ["super_admin", "admin", "editor"];

/** Roles que pueden gestionar el perímetro (todo menos `super_admin`). */
export const PERIMETER_ROLES: UserRole[] = ["super_admin", "admin"];

/**
 * Valor centinela del filtro de área: selecciona a quien no pertenece a ninguna.
 *
 * No es un id real, es una palabra reservada para que el filtro sea
 * direccionable desde la URL. Sin ella, la lista de quienes no leen nada de la
 * base de conocimiento no sería alcanzable desde la interfaz.
 *
 * Vive aquí y no en `lib/auth` porque el selector del panel es un componente
 * cliente, e `lib/auth` importa la base de datos y `next/headers`.
 */
export const SIN_AREA = "__sin_area__";

/**
 * Roles que cada rol administrativo puede asignar.
 *
 * Vive en `types` por el mismo motivo que `SIN_AREA`: el selector de rol del
 * panel es un componente cliente y necesita la misma tabla que aplica el
 * servidor. Estaba duplicada en `app/admin/usuarios/page.tsx` y
 * `app/admin/usuarios/[id]/page.tsx`, dos copias que solo iban a divergir.
 *
 * `lib/auth` la consume a través de `canAssignRole`, que es la forma en que la
 * aplica el servidor: el panel muestra lo que hay que elegir y la ruta
 * comprueba lo que se eligió.
 */
const ASSIGNABLE_ROLES: Record<string, UserRole[]> = {
  super_admin: ["user", "editor", "admin", "super_admin"],
  admin: ["user", "editor", "admin"],
  editor: ["user"],
};

/** Roles asignables por un actor, o lista vacía si no administra a nadie. */
export function assignableRolesFor(actorRole: unknown): UserRole[] {
  if (typeof actorRole !== "string") return [];
  return ASSIGNABLE_ROLES[actorRole] ?? [];
}

export function isAdminRole(role?: string): boolean {
  if (!role) return false;
  return ADMIN_ROLES.includes(role as UserRole);
}

export type User = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
};

export type Project = {
  id: string;
  name: string;
  instructions: string;
  created_at: string;
  chat_count?: number;
};

export type ProjectChat = {
  project_id: string;
  chat_id: string;
  added_at: string;
};

export type ProyectoConChats = Project & {
  chats: Chat[];
};

export type EditFormat = "xlsx" | "docx" | "pdf";

export type CellEdit = {
  sheet?: string;
  cell: string;
  value: string | number;
};

export type RowInsertEdit = {
  sheet?: string;
  afterRow: number;
  values: (string | number)[][];
};

export type ColInsertEdit = {
  sheet?: string;
  afterCol: string;
  header: string;
  values: (string | number)[];
};

export type RowDeleteEdit = {
  sheet?: string;
  row: number;
};

export type ColDeleteEdit = {
  sheet?: string;
  col: string;
};

export type ParagraphEdit = {
  paragraphIndex: number;
  action: "replaceText" | "deleteParagraph" | "insertAfter";
  newText?: string;
};

export type PdfTextEdit = {
  pageNumber: number;
  oldText: string;
  newText: string;
};

export type EditInstruction = {
  format: EditFormat;
  description?: string;
  changes: CellEdit[] | RowInsertEdit[] | ColInsertEdit[] | RowDeleteEdit[] | ColDeleteEdit[] | ParagraphEdit[] | PdfTextEdit[];
};

export type EditResult = {
  success: boolean;
  format: EditFormat;
  filename: string;
  originalName: string;
  changesCount: number;
  downloadUrl?: string;
  dataUri?: string;
  error?: string;
};

// Document generation types
export type DocGenFormat = "xlsx" | "docx" | "pdf";

export type DocGenSheet = {
  name: string;
  headers?: string[];
  rows: string[][];
};

export type DocGenContentBlock =
  | { type: "title"; text: string }
  | { type: "heading"; text: string; level?: number }
  | { type: "paragraph"; text: string }
  | { type: "table"; headers?: string[]; rows: string[][] };

export type DocGenStructure = {
  format: DocGenFormat;
  filename: string;
  sheets?: DocGenSheet[];
  content?: DocGenContentBlock[];
};

// ─── Knowledge Base ───

export type KbFileStatus =
  | "processing"
  | "pending_review"  // Subido, aún no indexado ni buscable
  | "active"
  | "hold";           // Conflicto de nombre o error de storage

export type KbCategory = {
  id: string;
  name: string;
  label: string;
  created_at?: string;
  updated_at?: string;
};

export type KbFile = {
  id: string;
  filename: string;
  format: string;
  size_bytes: number;
  category_id: string | null;
  category_name?: string;
  category_label?: string;
  status: KbFileStatus;
  conflict_with: string | null;
  conflict_with_filename?: string | null;
  content: string;
  checksum: string | null;
  uploaded_by: string | null;
  uploader_name?: string | null;
  created_at: string;
  updated_at: string;
  chunk_count?: number;
};

export type KbChunk = {
  id: string;
  file_id: string;
  category_id: string | null;
  chunk_index: number;
  content: string;
  /** Solo presente en las consultas que recuperan vectores. */
  embedding?: string;
  created_at?: string;
};

/**
 * Fuente KB citada por una respuesta del asistente (solo para auditoría admin,
 * nunca se muestra al usuario final).
 */
export type KbSource = {
  file_id: string;
  filename: string;
  category: string | null;
  chunk_index: number;
  score: number;
};

export type KbConflictAction =
  | "keep-both"
  | "delete-new"
  | "delete-old"
  | "reactivate"
  | "reindex"
  | "move"
  | "approve"
  | "reject";

// ─── Áreas, grupos y grants (RBAC de Knowledge Base) ─────────────────────────

/**
 * Unidad organizacional. Da acceso a la KB por defecto y admite un solo nivel
 * de jerarquía (`parent_id`), suficiente para supervised sin invocar una
 * tercera abstracción.
 */
export type Area = {
  id: string;
  key: string;
  name: string;
  description: string;
  parent_id: string | null;
  source: "manual" | "google";
  external_id: string | null;
  is_active: boolean;
  member_count?: number;
  grant_count?: number;
  created_at: string;
  updated_at: string;
};

/**
 * Agrupación transversal para compartir acceso entre áreas distintas.
 * `is_system` marca los grupos que no se pueden borrar.
 */
export type UserGroup = {
  id: string;
  key: string;
  name: string;
  description: string;
  source: "manual" | "google";
  external_id: string | null;
  is_active: boolean;
  is_system: boolean;
  member_count?: number;
  grant_count?: number;
  created_at: string;
  updated_at: string;
};

export type PrincipalType = "area" | "group";

/**
 * Permiso explícito de lectura sobre un archivo de la KB. Sin grant nadie lee
 * (fail closed), y solo `admin`/`super_admin` crean o revocan filas aquí.
 */
export type KbAccessGrant = {
  id: string;
  principal_type: PrincipalType;
  principal_id: string;
  principal_name: string;
  kb_file_id: string;
  filename: string;
  category_label: string | null;
  permission: "read";
  granted_by: string | null;
  granted_by_name: string | null;
  created_at: string;
};

export type KbPrincipalRef = {
  type: PrincipalType;
  id: string;
  name: string;
};

// ─── Filas de base de datos (contrato PostgreSQL ↔ dominio) ───
// Las conversiones de tipos viven en lib/db.ts y lib/projects.ts; el resto
// del código recibe tipos reales por inferencia.

export type CountRow = { c: number; count: number };

export type UserRow = {
  id: string;
  email: string;
  name: string | null;
  password_hash: string | null;
  google_id: string | null;
  picture: string | null;
  role: UserRole;
  created_at: string;
};

export type UserWithCountsRow = Omit<UserRow, "password_hash"> & {
  chat_count: number;
  project_count: number;
  /** Áreas activas del usuario. Se recalcula en cada lectura, sin caché. */
  area_ids?: string[];
  /** Grupos activos del usuario. Igual que `area_ids`. */
  group_ids?: string[];
};

export type ChatRow = {
  id: string;
  user_id: string;
  title: string;
  heart_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatWithOwnerRow = ChatRow & {
  user_name: string | null;
  user_email: string | null;
  user_role: string | null;
};

export type ChatAdminRow = ChatWithOwnerRow & {
  message_count: number;
  last_message: string | null;
};

export type ProjectRow = Project & { user_id: string };

export type ProjectAdminRow = ProjectRow & {
  user_name: string | null;
  user_email: string | null;
  user_role: string | null;
  chat_count: number;
};

export type MessageRow = {
  id: number;
  chat_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  images: string | null;
  files: string | null;
  doc_data: string | null;
  kb_sources: string | null;
  created_at: string;
};

export type RagChunkRow = {
  id: string;
  user_id: string | null;
  chat_id: string | null;
  project_id: string | null;
  document_name: string;
  chunk_index: number;
  content: string;
  embedding: string;
  created_at: string;
};

export type HeartRow = {
  id: string;
  user_id: string;
  name: string;
  role: string;
  tone: string;
  instructions: string;
  limitations: string;
  temperature: number;
  knowledge_files: string;
  tools: string;
  agent_memory: string;
  is_public: number;
  is_preset: number;
  created_at: string;
  updated_at: string;
};

export type HeartWithOwnerRow = HeartRow & {
  user_name: string | null;
  user_email: string | null;
};

export type ConfigRow = {
  key: string;
  value: string;
  description: string;
};

export type KnowledgeEntryRow = {
  id: string;
  title: string;
  content: string;
  category: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export type KbCategoryWithCounts = KbCategory & {
  file_count: number;
  active_count: number;
};

export type AuditLogRow = {
  id: number;
  user_id: string | null;
  action: string;
  details: string;
  ip: string;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
};

export type AnnouncementRow = {
  id: string;
  title: string;
  content: string;
  type: string;
  active: number;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export type BackupRow = {
  id: string;
  filename: string;
  size_bytes: number;
  status: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
};

export type AdminSessionsData = {
  activeToday: number;
  totalUsers: number;
  recentLogins: UserWithCountsRow[];
  timestamp: string;
};

// ─── pdf2json (sin tipos propios: contrato estructural mínimo) ───
export type Pdf2JsonTextRun = { T: string };
export type Pdf2JsonTextItem = {
  R?: Pdf2JsonTextRun[];
  x?: number;
  y?: number;
  w?: number;
  h?: number;
};
export type Pdf2JsonPage = { Texts?: Pdf2JsonTextItem[] };
export type Pdf2JsonData = { Pages?: Pdf2JsonPage[] };

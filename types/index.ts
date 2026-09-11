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
export type UserRole =
  | "super_admin"   // Acceso TOTAL al panel + gestión de admins
  | "admin"         // Gestiona usuarios, Hearts, config, contenido
  | "editor"        // Gestiona Hearts públicos, knowledge base
  | "viewer"        // Solo lectura del panel
  | "power_user"    // Features avanzadas (ilimitado, docs)
  | "user"          // Features base (chats, archivos)
  | "restricted";   // Solo chats básicos, sin archivos ni web search

export const ADMIN_ROLES: UserRole[] = ["super_admin", "admin", "editor", "viewer"];

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

export type KbFileStatus = "processing" | "active" | "hold";

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
  embedding: string;
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
  | "move";

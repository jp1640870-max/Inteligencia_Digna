import { query, withTransaction } from "./db-connection";
import type { PoolClient } from "pg";
import type {
  AnnouncementRow,
  Area,
  AuditLogRow,
  BackupRow,
  ChatAdminRow,
  ChatRow,
  ChatWithOwnerRow,
  ConfigRow,
  HeartRow,
  HeartWithOwnerRow,
  KbAccessGrant,
  KbCategory,
  KbCategoryWithCounts,
  KbChunk,
  KbFile,
  KbPrincipalRef,
  KbSource,
  KnowledgeEntryRow,
  MessageRow,
  Msg,
  PrincipalType,
  ProjectAdminRow,
  ProjectRow,
  RagChunkRow,
  UserGroup,
  UserRow,
  UserWithCountsRow,
} from "@/types";

type DbRow = Record<string, unknown>;

/** Referencia `{ id, name }` a un área o grupo, para mostrar sin consultas extra. */
type PrincipalRefRow = { id: string; name: string };

type EmbeddingInput = number[] | string;

const HEART_UPDATE_FIELDS = [
  "name",
  "role",
  "tone",
  "instructions",
  "limitations",
  "temperature",
  "knowledge_files",
  "tools",
  "agent_memory",
  "is_public",
  "is_preset",
] as const;

const KB_FILE_UPDATE_FIELDS = [
  "filename",
  "format",
  "size_bytes",
  "category_id",
  "status",
  "conflict_with",
  "content",
  "checksum",
  "uploaded_by",
] as const;

const ANNOUNCEMENT_UPDATE_FIELDS = ["title", "content", "type", "active"] as const;

const USER_ROLES = [
  "super_admin",
  "admin",
  "editor",
  "user",
] as const;

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function textValue(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function nullableTextValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function booleanNumber(value: unknown): number {
  return booleanValue(value) ? 1 : 0;
}

function jsonText(value: unknown, fallback: string | null = null): string | null {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value;
  const serialized = JSON.stringify(value);
  return serialized === undefined ? fallback : serialized;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function serializeEmbedding(value: EmbeddingInput): string {
  let values: unknown[];
  if (Array.isArray(value)) {
    values = value;
  } else {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error("El embedding debe ser un array");
    values = parsed;
  }

  if (values.length === 0 || values.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw new Error("El embedding debe contener números finitos");
  }

  return `[${values.join(",")}]`;
}

function embeddingText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `[${value.join(",")}]`;
  return "";
}

function normalizeUser(row: DbRow): UserRow {
  return {
    ...row,
    id: textValue(row.id),
    email: textValue(row.email),
    name: nullableTextValue(row.name),
    password_hash: nullableTextValue(row.password_hash),
    google_id: nullableTextValue(row.google_id),
    picture: nullableTextValue(row.picture),
    role: textValue(row.role, "user") as UserRow["role"],
    created_at: textValue(row.created_at),
  } as UserRow;
}

function normalizeChat(row: DbRow): ChatRow {
  return {
    ...row,
    id: textValue(row.id),
    user_id: textValue(row.user_id),
    title: textValue(row.title),
    heart_id: nullableTextValue(row.heart_id),
    created_at: textValue(row.created_at),
    updated_at: textValue(row.updated_at),
  } as ChatRow;
}

function normalizeMessageRow(row: DbRow): MessageRow {
  return {
    ...row,
    id: numberValue(row.id),
    chat_id: textValue(row.chat_id),
    role: textValue(row.role) as MessageRow["role"],
    content: textValue(row.content),
    images: jsonText(row.images),
    files: jsonText(row.files),
    doc_data: jsonText(row.doc_data),
    kb_sources: jsonText(row.kb_sources),
    created_at: textValue(row.created_at),
  } as MessageRow;
}

function messageFromRow(row: DbRow): Msg {
  const normalized = normalizeMessageRow(row);
  const parsedImages = parseJson(normalized.images);
  const role: Msg["role"] = normalized.role === "assistant" ? "ai" : "user";
  const message: Msg = {
    id: normalized.id,
    role,
    text: normalized.content,
    images: Array.isArray(parsedImages) && parsedImages.length > 0 ? (parsedImages as string[]) : undefined,
  };

  if (normalized.doc_data) {
    try {
      const doc = parseJson(normalized.doc_data) as Record<string, unknown>;
      const format = textValue(doc.format);
      const data = textValue(doc.data);
      const contentTypeMap: Record<string, string> = {
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        pdf: "application/pdf",
      };
      message.editResult = {
        success: true,
        format: (format || "pdf") as "xlsx" | "docx" | "pdf",
        filename: textValue(doc.filename),
        originalName: textValue(doc.filename),
        changesCount: numberValue(doc.changesCount),
        dataUri: `data:${contentTypeMap[format] || "application/octet-stream"};base64,${data}`,
      };
    } catch {}
  }

  return message;
}

function normalizeHeart(row: DbRow): HeartRow {
  return {
    ...row,
    id: textValue(row.id),
    user_id: textValue(row.user_id),
    name: textValue(row.name),
    role: textValue(row.role),
    tone: textValue(row.tone),
    instructions: textValue(row.instructions),
    limitations: textValue(row.limitations),
    temperature: numberValue(row.temperature, 0.7),
    knowledge_files: jsonText(row.knowledge_files, "[]") || "[]",
    tools: jsonText(row.tools, "[]") || "[]",
    agent_memory: textValue(row.agent_memory),
    is_public: booleanNumber(row.is_public),
    is_preset: booleanNumber(row.is_preset),
    created_at: textValue(row.created_at),
    updated_at: textValue(row.updated_at),
  } as HeartRow;
}

function normalizeCategory(row: DbRow): KbCategory {
  return {
    ...row,
    id: textValue(row.id),
    name: textValue(row.name),
    label: textValue(row.label),
    created_at: textValue(row.created_at),
    updated_at: textValue(row.updated_at),
  } as KbCategory;
}

function normalizeKbFile(row: DbRow): KbFile {
  return {
    ...row,
    id: textValue(row.id),
    filename: textValue(row.filename),
    format: textValue(row.format),
    size_bytes: numberValue(row.size_bytes),
    category_id: nullableTextValue(row.category_id),
    status: textValue(row.status, "processing") as KbFile["status"],
    conflict_with: nullableTextValue(row.conflict_with),
    content: textValue(row.content),
    checksum: nullableTextValue(row.checksum),
    uploaded_by: nullableTextValue(row.uploaded_by),
    created_at: textValue(row.created_at),
    updated_at: textValue(row.updated_at),
    chunk_count: row.chunk_count === undefined ? undefined : numberValue(row.chunk_count),
  } as KbFile;
}

/**
 * Metadatos de un archivo sin el texto extraído.
 *
 * El listado de archivos devuelve esto en lugar de `KbFile` completo. El
 * `content` puede ser megabytes por documento, y un listado no lo necesita: con
 * él, abrir el panel volcaba la KB entera por el socket sin que nadie lo pidiera.
 * El texto se pide bajo demanda (descarga o vista previa), donde sí se audita.
 */
export function toKbFileSummary(file: KbFile): Omit<KbFile, "content"> {
  const summary: Record<string, unknown> = { ...file };
  delete summary.content;
  return summary as Omit<KbFile, "content">;
}

function normalizeKbChunk(row: DbRow): KbChunk {
  return {
    ...row,
    id: textValue(row.id),
    file_id: textValue(row.file_id),
    category_id: nullableTextValue(row.category_id),
    chunk_index: numberValue(row.chunk_index),
    content: textValue(row.content),
    // La columna solo existe en las consultas que piden vectores. Fabricar aquí
    // un `embedding: ""` haría creer que se cargo un vector que no se trajo.
    ...(row.embedding === undefined ? {} : { embedding: embeddingText(row.embedding) }),
    created_at: textValue(row.created_at),
  } as KbChunk;
}

function normalizeRagChunk(row: DbRow): RagChunkRow {
  return {
    ...row,
    id: textValue(row.id),
    user_id: nullableTextValue(row.user_id),
    chat_id: nullableTextValue(row.chat_id),
    project_id: nullableTextValue(row.project_id),
    document_name: textValue(row.document_name),
    chunk_index: numberValue(row.chunk_index),
    content: textValue(row.content),
    embedding: embeddingText(row.embedding),
    created_at: textValue(row.created_at),
  } as RagChunkRow;
}

function normalizeProject(row: DbRow): ProjectRow {
  return {
    ...row,
    id: textValue(row.id),
    user_id: textValue(row.user_id),
    name: textValue(row.name),
    instructions: textValue(row.instructions),
    created_at: textValue(row.created_at),
    chat_count: row.chat_count === undefined ? undefined : numberValue(row.chat_count),
  } as ProjectRow;
}

function normalizeAnnouncement(row: DbRow): AnnouncementRow {
  return {
    ...row,
    id: textValue(row.id),
    title: textValue(row.title),
    content: textValue(row.content),
    type: textValue(row.type, "info"),
    active: booleanNumber(row.active),
    created_by: nullableTextValue(row.created_by),
    created_by_name: nullableTextValue(row.created_by_name),
    created_at: textValue(row.created_at),
    updated_at: textValue(row.updated_at),
  } as AnnouncementRow;
}

function normalizeAuditLog(row: DbRow): AuditLogRow {
  return {
    ...row,
    id: numberValue(row.id),
    user_id: nullableTextValue(row.user_id),
    action: textValue(row.action),
    details: textValue(row.details),
    ip: textValue(row.ip),
    created_at: textValue(row.created_at),
    user_name: nullableTextValue(row.user_name),
    user_email: nullableTextValue(row.user_email),
  } as AuditLogRow;
}

function normalizeBackup(row: DbRow): BackupRow {
  return {
    ...row,
    id: textValue(row.id),
    filename: textValue(row.filename),
    size_bytes: numberValue(row.size_bytes),
    status: textValue(row.status, "pending"),
    created_by: nullableTextValue(row.created_by),
    created_by_name: nullableTextValue(row.created_by_name),
    created_at: textValue(row.created_at),
  } as BackupRow;
}

function countFromRow(row: unknown, key = "c"): number {
  if (!row || typeof row !== "object") return 0;
  return numberValue((row as DbRow)[key] ?? (row as DbRow).count);
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function serializeJsonField(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (value === null) return fallback;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function serializeHeartValue(field: (typeof HEART_UPDATE_FIELDS)[number], value: unknown): unknown {
  if (field === "knowledge_files" || field === "tools") return serializeJsonField(value, "[]");
  if (field === "is_public" || field === "is_preset") return booleanValue(value);
  if (field === "temperature") return numberValue(value, 0.7);
  if (value === undefined) return null;
  return value;
}

function serializeKbValue(field: (typeof KB_FILE_UPDATE_FIELDS)[number], value: unknown): unknown {
  if (field === "size_bytes") return numberValue(value);
  if (value === undefined) return null;
  return value;
}

export async function createUser(
  id: string,
  email: string,
  name: string | null,
  passwordHash?: string,
  googleId?: string,
  picture?: string,
  role?: string,
): Promise<void> {
  await query(
    `INSERT INTO users (id, email, name, password_hash, google_id, picture, role)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, email, name, passwordHash || null, googleId || null, picture || null, role || "user"],
  );
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const result = await query(
    "SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1",
    [email],
  );
  const row = result.rows[0] as DbRow | undefined;
  return row ? normalizeUser(row) : null;
}

export async function getUserByGoogleId(googleId: string): Promise<UserRow | null> {
  const result = await query("SELECT * FROM users WHERE google_id = $1 LIMIT 1", [googleId]);
  const row = result.rows[0] as DbRow | undefined;
  return row ? normalizeUser(row) : null;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const result = await query("SELECT * FROM users WHERE id = $1 LIMIT 1", [id]);
  const row = result.rows[0] as DbRow | undefined;
  return row ? normalizeUser(row) : null;
}

export async function getUserStats(userId: string): Promise<{ projectCount: number; chatCount: number }> {
  const result = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM projects WHERE user_id = $1) AS project_count,
       (SELECT COUNT(*)::int FROM chats WHERE user_id = $1) AS chat_count`,
    [userId],
  );
  const row = result.rows[0] as DbRow | undefined;
  return {
    projectCount: numberValue(row?.project_count),
    chatCount: numberValue(row?.chat_count),
  };
}

export async function updateUserPicture(userId: string, picture: string | null): Promise<void> {
  await query("UPDATE users SET picture = $1 WHERE id = $2", [picture, userId]);
}

export async function updateUserGoogleId(
  userId: string,
  googleId: string,
  picture: string | null,
): Promise<void> {
  await query(
    "UPDATE users SET google_id = $1, picture = $2 WHERE id = $3",
    [googleId, picture, userId],
  );
}

export async function getChatsByUser(userId: string): Promise<Array<{ id: string; title: string; messages: Msg[] }>> {
  const result = await query(
    "SELECT * FROM chats WHERE user_id = $1 ORDER BY updated_at DESC",
    [userId],
  );
  const rows = result.rows as DbRow[];
  return Promise.all(
    rows.map(async (rawRow) => {
      const row = normalizeChat(rawRow);
      return { id: row.id, title: row.title, messages: await getMessagesByChat(row.id) };
    }),
  );
}

export async function getChatById(
  chatId: string,
): Promise<{ id: string; user_id: string; title: string; messages: Msg[] } | null> {
  const result = await query("SELECT * FROM chats WHERE id = $1 LIMIT 1", [chatId]);
  const rawRow = result.rows[0] as DbRow | undefined;
  if (!rawRow) return null;
  const chat = normalizeChat(rawRow);
  return {
    id: chat.id,
    user_id: chat.user_id,
    title: chat.title,
    messages: await getMessagesByChat(chat.id),
  };
}

export async function createChat(id: string, userId: string, title: string): Promise<void> {
  await query("INSERT INTO chats (id, user_id, title) VALUES ($1, $2, $3)", [id, userId, title]);
}

export async function updateChatTitle(id: string, userId: string, title: string): Promise<boolean> {
  const result = await query(
    "UPDATE chats SET title = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3",
    [title, id, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteChat(id: string): Promise<void> {
  await query("DELETE FROM chats WHERE id = $1", [id]);
}

export async function getMessagesByChat(chatId: string): Promise<Msg[]> {
  const result = await query(
    "SELECT * FROM messages WHERE chat_id = $1 ORDER BY id ASC",
    [chatId],
  );
  return (result.rows as DbRow[]).map(messageFromRow);
}

export async function addMessage(
  chatId: string,
  role: string,
  content: string,
  images?: string[],
  docData?: string,
  kbSources?: KbSource[],
): Promise<void> {
  await withTransaction(async (client: PoolClient) => {
    await client.query(
      `INSERT INTO messages (chat_id, role, content, images, doc_data, kb_sources)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)`,
      [
        chatId,
        role,
        content,
        JSON.stringify(images || []),
        docData || null,
        kbSources && kbSources.length > 0 ? JSON.stringify(kbSources) : null,
      ],
    );
    await client.query("UPDATE chats SET updated_at = NOW() WHERE id = $1", [chatId]);
  });
}

export async function truncateMessagesToCount(chatId: string, keepCount: number): Promise<void> {
  await withTransaction(async (client: PoolClient) => {
    const result = await client.query(
      "SELECT id FROM messages WHERE chat_id = $1 ORDER BY id ASC",
      [chatId],
    );
    const rows = result.rows as DbRow[];
    if (keepCount >= rows.length) return;
    const fromId = numberValue(rows[Math.max(0, keepCount)]?.id);
    await client.query("DELETE FROM messages WHERE chat_id = $1 AND id >= $2", [chatId, fromId]);
    await client.query("UPDATE chats SET updated_at = NOW() WHERE id = $1", [chatId]);
  });
}

export async function storeChunk(chunk: {
  id: string;
  user_id: string;
  chat_id: string | null;
  project_id: string | null;
  document_name: string;
  chunk_index: number;
  content: string;
  embedding: EmbeddingInput;
}): Promise<void> {
  await query(
    `INSERT INTO rag_chunks
       (id, user_id, chat_id, project_id, document_name, chunk_index, content, embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)`,
    [
      chunk.id,
      chunk.user_id,
      chunk.chat_id,
      chunk.project_id,
      chunk.document_name,
      chunk.chunk_index,
      chunk.content,
      serializeEmbedding(chunk.embedding),
    ],
  );
}

export async function getChunksByChat(chatId: string): Promise<RagChunkRow[]> {
  const result = await query(
    "SELECT id, user_id, chat_id, project_id, document_name, chunk_index, content, embedding::text AS embedding, created_at FROM rag_chunks WHERE chat_id = $1 ORDER BY chunk_index ASC",
    [chatId],
  );
  return (result.rows as DbRow[]).map(normalizeRagChunk);
}

export async function getChunksByProject(projectId: string): Promise<RagChunkRow[]> {
  const result = await query(
    "SELECT id, user_id, chat_id, project_id, document_name, chunk_index, content, embedding::text AS embedding, created_at FROM rag_chunks WHERE project_id = $1 ORDER BY document_name, chunk_index ASC",
    [projectId],
  );
  return (result.rows as DbRow[]).map(normalizeRagChunk);
}

export async function hasChunksForChat(chatId: string): Promise<boolean> {
  const result = await query("SELECT EXISTS (SELECT 1 FROM rag_chunks WHERE chat_id = $1) AS present", [chatId]);
  return result.rows[0]?.present === true;
}

export async function searchChunksByChat(
  chatId: string,
  embedding: EmbeddingInput,
  threshold = 0.5,
  limit = 3,
): Promise<Array<{ content: string; score: number; documentName: string }>> {
  const result = await query(
    `SELECT content, document_name, 1 - (embedding <=> $2::vector) AS score
     FROM rag_chunks
     WHERE chat_id = $1 AND 1 - (embedding <=> $2::vector) > $3
     ORDER BY embedding <=> $2::vector
     LIMIT $4`,
    [chatId, serializeEmbedding(embedding), threshold, limit],
  );
  return (result.rows as DbRow[]).map((row) => ({
    content: textValue(row.content),
    score: numberValue(row.score),
    documentName: textValue(row.document_name),
  }));
}

export async function deleteChunksByChat(chatId: string): Promise<void> {
  await query("DELETE FROM rag_chunks WHERE chat_id = $1", [chatId]);
}

export async function deleteChunksByDocument(chatId: string, documentName: string): Promise<void> {
  await query("DELETE FROM rag_chunks WHERE chat_id = $1 AND document_name = $2", [chatId, documentName]);
}

export async function deleteChunksByProject(projectId: string): Promise<void> {
  await query("DELETE FROM rag_chunks WHERE project_id = $1", [projectId]);
}

export async function getAllUsers(): Promise<UserWithCountsRow[]> {
  const result = await query(
    `SELECT u.id, u.email, u.name, u.google_id, u.picture, u.role, u.created_at,
       (SELECT COUNT(*)::int FROM chats WHERE user_id = u.id) AS chat_count,
       (SELECT COUNT(*)::int FROM projects WHERE user_id = u.id) AS project_count,
       COALESCE(
         (SELECT json_agg(a.id ORDER BY a.name)
            FROM area_members m JOIN areas a ON a.id = m.area_id
WHERE m.user_id = u.id AND a.is_active = TRUE),
          '[]'::json
       ) AS area_ids,
       COALESCE(
         (SELECT json_agg(g.id ORDER BY g.name)
            FROM user_group_members gm JOIN user_groups g ON g.id = gm.group_id
           WHERE gm.user_id = u.id AND g.is_active = TRUE),
         '[]'::json
       ) AS group_ids
     FROM users u
     ORDER BY u.created_at DESC`,
  );
  return (result.rows as DbRow[]).map((row) => ({
    id: textValue(row.id),
    email: textValue(row.email),
    name: nullableTextValue(row.name),
    google_id: nullableTextValue(row.google_id),
    picture: nullableTextValue(row.picture),
    role: textValue(row.role, "user") as UserRow["role"],
    created_at: textValue(row.created_at),
    chat_count: numberValue(row.chat_count),
    project_count: numberValue(row.project_count),
    // pg devuelve `json_agg` como array cuando es json y como string si el
    // driver no lo parsea; se aceptan las dos formas.
    area_ids: Array.isArray(row.area_ids)
      ? (row.area_ids as unknown[]).map(String)
      : parseStringArray(row.area_ids),
    group_ids: Array.isArray(row.group_ids)
      ? (row.group_ids as unknown[]).map(String)
      : parseStringArray(row.group_ids),
  })) as UserWithCountsRow[];
}

function parseStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed: unknown = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Impide que la instancia se quede sin un `super_admin`.
 *
 * Solo importa cuando el objetivo ES un super_admin: si es cualquier otro rol,
 * la operación no toca el recuento. Si es el único, degradarlo o borrarlo deja
 * la instancia sin sucesión permanente, porque solo ese rol puede administrar a
 * los demás administradores.
 *
 * `SELECT ... FOR UPDATE` serializa dos administradores que degradan a la vez,
 * que si no podrían agotar el recuento entre ambos.
 */
export class LastSuperAdminError extends Error {
  constructor() {
    super(
      "No se puede dejar la instancia sin super_admin: es el único rol que puede administrar a los demás administradores. Usa 'npm run db:create-admin' como vía de emergencia.",
    );
    this.name = "LastSuperAdminError";
  }
}

/**
 * Bloqueo de serialización para el guard del último `super_admin`.
 *
 * Se necesita un lock global, no solo `FOR UPDATE` sobre la fila objetivo: si
 * hay dos superadmins y cada transacción degrada a uno distinto, cada una
 * bloquea su propia fila, ambas leen `count = 2` y las dos degradan. La
 * instancia se queda sin superadmin y sin vuelta atrás.
 *
 * `pg_advisory_xact_lock` se libera solo al confirmar o revertir, así que no
 * deja el lock huérfano si la transacción falla.
 */
const LAST_SUPER_ADMIN_LOCK_ID = 4_812_301;

async function assertNotRemovingLastSuperAdmin(
  client: Pick<PoolClient, "query">,
  currentRole: string,
  nextRole?: string,
): Promise<void> {
  // El recuento solo baja si se sale de super_admin. Un cambio de nombre u
  // otro campo, o un superadmin que se queda como tal, no lo tocan.
  if (currentRole !== "super_admin") return;
  if (nextRole === "super_admin") return;
  await client.query("SELECT pg_advisory_xact_lock($1)", [LAST_SUPER_ADMIN_LOCK_ID]);
  const countResult = await client.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM users WHERE role = 'super_admin'",
  );
  if ((countResult.rows[0]?.count ?? 0) <= 1) throw new LastSuperAdminError();
}

export async function updateUserRole(userId: string, role: string): Promise<boolean> {
  if (!USER_ROLES.includes(role as (typeof USER_ROLES)[number])) return false;
  return withTransaction(async (client) => {
    const current = await client.query<{ role: string }>(
      "SELECT role FROM users WHERE id = $1 FOR UPDATE",
      [userId],
    );
    const row = current.rows[0];
    if (!row) return false;
    await assertNotRemovingLastSuperAdmin(client, row.role, role);
    const result = await client.query("UPDATE users SET role = $1 WHERE id = $2", [role, userId]);
    return (result.rowCount ?? 0) > 0;
  });
}

export async function updateUserPassword(userId: string, passwordHash: string): Promise<void> {
  await query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, userId]);
}

export async function deleteUserById(userId: string): Promise<void> {
  await withTransaction(async (client) => {
    const current = await client.query<{ role: string }>(
      "SELECT role FROM users WHERE id = $1 FOR UPDATE",
      [userId],
    );
    const row = current.rows[0];
    if (!row) return;
    await assertNotRemovingLastSuperAdmin(client, row.role);
    await client.query("DELETE FROM users WHERE id = $1", [userId]);
  });
}

/** Verifica si queda al menos un super_admin. Alimenta el aviso del panel. */
export async function countSuperAdmins(): Promise<number> {
  const result = await query<{ count: number }>(
    "SELECT count(*)::int AS count FROM users WHERE role = 'super_admin'",
  );
  return result.rows[0]?.count ?? 0;
}

export async function getSystemStats(callerRole?: string): Promise<{
  totalUsers: number;
  totalChats: number;
  totalMessages: number;
  totalProjects: number;
  chatsToday: number;
  messagesToday: number;
  activeUsers: number;
}> {
  const excludeSuperAdmin = Boolean(callerRole && callerRole !== "super_admin");
  const userFilter = excludeSuperAdmin ? "c.user_id IN (SELECT id FROM users WHERE role <> 'super_admin')" : "";
  const projectFilter = excludeSuperAdmin ? "p.user_id IN (SELECT id FROM users WHERE role <> 'super_admin')" : "";
  const messageFilter = excludeSuperAdmin ? userFilter : "";

  const scalar = async (sql: string): Promise<number> => {
    const result = await query(sql);
    return countFromRow(result.rows[0]);
  };

  const [totalUsers, totalChats, totalMessages, totalProjects, chatsToday, messagesToday, activeUsers] =
    await Promise.all([
      scalar(
        `SELECT COUNT(*)::int AS c FROM users u${excludeSuperAdmin ? " WHERE u.role <> 'super_admin'" : ""}`,
      ),
      scalar(`SELECT COUNT(*)::int AS c FROM chats c${excludeSuperAdmin ? ` WHERE ${userFilter}` : ""}`),
      scalar(
        `SELECT COUNT(*)::int AS c FROM messages m JOIN chats c ON c.id = m.chat_id${excludeSuperAdmin ? ` WHERE ${messageFilter}` : ""}`,
      ),
      scalar(
        `SELECT COUNT(*)::int AS c FROM projects p${excludeSuperAdmin ? ` WHERE ${projectFilter}` : ""}`,
      ),
      scalar(
        `SELECT COUNT(*)::int AS c FROM chats c${excludeSuperAdmin ? ` WHERE ${userFilter} AND` : " WHERE"} c.created_at >= CURRENT_DATE AND c.created_at < CURRENT_DATE + INTERVAL '1 day'`,
      ),
      scalar(
        `SELECT COUNT(*)::int AS c FROM messages m JOIN chats c ON c.id = m.chat_id${excludeSuperAdmin ? ` WHERE ${messageFilter} AND` : " WHERE"} m.created_at >= CURRENT_DATE AND m.created_at < CURRENT_DATE + INTERVAL '1 day'`,
      ),
      scalar(
        `SELECT COUNT(DISTINCT c.user_id)::int AS c FROM chats c${excludeSuperAdmin ? ` WHERE ${userFilter} AND` : " WHERE"} c.updated_at >= CURRENT_DATE AND c.updated_at < CURRENT_DATE + INTERVAL '1 day'`,
      ),
    ]);

  return { totalUsers, totalChats, totalMessages, totalProjects, chatsToday, messagesToday, activeUsers };
}

export async function getChatsByUserRaw(userId: string): Promise<ChatRow[]> {
  const result = await query(
    "SELECT * FROM chats WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 10",
    [userId],
  );
  return (result.rows as DbRow[]).map(normalizeChat);
}

export async function getProjectsByUserRaw(userId: string): Promise<ProjectRow[]> {
  const result = await query(
    "SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10",
    [userId],
  );
  return (result.rows as DbRow[]).map(normalizeProject);
}

export async function getUserByIdFull(userId: string): Promise<{
  id: string;
  email: string;
  name: string | null;
  role: string;
  picture: string | null;
  google_id: string | null;
  created_at: string;
  projectCount: number;
  chatCount: number;
  areas: PrincipalRefRow[];
  groups: PrincipalRefRow[];
  recentChats: Array<Pick<ChatRow, "id" | "title" | "created_at" | "updated_at">>;
  recentProjects: Array<Pick<ProjectRow, "id" | "name" | "created_at">>;
} | null> {
  const user = await getUserById(userId);
  if (!user) return null;

  // Áreas y grupos llegan con nombre, no solo el id: la pantalla de detalle los
  // muestra en crudo y no debería tener que cruzarlos con otro endpoint.
  const [stats, chatsResult, projectsResult, areasResult, groupsResult] = await Promise.all([
    getUserStats(userId),
    query(
      "SELECT id, title, created_at, updated_at FROM chats WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 20",
      [userId],
    ),
    query(
      "SELECT id, name, created_at FROM projects WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20",
      [userId],
    ),
    query(
      `SELECT a.id, a.name FROM area_members m
         JOIN areas a ON a.id = m.area_id
        WHERE m.user_id = $1 AND a.is_active = TRUE
        ORDER BY a.name`,
      [userId],
    ),
    query(
      `SELECT g.id, g.name FROM user_group_members gm
         JOIN user_groups g ON g.id = gm.group_id
        WHERE gm.user_id = $1 AND g.is_active = TRUE
        ORDER BY g.name`,
      [userId],
    ),
  ]);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role || "user",
    picture: user.picture,
    google_id: user.google_id,
    created_at: user.created_at,
    ...stats,
    areas: (areasResult.rows as DbRow[]).map((row) => ({
      id: textValue(row.id),
      name: textValue(row.name),
    })),
    groups: (groupsResult.rows as DbRow[]).map((row) => ({
      id: textValue(row.id),
      name: textValue(row.name),
    })),
    recentChats: (chatsResult.rows as DbRow[]).map((row) => ({
      id: textValue(row.id),
      title: textValue(row.title),
      created_at: textValue(row.created_at),
      updated_at: textValue(row.updated_at),
    })),
    recentProjects: (projectsResult.rows as DbRow[]).map((row) => ({
      id: textValue(row.id),
      name: textValue(row.name),
      created_at: textValue(row.created_at),
    })),
  };
}

export async function initHeartsTable(): Promise<void> { return; }

export async function getAllHearts(): Promise<HeartWithOwnerRow[]> {
  const result = await query(
    `SELECT h.*, u.name AS user_name, u.email AS user_email
     FROM hearts h
     LEFT JOIN users u ON h.user_id = u.id
     ORDER BY h.is_preset DESC, h.updated_at DESC`,
  );
  return (result.rows as DbRow[]).map((row) => ({
    ...normalizeHeart(row),
    user_name: nullableTextValue(row.user_name),
    user_email: nullableTextValue(row.user_email),
  })) as HeartWithOwnerRow[];
}

export async function getHeartById(id: string): Promise<HeartRow | null> {
  const result = await query("SELECT * FROM hearts WHERE id = $1 LIMIT 1", [id]);
  const row = result.rows[0] as DbRow | undefined;
  return row ? normalizeHeart(row) : null;
}

export async function createHeart(
  id: string,
  userId: string,
  name: string,
  role?: string,
  tone?: string,
  instructions?: string,
  limitations?: string,
  temperature?: number,
  tools?: string[],
  isPreset?: number,
): Promise<void> {
  await query(
    `INSERT INTO hearts
       (id, user_id, name, role, tone, instructions, limitations, temperature, tools, is_preset)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::boolean)`,
    [
      id,
      userId,
      name,
      role || "",
      tone || "",
      instructions || "",
      limitations || "",
      temperature ?? 0.7,
      JSON.stringify(tools || []),
      booleanValue(isPreset),
    ],
  );
}

export async function updateHeart(id: string, data: Record<string, unknown>): Promise<void> {
  const fields = HEART_UPDATE_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(data, field));
  if (fields.length === 0) return;
  const assignments = fields.map((field, index) => `${field} = $${index + 1}`);
  const values = fields.map((field) => serializeHeartValue(field, data[field]));
  values.push(id);
  await query(
    `UPDATE hearts SET ${assignments.join(", ")}, updated_at = NOW() WHERE id = $${values.length}`,
    values,
  );
}

export async function deleteHeart(id: string): Promise<void> {
  await query("DELETE FROM hearts WHERE id = $1", [id]);
}

export async function getHeartsByUser(userId: string): Promise<HeartRow[]> {
  const result = await query(
    "SELECT * FROM hearts WHERE user_id = $1 ORDER BY updated_at DESC",
    [userId],
  );
  return (result.rows as DbRow[]).map(normalizeHeart);
}

export async function initConfigTable(): Promise<void> { return; }

export async function getAllConfig(): Promise<Array<ConfigRow & { updated_at: string }>> {
  const result = await query("SELECT key, value, description, updated_at FROM config ORDER BY key");
  return (result.rows as DbRow[]).map((row) => ({
    key: textValue(row.key),
    value: textValue(row.value),
    description: textValue(row.description),
    updated_at: textValue(row.updated_at),
  }));
}

export async function getConfig(key: string): Promise<string | null> {
  const result = await query("SELECT value FROM config WHERE key = $1 LIMIT 1", [key]);
  const row = result.rows[0] as DbRow | undefined;
  return row && row.value ? textValue(row.value) : null;
}

export async function setConfig(key: string, value: string, description?: string): Promise<void> {
  await query(
    `INSERT INTO config (key, value, description, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, updated_at = NOW()`,
    [key, value, description || ""],
  );
}

export async function deleteConfig(key: string): Promise<void> {
  await query("DELETE FROM config WHERE key = $1", [key]);
}

/**
 * Configuración por defecto.
 *
 * Solo entran aquí claves que algún código lee de verdad. Antes se sembraban
 * también `allow_registration`, `allow_guest_access`, `default_user_role` y
 * `maintenance_mode`, que se pintaban en el panel como si fueran interruptores
 * y no los leía nadie: el registro público estaba abierto y con el rol fijo
 * `user` por decisión del código, no por el valor de la bandera. Un control que
 * no hace nada en el panel es peor que no tenerlo, porque quien lo ve asume que
 * está activo.
 *
 * `max_chats_per_user` y `max_knowledge_files_per_heart` siguen aquí por
 * compatibilidad con instancias ya sembradas; su consumo se comprueba aparte.
 */
export async function seedDefaultConfig(): Promise<void> {
  const defaults: Record<string, { value: string; description: string }> = {
    max_chats_per_user: { value: "999", description: "Máximo de chats por usuario" },
    max_file_size_mb: { value: "20", description: "Tamaño máximo de archivos (MB)" },
    max_knowledge_files_per_heart: { value: "3", description: "Archivos de conocimiento por Heart" },
    ollama_context_length: { value: "32768", description: "Contexto del modelo (tokens)" },
    ollama_num_predict: { value: "4096", description: "Tokens máximos de respuesta" },
    ollama_temperature: { value: "0.3", description: "Temperatura por defecto del modelo" },
    rate_limit_per_minute: { value: "30", description: "Rate limit por minuto" },
    heart_memory_enabled: { value: "true", description: "Memoria persistente para Hearts" },
    chat_summary_enabled: { value: "true", description: "Resúmenes automáticos de chat" },
  };

  await withTransaction(async (client: PoolClient) => {
    for (const [key, config] of Object.entries(defaults)) {
      await client.query(
        `INSERT INTO config (key, value, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO NOTHING`,
        [key, config.value, config.description],
      );
    }
  });
}

export async function initKnowledgeTable(): Promise<void> { return; }

export async function getKnowledgeEntryById(id: string): Promise<KnowledgeEntryRow | null> {
  const result = await query(
    `SELECT ke.*, CASE WHEN u.role = 'super_admin' THEN '—' ELSE u.name END AS created_by_name
       FROM knowledge_entries ke
       LEFT JOIN users u ON ke.created_by = u.id
      WHERE ke.id = $1`,
    [id],
  );
  return result.rows[0]
    ? ({
        id: textValue(result.rows[0].id),
        title: textValue(result.rows[0].title),
        content: textValue(result.rows[0].content),
        category: textValue(result.rows[0].category, "general"),
        created_by: nullableTextValue(result.rows[0].created_by),
        created_by_name: nullableTextValue(result.rows[0].created_by_name),
        created_at: textValue(result.rows[0].created_at),
        updated_at: textValue(result.rows[0].updated_at),
      } as KnowledgeEntryRow)
    : null;
}

export async function getKnowledgeEntries(category?: string): Promise<KnowledgeEntryRow[]> {
  const baseQuery = `
    SELECT ke.*, CASE WHEN u.role = 'super_admin' THEN '—' ELSE u.name END AS created_by_name
    FROM knowledge_entries ke
    LEFT JOIN users u ON ke.created_by = u.id`;
  const result = category
    ? await query(`${baseQuery} WHERE ke.category = $1 ORDER BY ke.updated_at DESC`, [category])
    : await query(`${baseQuery} ORDER BY ke.updated_at DESC`);
  return (result.rows as DbRow[]).map((row) => ({
    ...row,
    id: textValue(row.id),
    title: textValue(row.title),
    content: textValue(row.content),
    category: textValue(row.category, "general"),
    created_by: nullableTextValue(row.created_by),
    created_by_name: nullableTextValue(row.created_by_name),
    created_at: textValue(row.created_at),
    updated_at: textValue(row.updated_at),
  })) as KnowledgeEntryRow[];
}

export async function createKnowledgeEntry(
  id: string,
  title: string,
  content: string,
  category: string,
  createdBy: string,
): Promise<void> {
  await query(
    "INSERT INTO knowledge_entries (id, title, content, category, created_by) VALUES ($1, $2, $3, $4, $5)",
    [id, title, content, category, createdBy],
  );
}

export async function deleteKnowledgeEntry(id: string): Promise<void> {
  await query("DELETE FROM knowledge_entries WHERE id = $1", [id]);
}

export async function updateKnowledgeEntry(
  id: string,
  title: string,
  content: string,
  category: string,
): Promise<void> {
  await query(
    "UPDATE knowledge_entries SET title = $1, content = $2, category = $3, updated_at = NOW() WHERE id = $4",
    [title, content, category, id],
  );
}

export async function initKbTables(): Promise<void> { return; }

export async function getKbCategories(): Promise<KbCategoryWithCounts[]> {
  const result = await query(
    `SELECT c.*,
       (SELECT COUNT(*)::int FROM kb_files f WHERE f.category_id = c.id) AS file_count,
       (SELECT COUNT(*)::int FROM kb_files f WHERE f.category_id = c.id AND f.status = 'active') AS active_count
     FROM kb_categories c
     ORDER BY CASE WHEN c.name = 'general' THEN 0 ELSE 1 END, c.label ASC`,
  );
  return (result.rows as DbRow[]).map((row) => ({
    ...normalizeCategory(row),
    file_count: numberValue(row.file_count),
    active_count: numberValue(row.active_count),
  })) as KbCategoryWithCounts[];
}

export async function getKbCategoryById(id: string): Promise<KbCategory | null> {
  const result = await query("SELECT * FROM kb_categories WHERE id = $1 LIMIT 1", [id]);
  const row = result.rows[0] as DbRow | undefined;
  return row ? normalizeCategory(row) : null;
}

export async function getKbCategoryBySlug(name: string): Promise<KbCategory | null> {
  const result = await query("SELECT * FROM kb_categories WHERE name = $1 LIMIT 1", [name]);
  const row = result.rows[0] as DbRow | undefined;
  return row ? normalizeCategory(row) : null;
}

export async function createKbCategory(name: string, label: string): Promise<KbCategory | null> {
  const slug = slugify(name);
  const id = crypto.randomUUID();
  await query("INSERT INTO kb_categories (id, name, label) VALUES ($1, $2, $3)", [id, slug, label.trim()]);
  const category = await getKbCategoryById(id);
  return category;
}

export async function updateKbCategory(
  id: string,
  data: { name?: string; label?: string },
): Promise<boolean> {
  const category = await getKbCategoryById(id);
  if (!category) return false;
  if (category.name === "general" && data.name && data.name !== "general") return false;
  const name = data.name ? slugify(data.name) : category.name;
  const label = data.label !== undefined ? data.label.trim() : category.label;
  const result = await query(
    "UPDATE kb_categories SET name = $1, label = $2, updated_at = NOW() WHERE id = $3",
    [name, label, id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteKbCategory(id: string): Promise<boolean> {
  const category = await getKbCategoryById(id);
  if (!category || category.name === "general") return false;
  const result = await query("DELETE FROM kb_categories WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function getKbFiles(filters?: {
  categoryId?: string;
  status?: string;
  search?: string;
}): Promise<KbFile[]> {
  let sql = `
    SELECT f.*, c.name AS category_name, c.label AS category_label,
      u.name AS uploader_name,
      cf.filename AS conflict_with_filename,
      (SELECT COUNT(*)::int FROM kb_chunks kc WHERE kc.file_id = f.id) AS chunk_count
    FROM kb_files f
    LEFT JOIN kb_categories c ON f.category_id = c.id
    LEFT JOIN users u ON f.uploaded_by = u.id
    LEFT JOIN kb_files cf ON f.conflict_with = cf.id
    WHERE 1=1`;
  const params: unknown[] = [];
  if (filters?.categoryId) {
    params.push(filters.categoryId);
    sql += ` AND f.category_id = $${params.length}`;
  }
  if (filters?.status) {
    params.push(filters.status);
    sql += ` AND f.status = $${params.length}`;
  }
  if (filters?.search) {
    params.push(`%${filters.search}%`, `%${filters.search}%`);
    sql += ` AND (f.filename ILIKE $${params.length - 1} OR f.content ILIKE $${params.length})`;
  }
  sql += " ORDER BY f.created_at DESC";
  const result = await query(sql, params);
  return (result.rows as DbRow[]).map(normalizeKbFile);
}

export async function getKbFileById(id: string): Promise<KbFile | null> {
  const result = await query(
    `SELECT f.*, c.name AS category_name, c.label AS category_label,
      u.name AS uploader_name,
      cf.filename AS conflict_with_filename
     FROM kb_files f
     LEFT JOIN kb_categories c ON f.category_id = c.id
     LEFT JOIN users u ON f.uploaded_by = u.id
     LEFT JOIN kb_files cf ON f.conflict_with = cf.id
     WHERE f.id = $1
     LIMIT 1`,
    [id],
  );
  const row = result.rows[0] as DbRow | undefined;
  return row ? normalizeKbFile(row) : null;
}

export async function insertKbFile(data: {
  id: string;
  filename: string;
  format: string;
  size_bytes?: number;
  category_id?: string | null;
  status?: string;
  conflict_with?: string | null;
  content?: string;
  checksum?: string | null;
  uploaded_by?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO kb_files
       (id, filename, format, size_bytes, category_id, status, conflict_with, content, checksum, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      data.id,
      data.filename,
      data.format,
      data.size_bytes || 0,
      data.category_id ?? null,
      data.status || "processing",
      data.conflict_with ?? null,
      data.content || "",
      data.checksum ?? null,
      data.uploaded_by ?? null,
    ],
  );
}

export async function updateKbFile(
  id: string,
  data: Record<string, unknown>,
  includeUpdatedAt = true,
): Promise<void> {
  const fields = KB_FILE_UPDATE_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(data, field));
  if (fields.length === 0) return;
  const assignments = fields.map((field, index) => `${field} = $${index + 1}`);
  const values = fields.map((field) => serializeKbValue(field, data[field]));
  if (includeUpdatedAt) assignments.push("updated_at = NOW()");
  values.push(id);
  await query(`UPDATE kb_files SET ${assignments.join(", ")} WHERE id = $${values.length}`, values);
}

export async function deleteKbFileById(id: string): Promise<boolean> {
  return withTransaction(async (client: PoolClient) => {
    await client.query("UPDATE kb_files SET conflict_with = NULL WHERE conflict_with = $1", [id]);
    const result = await client.query("DELETE FROM kb_files WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  });
}

export async function findKbFileByName(name: string): Promise<KbFile[]> {
  const result = await query(
    "SELECT * FROM kb_files WHERE filename = $1 ORDER BY created_at DESC",
    [name],
  );
  return (result.rows as DbRow[]).map(normalizeKbFile);
}


export async function storeKbChunks(
  chunks: Array<{
    id: string;
    file_id: string;
    category_id: string | null;
    chunk_index: number;
    content: string;
    embedding: EmbeddingInput;
  }>,
): Promise<void> {
  if (chunks.length === 0) return;
  await withTransaction(async (client: PoolClient) => {
    for (const chunk of chunks) {
      await client.query(
        `INSERT INTO kb_chunks (id, file_id, category_id, chunk_index, content, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::vector)`,
        [
          chunk.id,
          chunk.file_id,
          chunk.category_id,
          chunk.chunk_index,
          chunk.content,
          serializeEmbedding(chunk.embedding),
        ],
      );
    }
  });
}

export async function getKbChunksByFile(fileId: string): Promise<KbChunk[]> {
  const result = await query(
    "SELECT id, file_id, category_id, chunk_index, content, embedding::text AS embedding, created_at FROM kb_chunks WHERE file_id = $1 ORDER BY chunk_index ASC",
    [fileId],
  );
  return (result.rows as DbRow[]).map(normalizeKbChunk);
}

export async function countKbChunksByFile(fileId: string): Promise<number> {
  const result = await query("SELECT COUNT(*)::int AS c FROM kb_chunks WHERE file_id = $1", [fileId]);
  return countFromRow(result.rows[0]);
}

export async function deleteKbChunksByFile(fileId: string): Promise<void> {
  await query("DELETE FROM kb_chunks WHERE file_id = $1", [fileId]);
}

export async function updateKbChunksCategory(fileId: string, categoryId: string | null): Promise<void> {
  await query("UPDATE kb_chunks SET category_id = $1 WHERE file_id = $2", [categoryId, fileId]);
}



/**
 * Búsqueda sin restricción de categoría. Reservada al bypass de `admin`/
 * `super_admin`, que gestionan el perímetro de la KB en lugar de consultarla.
 */
export async function searchKbChunks(
  embedding: EmbeddingInput,
  threshold = 0.5,
  limit = 5,
): Promise<Array<KbChunk & { filename: string; score: number }>> {
  const result = await query(
    `SELECT kc.id, kc.file_id, kc.category_id, kc.chunk_index, kc.content,
            kc.created_at, f.filename,
            1 - (kc.embedding <=> $1::vector) AS score
       FROM kb_chunks kc
       JOIN kb_files f ON f.id = kc.file_id
      WHERE f.status = 'active'
        AND 1 - (kc.embedding <=> $1::vector) > $2
      ORDER BY kc.embedding <=> $1::vector
      LIMIT $3`,
    [serializeEmbedding(embedding), threshold, limit],
  );
  return (result.rows as DbRow[]).map((row) => ({
    ...normalizeKbChunk(row),
    filename: textValue(row.filename, "documento"),
    score: numberValue(row.score),
  }));
}

export async function migrateKnowledgeEntriesToKb(): Promise<{ migrated: number; failed: number }> {
  return { migrated: 0, failed: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Áreas, grupos y grants de acceso a la KB
//
// `kb_categories` NO participa en la decisión de acceso: es clasificación para
// el dashboard y el vocabulario de las acciones en lote. Autorizar contra el
// archivo (`kb_file_id`) es lo que elimina la deriva entre `kb_files.category_id`
// y `kb_chunks.category_id`.
// ─────────────────────────────────────────────────────────────────────────────

function normalizeArea(row: DbRow): Area {
  return {
    id: textValue(row.id),
    key: textValue(row.key),
    name: textValue(row.name),
    description: textValue(row.description),
    parent_id: nullableTextValue(row.parent_id),
    source: (textValue(row.source, "manual") as "manual" | "google"),
    external_id: nullableTextValue(row.external_id),
    is_active: booleanValue(row.is_active),
    member_count: row.member_count === undefined ? undefined : numberValue(row.member_count),
    grant_count: row.grant_count === undefined ? undefined : numberValue(row.grant_count),
    created_at: textValue(row.created_at),
    updated_at: textValue(row.updated_at),
  };
}

function normalizeUserGroup(row: DbRow): UserGroup {
  return {
    id: textValue(row.id),
    key: textValue(row.key),
    name: textValue(row.name),
    description: textValue(row.description),
    source: (textValue(row.source, "manual") as "manual" | "google"),
    external_id: nullableTextValue(row.external_id),
    is_active: booleanValue(row.is_active),
    is_system: booleanValue(row.is_system),
    member_count: row.member_count === undefined ? undefined : numberValue(row.member_count),
    grant_count: row.grant_count === undefined ? undefined : numberValue(row.grant_count),
    created_at: textValue(row.created_at),
    updated_at: textValue(row.updated_at),
  };
}

function normalizeGrant(row: DbRow): KbAccessGrant {
  return {
    id: textValue(row.id),
    principal_type: textValue(row.principal_type) as PrincipalType,
    principal_id: textValue(row.principal_id),
    principal_name: textValue(row.principal_name, "—"),
    kb_file_id: textValue(row.kb_file_id),
    filename: textValue(row.filename, "documento"),
    category_label: nullableTextValue(row.category_label),
    permission: "read",
    granted_by: nullableTextValue(row.granted_by),
    granted_by_name: nullableTextValue(row.granted_by_name),
    created_at: textValue(row.created_at),
  };
}

// ─── Áreas ─────────────────────────────────────────────────────────────────

export async function getAreas(options: { includeInactive?: boolean } = {}): Promise<Area[]> {
  const result = await query(
    `SELECT a.*,
       (SELECT count(*)::int FROM area_members m WHERE m.area_id = a.id) AS member_count,
       (SELECT count(*)::int FROM kb_access_grants g
         WHERE g.principal_type = 'area' AND g.principal_id = a.id) AS grant_count
     FROM areas a
     ${options.includeInactive ? "" : "WHERE a.is_active = TRUE"}
     ORDER BY a.name COLLATE "C"`,
  );
  return (result.rows as DbRow[]).map(normalizeArea);
}

export async function getAreaById(id: string): Promise<Area | null> {
  const result = await query("SELECT * FROM areas WHERE id = $1", [id]);
  return result.rows[0] ? normalizeArea(result.rows[0] as DbRow) : null;
}

export async function createArea(input: {
  key: string;
  name: string;
  description?: string;
  parentId?: string | null;
}): Promise<Area> {
  const result = await query(
    `INSERT INTO areas (key, name, description, parent_id)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.key, input.name, input.description ?? "", input.parentId ?? null],
  );
  return normalizeArea(result.rows[0] as DbRow);
}

const AREA_UPDATE_FIELDS = ["name", "description", "parent_id", "is_active"] as const;

export async function updateArea(id: string, patch: Record<string, unknown>): Promise<boolean> {
  const fields = AREA_UPDATE_FIELDS.filter((field) => patch[field] !== undefined);
  if (fields.length === 0) return false;
  const sets = fields.map((field, index) => `${field} = $${index + 2}`);
  const values = fields.map((field) => patch[field]);
  const result = await query(
    `UPDATE areas SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1`,
    [id, ...values],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Las áreas se desactivan en lugar de borrarse. Sus grants sobreviven, así que
 * `principal_id` (sin FK polimórfica) nunca queda huérfano y el rastro de
 * auditoría permanece consultable.
 */
export async function deactivateArea(id: string): Promise<boolean> {
  const result = await query(
    "UPDATE areas SET is_active = FALSE, updated_at = NOW() WHERE id = $1",
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function addAreaMember(
  areaId: string,
  userId: string,
  addedBy?: string | null,
): Promise<boolean> {
  const result = await query(
    `INSERT INTO area_members (area_id, user_id, added_by) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [areaId, userId, addedBy ?? null],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function removeAreaMember(areaId: string, userId: string): Promise<boolean> {
  const result = await query("DELETE FROM area_members WHERE area_id = $1 AND user_id = $2", [
    areaId,
    userId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

export async function getAreaIdsForUser(userId: string): Promise<string[]> {
  const result = await query(
    `SELECT m.area_id FROM area_members m
       JOIN areas a ON a.id = m.area_id
      WHERE m.user_id = $1 AND a.is_active = TRUE`,
    [userId],
  );
  return (result.rows as DbRow[]).map((row) => textValue(row.area_id));
}

export async function getAreaMemberIds(areaId: string): Promise<string[]> {
  const result = await query("SELECT user_id FROM area_members WHERE area_id = $1", [areaId]);
  return (result.rows as DbRow[]).map((row) => textValue(row.user_id));
}

// ─── Grupos ────────────────────────────────────────────────────────────────

export async function getUserGroups(options: { includeInactive?: boolean } = {}): Promise<UserGroup[]> {
  const result = await query(
    `SELECT g.*,
       (SELECT count(*)::int FROM user_group_members m WHERE m.group_id = g.id) AS member_count,
       (SELECT count(*)::int FROM kb_access_grants gr
         WHERE gr.principal_type = 'group' AND gr.principal_id = g.id) AS grant_count
     FROM user_groups g
     ${options.includeInactive ? "" : "WHERE g.is_active = TRUE"}
     ORDER BY g.name COLLATE "C"`,
  );
  return (result.rows as DbRow[]).map(normalizeUserGroup);
}

export async function getUserGroupById(id: string): Promise<UserGroup | null> {
  const result = await query("SELECT * FROM user_groups WHERE id = $1", [id]);
  return result.rows[0] ? normalizeUserGroup(result.rows[0] as DbRow) : null;
}

export async function createUserGroup(input: {
  key: string;
  name: string;
  description?: string;
}): Promise<UserGroup> {
  const result = await query(
    "INSERT INTO user_groups (key, name, description) VALUES ($1, $2, $3) RETURNING *",
    [input.key, input.name, input.description ?? ""],
  );
  return normalizeUserGroup(result.rows[0] as DbRow);
}

/**
 * Campos que un grupo admite en una edición.
 *
 * `is_active` NO está aquí, y es deliberado. Desactivar un grupo revoca sus
 * grants, así que solo puede ocurrir por `deactivateUserGroup`, que lo hace en
 * una transacción con `FOR UPDATE`. Si esta lista incluyera `is_active`,
 * cualquier llamante futuro podría desactivarlo sin revocar, y quedaría un
 * grupo inactivo que sigue concediendo lectura para quien reactiven la fila.
 * Dejar el campo fuera convierte la invariante en algo estructural: no depende
 * de que cada ruta que llama a esta función recuerde la regla.
 *
 * La asimetría con las áreas es intencionada y va en el otro sentido:
 * desactivar un área conserva sus grants, y como `AREA_UPDATE_FIELDS` incluye
 * `is_active` y `deactivateArea` solo hace lo mismo, las dos rutas de área
 * significan exactamente lo mismo.
 */
const GROUP_UPDATE_FIELDS = ["name", "description"] as const;

export async function updateUserGroup(id: string, patch: Record<string, unknown>): Promise<boolean> {
  const fields = GROUP_UPDATE_FIELDS.filter((field) => patch[field] !== undefined);
  if (fields.length === 0) return false;
  const sets = fields.map((field, index) => `${field} = $${index + 2}`);
  const values = fields.map((field) => patch[field]);
  const result = await query(
    `UPDATE user_groups SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1`,
    [id, ...values],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Desactiva el grupo y retira sus grants (dejarían de resolver). */
export async function deactivateUserGroup(id: string): Promise<boolean> {
  return withTransaction(async (client) => {
    const group = await client.query<{ is_system: boolean }>(
      "SELECT is_system FROM user_groups WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (!group.rows[0] || group.rows[0].is_system) return false;
    await client.query("UPDATE user_groups SET is_active = FALSE, updated_at = NOW() WHERE id = $1", [id]);
    await client.query(
      "DELETE FROM kb_access_grants WHERE principal_type = 'group' AND principal_id = $1",
      [id],
    );
    return true;
  });
}

export async function addGroupMember(
  groupId: string,
  userId: string,
  addedBy?: string | null,
): Promise<boolean> {
  const result = await query(
    `INSERT INTO user_group_members (group_id, user_id, added_by) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [groupId, userId, addedBy ?? null],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function removeGroupMember(groupId: string, userId: string): Promise<boolean> {
  const result = await query("DELETE FROM user_group_members WHERE group_id = $1 AND user_id = $2", [
    groupId,
    userId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

export async function getGroupIdsForUser(userId: string): Promise<string[]> {
  const result = await query(
    `SELECT m.group_id FROM user_group_members m
       JOIN user_groups g ON g.id = m.group_id
      WHERE m.user_id = $1 AND g.is_active = TRUE`,
    [userId],
  );
  return (result.rows as DbRow[]).map((row) => textValue(row.group_id));
}

export async function getGroupMemberIds(groupId: string): Promise<string[]> {
  const result = await query("SELECT user_id FROM user_group_members WHERE group_id = $1", [groupId]);
  return (result.rows as DbRow[]).map((row) => textValue(row.user_id));
}

// ─── Grants ────────────────────────────────────────────────────────────────

const GRANT_SELECT = `
  SELECT gr.*, f.filename, c.label AS category_label,
         a.name AS area_name, g.name AS group_name,
         u.name AS granted_by_name
    FROM kb_access_grants gr
    JOIN kb_files f ON f.id = gr.kb_file_id
    LEFT JOIN kb_categories c ON c.id = f.category_id
    LEFT JOIN areas a ON a.id = gr.principal_id AND gr.principal_type = 'area'
    LEFT JOIN user_groups g ON g.id = gr.principal_id AND gr.principal_type = 'group'
    LEFT JOIN users u ON u.id = gr.granted_by`;

function withPrincipalName(row: DbRow): DbRow {
  const area = nullableTextValue(row.area_name);
  const group = nullableTextValue(row.group_name);
  return { ...row, principal_name: area ?? group ?? "—" };
}

export async function getKbAccessGrants(
  options: { fileId?: string; principalType?: PrincipalType; principalId?: string } = {},
): Promise<KbAccessGrant[]> {
  const filters: string[] = [];
  const values: unknown[] = [];
  if (options.fileId) {
    values.push(options.fileId);
    filters.push(`gr.kb_file_id = $${values.length}`);
  }
  if (options.principalId) {
    values.push(options.principalType ?? "area");
    filters.push(`gr.principal_type = $${values.length}`);
    values.push(options.principalId);
    filters.push(`gr.principal_id = $${values.length}`);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const result = await query(`${GRANT_SELECT} ${where} ORDER BY f.filename, gr.created_at DESC`, values);
  return (result.rows as DbRow[]).map((row) => normalizeGrant(withPrincipalName(row)));
}

export async function grantKbFileAccess(input: {
  principalType: PrincipalType;
  principalId: string;
  kbFileId: string;
  grantedBy: string;
}): Promise<boolean> {
  const result = await query(
    `INSERT INTO kb_access_grants (principal_type, principal_id, kb_file_id, permission, granted_by)
     VALUES ($1, $2, $3, 'read', $4)
     ON CONFLICT (principal_type, principal_id, kb_file_id) DO NOTHING`,
    [input.principalType, input.principalId, input.kbFileId, input.grantedBy],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Otorgamiento en lote. Devuelve cuántos grants realmente se crearon. */
export async function grantKbFileAccessBulk(input: {
  principalType: PrincipalType;
  principalId: string;
  kbFileIds: string[];
  grantedBy: string;
}): Promise<number> {
  if (input.kbFileIds.length === 0) return 0;
  const result = await query(
    `INSERT INTO kb_access_grants (principal_type, principal_id, kb_file_id, permission, granted_by)
     SELECT $1, $2, f.id, 'read', $3
       FROM kb_files f
      WHERE f.id = ANY($4::uuid[])
     ON CONFLICT (principal_type, principal_id, kb_file_id) DO NOTHING`,
    [input.principalType, input.principalId, input.grantedBy, input.kbFileIds],
  );
  return result.rowCount ?? 0;
}

export async function revokeKbFileAccess(input: {
  principalType: PrincipalType;
  principalId: string;
  kbFileId: string;
}): Promise<boolean> {
  const result = await query(
    `DELETE FROM kb_access_grants
      WHERE principal_type = $1 AND principal_id = $2 AND kb_file_id = $3`,
    [input.principalType, input.principalId, input.kbFileId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function revokeKbFileAccessBulk(input: {
  principalType: PrincipalType;
  principalId: string;
  kbFileIds: string[];
}): Promise<number> {
  if (input.kbFileIds.length === 0) return 0;
  const result = await query(
    `DELETE FROM kb_access_grants
      WHERE principal_type = $1 AND principal_id = $2 AND kb_file_id = ANY($3::uuid[])`,
    [input.principalType, input.principalId, input.kbFileIds],
  );
  return result.rowCount ?? 0;
}

/** Principios que el usuario puede recibir lectura (áreas + grupos). */
export async function getKbPrincipalsForUser(userId: string): Promise<KbPrincipalRef[]> {
  const result = await query(
    `SELECT 'area' AS type, a.id, a.name
       FROM area_members m JOIN areas a ON a.id = m.area_id
      WHERE m.user_id = $1 AND a.is_active = TRUE
     UNION
     SELECT 'group' AS type, g.id, g.name
       FROM user_group_members m JOIN user_groups g ON g.id = m.group_id
      WHERE m.user_id = $1 AND g.is_active = TRUE
     ORDER BY type, name`,
    [userId],
  );
  return (result.rows as DbRow[]).map((row) => ({
    type: textValue(row.type) as PrincipalType,
    id: textValue(row.id),
    name: textValue(row.name),
  }));
}

// ─── Resolución de acceso ──────────────────────────────────────────────────
//
// Sin caché a propósito: cachear el ACL retrasaría las revocaciones. Con el
// volumen actual son una o dos consultas de menos de un milisegundo.

/**
 * Subconsulta de pertenencia a un principio con grant, usando `$1` como userId.
 *
 * Los `JOIN` con `is_active` son los que hacen que desactivar un área o un
 * grupo corte el acceso de inmediato. Sin ellos, un área desactivada seguiría
 * concediendo lectura y la desactivación sería solo decorativa.
 *
 * Se escribe una vez como constante porque las funciones del panel la
 * necesitan dos veces (listado y predicado) y una discrepancia entre ambas
 * significaría que un archivo aparece en la lista pero no se puede abrir.
 */
const PANEL_GRANT_SQL = `EXISTS (
  SELECT 1 FROM kb_access_grants gr
   WHERE gr.kb_file_id = f.id
     AND ( (gr.principal_type = 'area'
            AND EXISTS (SELECT 1 FROM area_members m
                         JOIN areas a ON a.id = m.area_id AND a.is_active = TRUE
                        WHERE m.user_id = $1 AND m.area_id = gr.principal_id))
        OR (gr.principal_type = 'group'
            AND EXISTS (SELECT 1 FROM user_group_members gm
                         JOIN user_groups g ON g.id = gm.group_id AND g.is_active = TRUE
                        WHERE gm.user_id = $1 AND gm.group_id = gr.principal_id)) )
)`;

/**
 * IDs de archivos que el usuario puede leer.
 *
 * Los `JOIN` con `is_active` son los que hacen que desactivar un área o un grupo
 * corte el acceso de inmediato. Sin ellos, un área desactivada seguiría
 * concediendo lectura y la desactivación sería solo decorativa.
 */
export async function getAccessibleKbFileIds(userId: string): Promise<string[]> {
  const result = await query(
    `SELECT DISTINCT gr.kb_file_id
       FROM kb_access_grants gr
       JOIN kb_files f ON f.id = gr.kb_file_id AND f.status = 'active'
      WHERE (
              gr.principal_type = 'area'
              AND EXISTS (
                SELECT 1
                  FROM area_members m
                  JOIN areas a ON a.id = m.area_id AND a.is_active = TRUE
                 WHERE m.user_id = $1 AND m.area_id = gr.principal_id
              )
            )
         OR (
              gr.principal_type = 'group'
              AND EXISTS (
                SELECT 1
                  FROM user_group_members gm
                  JOIN user_groups g ON g.id = gm.group_id AND g.is_active = TRUE
                 WHERE gm.user_id = $1 AND gm.group_id = gr.principal_id
              )
            )`,
    [userId],
  );
  return (result.rows as DbRow[]).map((row) => textValue(row.kb_file_id));
}

export async function canAccessKbFile(userId: string, kbFileId: string): Promise<boolean> {
  const result = await query<{ allowed: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM kb_access_grants gr
         JOIN kb_files f ON f.id = gr.kb_file_id AND f.status = 'active'
        WHERE gr.kb_file_id = $2
          AND ( (gr.principal_type = 'area'
                 AND EXISTS (SELECT 1 FROM area_members m
                              JOIN areas a ON a.id = m.area_id AND a.is_active = TRUE
                             WHERE m.user_id = $1 AND m.area_id = gr.principal_id))
             OR (gr.principal_type = 'group'
                 AND EXISTS (SELECT 1 FROM user_group_members gm
                              JOIN user_groups g ON g.id = gm.group_id AND g.is_active = TRUE
                             WHERE gm.user_id = $1 AND gm.group_id = gr.principal_id)) )
     ) AS allowed`,
    [userId, kbFileId],
  );
  return result.rows[0]?.allowed === true;
}

/**
 * Búsqueda de fragmentos sujeta al ACL. La restricción se resuelve con
 * subconsultas sobre la membresía para no pasar arrays de UUIDs.
 *
 * Un filtro muy selectivo puede batir al índice HNSW con un seq scan; con el
 * volumen actual da igual, así que no se mide todavía.
 */
export async function searchKbChunksByAccess(
  userId: string,
  embedding: EmbeddingInput,
  threshold = 0.5,
  limit = 5,
): Promise<Array<KbChunk & { filename: string; score: number }>> {
  const result = await query(
    `SELECT kc.id, kc.file_id, kc.category_id, kc.chunk_index, kc.content,
            kc.created_at, f.filename,
            1 - (kc.embedding <=> $1::vector) AS score
       FROM kb_chunks kc
       JOIN kb_files f ON f.id = kc.file_id
      WHERE f.status = 'active'
        AND kc.file_id IN (
          SELECT gr.kb_file_id
            FROM kb_access_grants gr
           WHERE (gr.principal_type = 'area'
                  AND EXISTS (
                    SELECT 1 FROM area_members m
                      JOIN areas a ON a.id = m.area_id AND a.is_active = TRUE
                     WHERE m.user_id = $2 AND m.area_id = gr.principal_id
                  ))
              OR (gr.principal_type = 'group'
                  AND EXISTS (
                    SELECT 1 FROM user_group_members gm
                      JOIN user_groups g ON g.id = gm.group_id AND g.is_active = TRUE
                     WHERE gm.user_id = $2 AND gm.group_id = gr.principal_id
                  ))
        )
        AND 1 - (kc.embedding <=> $1::vector) > $3
      ORDER BY kc.embedding <=> $1::vector
      LIMIT $4`,
    [serializeEmbedding(embedding), userId, threshold, limit],
  );
  return (result.rows as DbRow[]).map((row) => ({
    ...normalizeKbChunk(row),
    filename: textValue(row.filename, "documento"),
    score: numberValue(row.score),
  }));
}

/**
 * Chunks vecinos para la expansión contextual, con el nombre de archivo y la
 * categoría resueltos en la misma consulta.
 *
 * Deliberadamente NO trae `embedding`: la expansión solo necesita file_id,
 * chunk_index y content. Antes, la versión por categorías serializaba el vector
 * completo (1024 floats) de todos los chunks de la base en cada mensaje.
 */
export async function getKbChunksByFileIds(
  fileIds: string[],
): Promise<Array<KbChunk & { filename: string; category_name: string | null }>> {
  if (fileIds.length === 0) return [];
  const result = await query(
    `SELECT kc.id, kc.file_id, kc.category_id, kc.chunk_index, kc.content,
            kc.created_at, f.filename, c.name AS category_name
       FROM kb_chunks kc
       JOIN kb_files f ON f.id = kc.file_id
       LEFT JOIN kb_categories c ON c.id = f.category_id
      WHERE kc.file_id = ANY($1::uuid[])
      ORDER BY kc.file_id, kc.chunk_index`,
    [fileIds],
  );
  return (result.rows as DbRow[]).map((row) => ({
    ...normalizeKbChunk(row),
    filename: textValue(row.filename, "documento"),
    category_name: nullableTextValue(row.category_name),
  }));
}

/** Archivos que el usuario puede leer, ya filtrados por estado activo. */
export async function listKbFilesVisibleTo(
  userId: string,
  options: { categoryId?: string; status?: string; search?: string } = {},
): Promise<KbFile[]> {
  const filters = ["f.status = 'active'"];
  const values: unknown[] = [userId];
  if (options.categoryId) {
    values.push(options.categoryId);
    filters.push(`f.category_id = $${values.length}`);
  }
  if (options.status) {
    values.push(options.status);
    filters.push(`f.status = $${values.length}`);
  }
  if (options.search) {
    values.push(`%${options.search}%`);
    filters.push(`(f.filename ILIKE $${values.length} OR f.content ILIKE $${values.length})`);
  }
  const result = await query(
    `SELECT f.*, c.name AS category_name, c.label AS category_label,
            u.name AS uploader_name,
            (SELECT count(*)::int FROM kb_chunks kc WHERE kc.file_id = f.id) AS chunk_count
       FROM kb_files f
       LEFT JOIN kb_categories c ON c.id = f.category_id
       LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE ${filters.join(" AND ")}
        AND f.id IN (
          SELECT gr.kb_file_id
            FROM kb_access_grants gr
           WHERE (gr.principal_type = 'area'
                  AND EXISTS (
                    SELECT 1 FROM area_members m
                      JOIN areas a ON a.id = m.area_id AND a.is_active = TRUE
                     WHERE m.user_id = $1 AND m.area_id = gr.principal_id
                  ))
              OR (gr.principal_type = 'group'
                  AND EXISTS (
                    SELECT 1 FROM user_group_members gm
                      JOIN user_groups g ON g.id = gm.group_id AND g.is_active = TRUE
                     WHERE gm.user_id = $1 AND gm.group_id = gr.principal_id
                  ))
        )
      ORDER BY f.created_at DESC`,
    values,
  );
  return (result.rows as DbRow[]).map(normalizeKbFile);
}

/**
 * Los archivos que el panel de administración puede mostrar a este usuario.
 *
 * Es el listado de quien está *adentro* del panel (`editor`), no el de quien
 * consulta el chat, y por eso su alcance es más amplio en un caso concreto: lo
 * que el propio usuario subió.
 *
 * `listKbFilesVisibleTo` responde a una pregunta distinta y más estrecha: "qué
 * puede leer un usuario de la base de conocimiento". Ahí la subida propia no
 * cuenta, porque leer no es preparar contenido. Un archivo recién subido vive
 * en `pending_review`, todavía no está indexado y a un solo grant de ser
 * visible: verlo desde el chat saltaría la cola de revisión.
 *
 * En el panel, en cambio, el `editor` necesita comprobar que la extracción de
 * texto funcionó y que el chunking salió bien. Eso es preparar contenido, no
 * leerlo. Y no tiene nada de estima: el grant sigue siendo la única vía por la
 * que el archivo se vuelve legible para el resto, aprobar sigue siendo del
 * perímetro, y un archivo propio que el `editor` puede ver no es un archivo que
 * pueda aprobar.
 *
 * Por eso es `uploaded_by = user OR (active AND con grant)`: la condición del
 * grant sigue exigiendo `status = 'active'` y la condición de autoría no
 * relaja ninguna.
 */
export async function listKbFilesVisibleToPanel(
  userId: string,
  options: { categoryId?: string; status?: string; search?: string } = {},
): Promise<KbFile[]> {
  const filters: string[] = [];
  const values: unknown[] = [userId];
  // Fijado en el SQL, no en options: el listado del panel puede filtrar por
  // estado, pero el estado nunca puede ser el criterio que decide el acceso.
  filters.push(`(f.uploaded_by = $1 OR (f.status = 'active' AND ${PANEL_GRANT_SQL}))`);
  if (options.categoryId) {
    values.push(options.categoryId);
    filters.push(`f.category_id = $${values.length}`);
  }
  if (options.status) {
    values.push(options.status);
    filters.push(`f.status = $${values.length}`);
  }
  if (options.search) {
    values.push(`%${options.search}%`);
    filters.push(`(f.filename ILIKE $${values.length} OR f.content ILIKE $${values.length})`);
  }
  const result = await query(
    `SELECT f.*, c.name AS category_name, c.label AS category_label,
            u.name AS uploader_name,
            (SELECT count(*)::int FROM kb_chunks kc WHERE kc.file_id = f.id) AS chunk_count
       FROM kb_files f
       LEFT JOIN kb_categories c ON f.category_id = c.id
       LEFT JOIN users u ON f.uploaded_by = u.id
      WHERE ${filters.join(" AND ")}
      ORDER BY f.created_at DESC`,
    values,
  );
  return (result.rows as DbRow[]).map(normalizeKbFile);
}

/**
 * ¿Este usuario puede leer el contenido de este archivo en el panel?
 *
 * Mismo criterio que `listKbFilesVisibleToPanel`: propio, o active con grant.
 * El bypass del perímetro no está aquí, lo resuelve quien llama con el rol.
 *
 * El `uploaded_by` se resuelve en la misma consulta que el ACL a propósito: dos
 * consultas dejarían una ventana entre "es mío" y "lo leo" que no sirve para
 * un predicado de autorización.
 */
export async function canAccessKbFileFromPanel(userId: string, kbFileId: string): Promise<boolean> {
  const result = await query<{ allowed: boolean }>(
    `SELECT (
       f.uploaded_by = $1
       OR (f.status = 'active' AND ${PANEL_GRANT_SQL})
     ) AS allowed
       FROM kb_files f
      WHERE f.id = $2
      LIMIT 1`,
    [userId, kbFileId],
  );
  return result.rows[0]?.allowed === true;
}

/** Archivos activos que aún no tienen ningún grant: nadie puede leerlos. */
export async function listKbFilesWithoutGrants(): Promise<Array<KbFile & { grant_count: number }>> {
  const result = await query(
    `SELECT f.*, c.name AS category_name, c.label AS category_label,
            u.name AS uploader_name,
            (SELECT count(*)::int FROM kb_chunks kc WHERE kc.file_id = f.id) AS chunk_count,
            (SELECT count(*)::int FROM kb_access_grants g WHERE g.kb_file_id = f.id) AS grant_count
       FROM kb_files f
       LEFT JOIN kb_categories c ON c.id = f.category_id
       LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE f.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM kb_access_grants g WHERE g.kb_file_id = f.id)
      ORDER BY f.created_at DESC`,
  );
  return (result.rows as DbRow[]).map((row) => ({
    ...normalizeKbFile(row),
    grant_count: numberValue(row.grant_count),
  }));
}


export async function getChatWithMessages(chatId: string): Promise<ChatWithOwnerRow | null> {
  const result = await query(
    `SELECT c.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM chats c
     LEFT JOIN users u ON c.user_id = u.id
     WHERE c.id = $1
     LIMIT 1`,
    [chatId],
  );
  const rawChat = result.rows[0] as DbRow | undefined;
  if (!rawChat) return null;
  const messagesResult = await query(
    "SELECT * FROM messages WHERE chat_id = $1 ORDER BY id ASC",
    [chatId],
  );
  const chat = normalizeChat(rawChat);
  return {
    ...chat,
    user_name: nullableTextValue(rawChat.user_name),
    user_email: nullableTextValue(rawChat.user_email),
    user_role: nullableTextValue(rawChat.user_role),
    messages: (messagesResult.rows as DbRow[]).map(normalizeMessageRow),
  } as ChatWithOwnerRow;
}

export async function getAllProjectsAdmin(search = ""): Promise<ProjectAdminRow[]> {
  let sql = `
    SELECT p.*, u.name AS user_name, u.email AS user_email, u.role AS user_role,
      (SELECT COUNT(*)::int FROM project_chats pc WHERE pc.project_id = p.id) AS chat_count
    FROM projects p
    LEFT JOIN users u ON p.user_id = u.id`;
  const params: unknown[] = [];
  if (search) {
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    sql += ` WHERE (p.name ILIKE $1 OR u.name ILIKE $2 OR u.email ILIKE $3)`;
  }
  sql += " ORDER BY p.created_at DESC LIMIT 200";
  const result = await query(sql, params);
  return (result.rows as DbRow[]).map((row) => ({
    ...normalizeProject(row),
    user_name: nullableTextValue(row.user_name),
    user_email: nullableTextValue(row.user_email),
    user_role: nullableTextValue(row.user_role),
    chat_count: numberValue(row.chat_count),
  })) as ProjectAdminRow[];
}

export async function getAllChatsAdmin(search = ""): Promise<ChatAdminRow[]> {
  let sql = `
    SELECT c.id, c.title, c.created_at, c.updated_at, c.user_id, c.heart_id,
      u.name AS user_name, u.email AS user_email, u.role AS user_role,
      (SELECT COUNT(*)::int FROM messages WHERE chat_id = c.id) AS message_count,
      (SELECT content FROM messages WHERE chat_id = c.id ORDER BY id DESC LIMIT 1) AS last_message
    FROM chats c
    LEFT JOIN users u ON c.user_id = u.id`;
  const params: unknown[] = [];
  if (search) {
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    sql += ` WHERE (c.title ILIKE $1 OR u.name ILIKE $2 OR u.email ILIKE $3)`;
  }
  sql += " ORDER BY c.updated_at DESC LIMIT 500";
  const result = await query(sql, params);
  return (result.rows as DbRow[]).map((row) => ({
    ...normalizeChat(row),
    user_name: nullableTextValue(row.user_name),
    user_email: nullableTextValue(row.user_email),
    user_role: nullableTextValue(row.user_role),
    message_count: numberValue(row.message_count),
    last_message: nullableTextValue(row.last_message),
  })) as ChatAdminRow[];
}

export async function initAuditTable(): Promise<void> { return; }

export async function logAudit(
  userId: string | null,
  action: string,
  details = "",
  ip = "",
): Promise<void> {
  await query(
    "INSERT INTO audit_log (user_id, action, details, ip) VALUES ($1, $2, $3, $4)",
    [userId, action, details || "", ip || ""],
  );
}

export async function getAuditLogs(
  limit = 100,
  offset = 0,
  action?: string,
  userId?: string,
  callerRole?: string,
): Promise<AuditLogRow[]> {
  let sql = `
    SELECT a.*, u.name AS user_name, u.email AS user_email
    FROM audit_log a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE 1=1`;
  const params: unknown[] = [];
  if (callerRole && callerRole !== "super_admin") {
    params.push("super_admin");
    sql += ` AND (u.role IS NULL OR u.role <> $${params.length})`;
  }
  if (action) {
    params.push(action);
    sql += ` AND a.action = $${params.length}`;
  }
  if (userId) {
    params.push(userId);
    sql += ` AND a.user_id = $${params.length}`;
  }
  params.push(limit, offset);
  sql += ` ORDER BY a.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
  const result = await query(sql, params);
  return (result.rows as DbRow[]).map(normalizeAuditLog);
}

export async function countAuditLogs(
  action?: string,
  userId?: string,
  callerRole?: string,
): Promise<number> {
  let sql = "SELECT COUNT(*)::int AS c FROM audit_log a LEFT JOIN users u ON a.user_id = u.id WHERE 1=1";
  const params: unknown[] = [];
  if (callerRole && callerRole !== "super_admin") {
    params.push("super_admin");
    sql += ` AND (u.role IS NULL OR u.role <> $${params.length})`;
  }
  if (action) {
    params.push(action);
    sql += ` AND a.action = $${params.length}`;
  }
  if (userId) {
    params.push(userId);
    sql += ` AND a.user_id = $${params.length}`;
  }
  const result = await query(sql, params);
  return countFromRow(result.rows[0]);
}

export async function getAuditActions(): Promise<Array<{ action: string }>> {
  const result = await query("SELECT DISTINCT action FROM audit_log ORDER BY action");
  return (result.rows as DbRow[]).map((row) => ({ action: textValue(row.action) }));
}

export async function initAnnouncementsTable(): Promise<void> { return; }

export async function getAnnouncementById(id: string): Promise<AnnouncementRow | null> {
  const result = await query(
    `SELECT a.*, CASE WHEN u.role = 'super_admin' THEN '—' ELSE u.name END AS created_by_name
       FROM announcements a
       LEFT JOIN users u ON a.created_by = u.id
      WHERE a.id = $1`,
    [id],
  );
  return result.rows[0] ? normalizeAnnouncement(result.rows[0] as DbRow) : null;
}

export async function getAnnouncements(activeOnly = false): Promise<AnnouncementRow[]> {
  let sql = `
    SELECT a.*, CASE WHEN u.role = 'super_admin' THEN '—' ELSE u.name END AS created_by_name
    FROM announcements a
    LEFT JOIN users u ON a.created_by = u.id`;
  if (activeOnly) sql += " WHERE a.active = TRUE";
  sql += " ORDER BY a.created_at DESC";
  const result = await query(sql);
  return (result.rows as DbRow[]).map(normalizeAnnouncement);
}

export async function getActiveAnnouncements(): Promise<AnnouncementRow[]> {
  const announcements = await getAnnouncements(true);
  return announcements;
}

export async function createAnnouncement(
  id: string,
  title: string,
  content: string,
  type: string,
  createdBy: string,
): Promise<void> {
  await query(
    "INSERT INTO announcements (id, title, content, type, created_by) VALUES ($1, $2, $3, $4, $5)",
    [id, title, content, type, createdBy],
  );
}

export async function updateAnnouncement(id: string, data: Record<string, unknown>): Promise<void> {
  const fields = ANNOUNCEMENT_UPDATE_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(data, field),
  );
  if (fields.length === 0) return;
  const assignments = fields.map((field, index) => `${field} = $${index + 1}`);
  const values = fields.map((field) => (field === "active" ? booleanValue(data[field]) : data[field] ?? null));
  values.push(id);
  await query(
    `UPDATE announcements SET ${assignments.join(", ")}, updated_at = NOW() WHERE id = $${values.length}`,
    values,
  );
}

export async function deleteAnnouncement(id: string): Promise<void> {
  await query("DELETE FROM announcements WHERE id = $1", [id]);
}

export async function initBackupsTable(): Promise<void> { return; }

export async function createBackup(id: string, filename: string, createdBy: string): Promise<void> {
  await query("INSERT INTO backups (id, filename, created_by) VALUES ($1, $2, $3)", [
    id,
    filename,
    createdBy,
  ]);
}

export async function updateBackupStatus(id: string, status: string, sizeBytes?: number): Promise<void> {
  if (sizeBytes !== undefined) {
    await query("UPDATE backups SET status = $1, size_bytes = $2 WHERE id = $3", [status, sizeBytes, id]);
  } else {
    await query("UPDATE backups SET status = $1 WHERE id = $2", [status, id]);
  }
}

export async function getBackups(limit = 20): Promise<BackupRow[]> {
  const result = await query(
    `SELECT b.*, u.name AS created_by_name
     FROM backups b
     LEFT JOIN users u ON b.created_by = u.id
     ORDER BY b.created_at DESC
     LIMIT $1`,
    [limit],
  );
  return (result.rows as DbRow[]).map(normalizeBackup);
}

export async function hasData(): Promise<boolean> {
  const result = await query("SELECT COUNT(*)::int AS count FROM chats");
  return countFromRow(result.rows[0], "count") > 0;
}

export async function createAttachment(data: {
  id: string;
  message_id?: string | null;
  kb_file_id?: string | null;
  uploaded_by?: string | null;
  bucket: string;
  object_key: string;
  original_filename: string;
  mime_type: string;
  extension: string;
  size_bytes: number;
  checksum_sha256?: string | null;
  status?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await query(
    `INSERT INTO attachments
       (id, message_id, kb_file_id, uploaded_by, bucket, object_key, original_filename,
        mime_type, extension, size_bytes, checksum_sha256, status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
    [
      data.id,
      data.message_id || null,
      data.kb_file_id || null,
      data.uploaded_by || null,
      data.bucket,
      data.object_key,
      data.original_filename,
      data.mime_type,
      data.extension,
      data.size_bytes,
      data.checksum_sha256 || null,
      data.status || "ready",
      JSON.stringify(data.metadata || {}),
    ],
  );
}

export async function getAttachmentsByKbFile(kbFileId: string): Promise<Array<{ id: string; bucket: string; object_key: string; original_filename: string; mime_type: string }>> {
  const result = await query(
    "SELECT id, bucket, object_key, original_filename, mime_type FROM attachments WHERE kb_file_id = $1 AND status <> 'deleted'",
    [kbFileId],
  );
  return (result.rows as DbRow[]).map((row) => ({
    id: textValue(row.id),
    bucket: textValue(row.bucket),
    object_key: textValue(row.object_key),
    original_filename: textValue(row.original_filename),
    mime_type: textValue(row.mime_type),
  }));
}

export async function deleteAttachment(id: string): Promise<void> {
  await query("DELETE FROM attachments WHERE id = $1", [id]);
}

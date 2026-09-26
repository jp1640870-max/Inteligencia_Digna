import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { Pool, type PoolClient } from "pg";

type Row = Record<string, unknown>;

type ImportSummary = {
  inserted: Record<string, number>;
  skipped: Record<string, number>;
};

const idMap = new Map<string, string>();
const summary: ImportSummary = { inserted: {}, skipped: {} };

function loadEnvironment(): void {
  for (const fileName of [".env", ".env.local"]) {
    const filePath = resolve(process.cwd(), fileName);
    if (existsSync(filePath)) process.loadEnvFile(filePath);
  }
}

function increment(group: "inserted" | "skipped", table: string): void {
  summary[group][table] = (summary[group][table] || 0) + 1;
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined || value === "" ? null : String(value);
}

function jsonValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(value);
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function roleValue(value: unknown): string {
  const role = text(value) || "user";
  return ["super_admin", "admin", "editor", "viewer", "power_user", "user", "restricted"].includes(role)
    ? role
    : "user";
}

function uuidFor(value: unknown): string {
  const input = text(value);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input)) return input;
  const digest = createHash("sha256").update(`inteligencia-digna:${input}`).digest("hex");
  const variant = ((parseInt(digest.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function mappedId(table: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const source = text(value);
  const key = `${table}:${source}`;
  const mapped = idMap.get(key) || uuidFor(key);
  idMap.set(key, mapped);
  return mapped;
}

function vectorValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed) || parsed.length !== 1024 || parsed.some((item) => typeof item !== "number" || !Number.isFinite(item))) return null;
  return `[${parsed.join(",")}]`;
}

function hasTable(db: Database.Database, table: string): boolean {
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(table);
  return Boolean(row);
}

function rows(db: Database.Database, table: string): Row[] {
  if (!hasTable(db, table)) return [];
  return db.prepare(`SELECT * FROM "${table}"`).all() as Row[];
}

async function insert(client: PoolClient, sql: string, values: unknown[], table: string): Promise<void> {
  const result = await client.query(sql, values);
  increment((result.rowCount || 0) > 0 ? "inserted" : "skipped", table);
}

async function importUsers(client: PoolClient, source: Row[]): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const row of source) {
    const id = mappedId("users", row.id);
    if (!id) continue;
    ids.add(id);
    await insert(
      client,
      `INSERT INTO users (id, email, name, password_hash, google_id, picture, role, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, NOW()))
       ON CONFLICT (id) DO NOTHING`,
      [id, text(row.email), nullableText(row.name), nullableText(row.password_hash), nullableText(row.google_id), nullableText(row.picture), roleValue(row.role), nullableText(row.created_at)],
      "users",
    );
  }
  return ids;
}

async function importHearts(client: PoolClient, source: Row[], userIds: Set<string>): Promise<void> {
  for (const row of source) {
    const id = mappedId("hearts", row.id);
    const userId = mappedId("users", row.user_id);
    if (!id || !userId || !userIds.has(userId)) {
      increment("skipped", "hearts");
      continue;
    }
    await insert(
      client,
      `INSERT INTO hearts (id, user_id, name, role, tone, instructions, limitations, temperature, knowledge_files, tools, agent_memory, is_public, is_preset, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, COALESCE($14::timestamptz, NOW()), COALESCE($15::timestamptz, NOW()))
       ON CONFLICT (id) DO NOTHING`,
      [id, userId, text(row.name), text(row.role), text(row.tone), text(row.instructions), text(row.limitations), Number(row.temperature) || 0.7, jsonValue(row.knowledge_files) || "[]", jsonValue(row.tools) || "[]", text(row.agent_memory), booleanValue(row.is_public), booleanValue(row.is_preset), nullableText(row.created_at), nullableText(row.updated_at)],
      "hearts",
    );
  }
}

async function importProjects(client: PoolClient, source: Row[], userIds: Set<string>): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const row of source) {
    const id = mappedId("projects", row.id);
    const userId = mappedId("users", row.user_id);
    if (!id || !userId || !userIds.has(userId)) {
      increment("skipped", "projects");
      continue;
    }
    ids.add(id);
    await insert(
      client,
      `INSERT INTO projects (id, user_id, name, instructions, created_at)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()))
       ON CONFLICT (id) DO NOTHING`,
      [id, userId, text(row.name), text(row.instructions), nullableText(row.created_at)],
      "projects",
    );
  }
  return ids;
}

async function importChats(client: PoolClient, source: Row[], userIds: Set<string>): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const row of source) {
    const id = mappedId("chats", row.id);
    const userId = mappedId("users", row.user_id);
    const heartId = mappedId("hearts", row.heart_id);
    if (!id || !userId || !userIds.has(userId)) {
      increment("skipped", "chats");
      continue;
    }
    ids.add(id);
    await insert(
      client,
      `INSERT INTO chats (id, user_id, title, heart_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), COALESCE($6::timestamptz, NOW()))
       ON CONFLICT (id) DO NOTHING`,
      [id, userId, text(row.title), heartId, nullableText(row.created_at), nullableText(row.updated_at)],
      "chats",
    );
  }
  return ids;
}

async function importMessages(client: PoolClient, source: Row[], chatIds: Set<string>): Promise<Map<string, string>> {
  const messageIds = new Map<string, string>();
  for (const row of source) {
    const chatId = mappedId("chats", row.chat_id);
    if (!chatId || !chatIds.has(chatId)) {
      increment("skipped", "messages");
      continue;
    }
    const result = await client.query(
      `INSERT INTO messages (chat_id, role, content, images, files, doc_data, kb_sources, legacy_id, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, COALESCE($9::timestamptz, NOW()))
       ON CONFLICT (legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [chatId, ["user", "assistant", "system"].includes(text(row.role)) ? text(row.role) : "user", text(row.content), jsonValue(row.images) || "[]", jsonValue(row.files) || "[]", jsonValue(row.doc_data), jsonValue(row.kb_sources), row.id === undefined ? null : Number(row.id), nullableText(row.created_at)],
    );
    if (result.rows[0] && row.id !== undefined) {
      messageIds.set(text(row.id), String(result.rows[0].id));
      increment("inserted", "messages");
    } else {
      increment("skipped", "messages");
    }
  }
  return messageIds;
}

async function importProjectChats(client: PoolClient, source: Row[], projectIds: Set<string>, chatIds: Set<string>): Promise<void> {
  for (const row of source) {
    const projectId = mappedId("projects", row.project_id);
    const chatId = mappedId("chats", row.chat_id);
    if (!projectId || !chatId || !projectIds.has(projectId) || !chatIds.has(chatId)) {
      increment("skipped", "project_chats");
      continue;
    }
    await insert(
      client,
      `INSERT INTO project_chats (project_id, chat_id, chat_title, added_at)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()))
       ON CONFLICT (project_id, chat_id) DO NOTHING`,
      [projectId, chatId, text(row.chat_title), nullableText(row.added_at)],
      "project_chats",
    );
  }
}

async function importConfig(client: PoolClient, source: Row[]): Promise<void> {
  for (const row of source) {
    await insert(
      client,
      `INSERT INTO config (key, value, description, updated_at)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()))
       ON CONFLICT (key) DO NOTHING`,
      [text(row.key), text(row.value), text(row.description), nullableText(row.updated_at)],
      "config",
    );
  }
}

async function importKnowledgeEntries(client: PoolClient, source: Row[], users: Set<string>): Promise<void> {
  for (const row of source) {
    const id = mappedId("knowledge_entries", row.id);
    const userId = nullableText(row.created_by) ? mappedId("users", row.created_by) : null;
    if (!id || (row.created_by && (!userId || !users.has(userId)))) {
      increment("skipped", "knowledge_entries");
      continue;
    }
    await insert(
      client,
      `INSERT INTO knowledge_entries (id, title, content, category, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()), COALESCE($7::timestamptz, NOW()))
       ON CONFLICT (id) DO NOTHING`,
      [id, text(row.title), text(row.content), text(row.category) || "general", userId, nullableText(row.created_at), nullableText(row.updated_at)],
      "knowledge_entries",
    );
  }
}

async function importCategories(client: PoolClient, source: Row[]): Promise<Map<string, string>> {
  const categories = new Map<string, string>();
  for (const row of source) {
    const existing = await client.query("SELECT id FROM kb_categories WHERE name = $1 LIMIT 1", [text(row.name)]);
    if (existing.rows[0]) {
      categories.set(text(row.id), String(existing.rows[0].id));
      increment("skipped", "kb_categories");
      continue;
    }
    const id = mappedId("kb_categories", row.id);
    if (!id) continue;
    categories.set(text(row.id), id);
    await insert(
      client,
      `INSERT INTO kb_categories (id, name, label, created_at, updated_at)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()), COALESCE($5::timestamptz, NOW()))
       ON CONFLICT (id) DO NOTHING`,
      [id, text(row.name), text(row.label), nullableText(row.created_at), nullableText(row.updated_at)],
      "kb_categories",
    );
  }
  return categories;
}

async function importKbFiles(client: PoolClient, source: Row[], categories: Map<string, string>, userIds: Set<string>): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const row of source) {
    const id = mappedId("kb_files", row.id);
    const categoryId = nullableText(row.category_id) ? categories.get(text(row.category_id)) || null : null;
    const userId = nullableText(row.uploaded_by) ? mappedId("users", row.uploaded_by) : null;
    if (!id || (row.uploaded_by && (!userId || !userIds.has(userId)))) {
      increment("skipped", "kb_files");
      continue;
    }
    files.set(text(row.id), id);
    await insert(
      client,
      `INSERT INTO kb_files (id, filename, format, size_bytes, category_id, status, content, checksum, uploaded_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, NOW()), COALESCE($11::timestamptz, NOW()))
       ON CONFLICT (id) DO NOTHING`,
      [id, text(row.filename), text(row.format), Number(row.size_bytes) || 0, categoryId, text(row.status) || "processing", text(row.content), nullableText(row.checksum), userId, nullableText(row.created_at), nullableText(row.updated_at)],
      "kb_files",
    );
  }
  for (const row of source) {
    const id = mappedId("kb_files", row.id);
    const conflictId = nullableText(row.conflict_with) ? mappedId("kb_files", row.conflict_with) : null;
    if (id && conflictId) await client.query("UPDATE kb_files SET conflict_with = $1 WHERE id = $2", [conflictId, id]);
  }
  return files;
}

async function importKbChunks(client: PoolClient, source: Row[], files: Map<string, string>, categories: Map<string, string>): Promise<void> {
  for (const row of source) {
    const fileId = files.get(text(row.file_id));
    const embedding = vectorValue(row.embedding);
    if (!fileId || !embedding) {
      increment("skipped", "kb_chunks");
      continue;
    }
    const categoryId = nullableText(row.category_id) ? categories.get(text(row.category_id)) || null : null;
    await insert(
      client,
      `INSERT INTO kb_chunks (id, file_id, category_id, chunk_index, content, embedding, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::vector, COALESCE($7::timestamptz, NOW()))
       ON CONFLICT DO NOTHING`,
      [mappedId("kb_chunks", row.id), fileId, categoryId, Number(row.chunk_index) || 0, text(row.content), embedding, nullableText(row.created_at)],
      "kb_chunks",
    );
  }
}

async function importRagChunks(client: PoolClient, source: Row[], users: Set<string>, chats: Set<string>, projects: Set<string>): Promise<void> {
  for (const row of source) {
    const userId = mappedId("users", row.user_id);
    const chatId = mappedId("chats", row.chat_id);
    const projectId = mappedId("projects", row.project_id);
    const embedding = vectorValue(row.embedding);
    if (!userId || !users.has(userId) || !embedding) {
      increment("skipped", "rag_chunks");
      continue;
    }
    const validChatId = row.chat_id && chatId && chats.has(chatId) ? chatId : null;
    const validProjectId = row.project_id && projectId && projects.has(projectId) ? projectId : null;
    if (row.chat_id && !validChatId) increment("skipped", "rag_chunks_orphaned_chat");
    if (row.project_id && !validProjectId) increment("skipped", "rag_chunks_orphaned_project");
    await insert(
      client,
      `INSERT INTO rag_chunks (id, user_id, chat_id, project_id, document_name, chunk_index, content, embedding, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, COALESCE($9::timestamptz, NOW()))
       ON CONFLICT (id) DO NOTHING`,
      [mappedId("rag_chunks", row.id), userId, validChatId, validProjectId, text(row.document_name), Number(row.chunk_index) || 0, text(row.content), embedding, nullableText(row.created_at)],
      "rag_chunks",
    );
  }
}

async function importAudit(client: PoolClient, source: Row[], users: Set<string>): Promise<void> {
  for (const row of source) {
    const userId = nullableText(row.user_id) ? mappedId("users", row.user_id) : null;
    if (row.user_id && (!userId || !users.has(userId))) {
      increment("skipped", "audit_log");
      continue;
    }
    await insert(
      client,
      `INSERT INTO audit_log (user_id, action, details, ip, created_at)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()))`,
      [userId, text(row.action), text(row.details), text(row.ip), nullableText(row.created_at)],
      "audit_log",
    );
  }
}

async function importAnnouncements(client: PoolClient, source: Row[], users: Set<string>): Promise<void> {
  for (const row of source) {
    const userId = nullableText(row.created_by) ? mappedId("users", row.created_by) : null;
    if (row.created_by && (!userId || !users.has(userId))) {
      increment("skipped", "announcements");
      continue;
    }
    await insert(
      client,
      `INSERT INTO announcements (id, title, content, type, active, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, NOW()), COALESCE($8::timestamptz, NOW()))
       ON CONFLICT (id) DO NOTHING`,
      [mappedId("announcements", row.id), text(row.title), text(row.content), text(row.type) || "info", booleanValue(row.active), userId, nullableText(row.created_at), nullableText(row.updated_at)],
      "announcements",
    );
  }
}

async function importBackups(client: PoolClient, source: Row[], users: Set<string>): Promise<void> {
  for (const row of source) {
    const userId = nullableText(row.created_by) ? mappedId("users", row.created_by) : null;
    if (row.created_by && (!userId || !users.has(userId))) {
      increment("skipped", "backups");
      continue;
    }
    await insert(
      client,
      `INSERT INTO backups (id, filename, size_bytes, status, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()))
       ON CONFLICT (id) DO NOTHING`,
      [mappedId("backups", row.id), text(row.filename), Number(row.size_bytes) || 0, text(row.status) || "pending", userId, nullableText(row.created_at)],
      "backups",
    );
  }
}

async function main(): Promise<void> {
  loadEnvironment();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Falta DATABASE_URL");
  const sourcePath = resolve(process.cwd(), process.env.SQLITE_PATH || "data/app.db");
  if (!existsSync(sourcePath)) throw new Error(`No existe SQLite: ${sourcePath}`);

  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  const target = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const client = await target.connect();
    try {
      await client.query("BEGIN");
      const users = await importUsers(client, rows(source, "users"));
      await importHearts(client, rows(source, "hearts"), users);
      const projects = await importProjects(client, rows(source, "projects"), users);
      const chats = await importChats(client, rows(source, "chats"), users);
      await importMessages(client, rows(source, "messages"), chats);
      await importProjectChats(client, rows(source, "project_chats"), projects, chats);
      await importConfig(client, rows(source, "config"));
      await importKnowledgeEntries(client, rows(source, "knowledge_entries"), users);
      const categories = await importCategories(client, rows(source, "kb_categories"));
      const files = await importKbFiles(client, rows(source, "kb_files"), categories, users);
      await importKbChunks(client, rows(source, "kb_chunks"), files, categories);
      await importRagChunks(client, rows(source, "rag_chunks"), users, chats, projects);
      await importAudit(client, rows(source, "audit_log"), users);
      await importAnnouncements(client, rows(source, "announcements"), users);
      await importBackups(client, rows(source, "backups"), users);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    source.close();
    await target.end();
  }
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

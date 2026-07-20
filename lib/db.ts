import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "app.db");

let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      password_hash TEXT,
      google_id TEXT UNIQUE,
      picture TEXT,
      role TEXT DEFAULT 'user',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL DEFAULT '',
      images TEXT,
      files TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
  `);

  try { db.exec("ALTER TABLE users ADD COLUMN picture TEXT"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'"); } catch {}
  try { db.exec("ALTER TABLE messages ADD COLUMN doc_data TEXT"); } catch {}
  try { db.exec("ALTER TABLE chats ADD COLUMN heart_id TEXT REFERENCES hearts(id)"); } catch {}

  // Inicializar tablas de admin
  initHeartsTable();
  seedDefaultConfig();

  db.exec(`
    CREATE TABLE IF NOT EXISTS rag_chunks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      chat_id TEXT,
      project_id TEXT,
      document_name TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_rag_chunks_chat ON rag_chunks(chat_id)"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_rag_chunks_user ON rag_chunks(user_id)"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_rag_chunks_project ON rag_chunks(project_id)"); } catch {}
}

/* ============ USERS ============ */

export function createUser(
  id: string,
  email: string,
  name: string | null,
  passwordHash?: string,
  googleId?: string,
  picture?: string,
  role?: string
) {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO users (id, email, name, password_hash, google_id, picture, role)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, email, name, passwordHash || null, googleId || null, picture || null, role || "user");
}

export function getUserByEmail(email: string) {
  const d = getDb();
  return d.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
}

export function getUserByGoogleId(googleId: string) {
  const d = getDb();
  return d.prepare("SELECT * FROM users WHERE google_id = ?").get(googleId) as any;
}

export function getUserById(id: string) {
  const d = getDb();
  return d.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;
}

export function getUserStats(userId: string) {
  const d = getDb();
  const projectCount = (d.prepare("SELECT COUNT(*) as count FROM projects WHERE user_id = ?").get(userId) as any)?.count || 0;
  const chatCount = (d.prepare("SELECT COUNT(*) as count FROM chats WHERE user_id = ?").get(userId) as any)?.count || 0;
  return { projectCount, chatCount };
}

export function updateUserPicture(userId: string, picture: string | null) {
  const d = getDb();
  d.prepare("UPDATE users SET picture = ? WHERE id = ?").run(picture, userId);
}

export function updateUserGoogleId(userId: string, googleId: string, picture: string | null) {
  const d = getDb();
  d.prepare("UPDATE users SET google_id = ?, picture = ? WHERE id = ?").run(googleId, picture, userId);
}

/* ============ CHATS ============ */

export function getChatsByUser(userId: string) {
  const d = getDb();
  const rows = d
    .prepare("SELECT * FROM chats WHERE user_id = ? ORDER BY updated_at DESC")
    .all(userId) as any[];

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    messages: getMessagesByChat(row.id),
  }));
}

export function getChatById(chatId: string) {
  const d = getDb();
  const chat = d.prepare("SELECT * FROM chats WHERE id = ?").get(chatId) as any;
  if (!chat) return null;
  return {
    id: chat.id,
    user_id: chat.user_id,
    title: chat.title,
    messages: getMessagesByChat(chat.id),
  };
}

export function createChat(id: string, userId: string, title: string) {
  const d = getDb();
  d.prepare("INSERT INTO chats (id, user_id, title) VALUES (?, ?, ?)").run(
    id,
    userId,
    title
  );
}

export function updateChatTitle(id: string, userId: string, title: string) {
  const d = getDb();
  const result = d.prepare(
    "UPDATE chats SET title = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?"
  ).run(title, id, userId);

  return result.changes > 0;
}

export function deleteChat(id: string) {
  const d = getDb();
  d.prepare("DELETE FROM chats WHERE id = ?").run(id);
}

/* ============ MESSAGES ============ */

const CONTENT_TYPE_MAP: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

export function getMessagesByChat(chatId: string) {
  const d = getDb();
  const rows = d
    .prepare("SELECT * FROM messages WHERE chat_id = ? ORDER BY id ASC")
    .all(chatId) as any[];

  return rows.map((row) => {
    const msg: any = {
      id: row.id,
      role: row.role === "assistant" ? "ai" : (row.role as "user" | "ai"),
      text: row.content,
      images: row.images ? JSON.parse(row.images) : undefined,
    };

    if (row.doc_data) {
      try {
        const doc = JSON.parse(row.doc_data);
        const mime = CONTENT_TYPE_MAP[doc.format] || "application/octet-stream";
        msg.editResult = {
          success: true,
          format: doc.format,
          filename: doc.filename,
          originalName: doc.filename,
          changesCount: doc.changesCount || 0,
          dataUri: `data:${mime};base64,${doc.data}`,
        };
      } catch {}
    }

    return msg;
  });
}

export function addMessage(
  chatId: string,
  role: string,
  content: string,
  images?: string[],
  docData?: string
) {
  const d = getDb();
  d.prepare(
    "INSERT INTO messages (chat_id, role, content, images, doc_data) VALUES (?, ?, ?, ?, ?)"
  ).run(chatId, role, content, images ? JSON.stringify(images) : null, docData || null);

  d.prepare("UPDATE chats SET updated_at = datetime('now') WHERE id = ?").run(
    chatId
  );
}

export function truncateMessagesToCount(chatId: string, keepCount: number) {
  const d = getDb();
  const rows = d
    .prepare("SELECT id FROM messages WHERE chat_id = ? ORDER BY id ASC")
    .all(chatId) as any[];
  if (keepCount >= rows.length) return;
  const fromId = rows[Math.max(0, keepCount)].id;
  d.prepare("DELETE FROM messages WHERE chat_id = ? AND id >= ?").run(
    chatId,
    fromId
  );
  d.prepare("UPDATE chats SET updated_at = datetime('now') WHERE id = ?").run(
    chatId
  );
}

/* ============ RAG CHUNKS ============ */

export function storeChunk(chunk: {
  id: string;
  user_id: string;
  chat_id: string | null;
  project_id: string | null;
  document_name: string;
  chunk_index: number;
  content: string;
  embedding: string;
}) {
  const d = getDb();
  d.prepare(`
    INSERT INTO rag_chunks (id, user_id, chat_id, project_id, document_name, chunk_index, content, embedding)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(chunk.id, chunk.user_id, chunk.chat_id, chunk.project_id, chunk.document_name, chunk.chunk_index, chunk.content, chunk.embedding);
}

export function getChunksByChat(chatId: string) {
  const d = getDb();
  return d.prepare("SELECT * FROM rag_chunks WHERE chat_id = ? ORDER BY chunk_index ASC").all(chatId) as any[];
}

export function getChunksByProject(projectId: string) {
  const d = getDb();
  return d.prepare("SELECT * FROM rag_chunks WHERE project_id = ? ORDER BY document_name, chunk_index ASC").all(projectId) as any[];
}

export function deleteChunksByChat(chatId: string) {
  const d = getDb();
  d.prepare("DELETE FROM rag_chunks WHERE chat_id = ?").run(chatId);
}

export function deleteChunksByDocument(chatId: string, documentName: string) {
  const d = getDb();
  d.prepare("DELETE FROM rag_chunks WHERE chat_id = ? AND document_name = ?").run(chatId, documentName);
}

export function deleteChunksByProject(projectId: string) {
  const d = getDb();
  d.prepare("DELETE FROM rag_chunks WHERE project_id = ?").run(projectId);
}

/* ============ ADMIN ============ */

export function getAllUsers() {
  const d = getDb();
  return d
    .prepare(`
      SELECT u.*,
        (SELECT COUNT(*) FROM chats WHERE user_id = u.id) AS chat_count,
        (SELECT COUNT(*) FROM projects WHERE user_id = u.id) AS project_count
      FROM users u
      ORDER BY u.created_at DESC
    `)
    .all() as any[];
}

export function updateUserRole(userId: string, role: string) {
  const d = getDb();
  const validRoles = ["user", "super_admin", "admin", "editor", "viewer"];
  if (!validRoles.includes(role)) return false;
  const r = d.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);
  return r.changes > 0;
}

export function updateUserPassword(userId: string, passwordHash: string) {
  const d = getDb();
  d.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
}

export function deleteUserById(userId: string) {
  const d = getDb();
  d.prepare("DELETE FROM users WHERE id = ?").run(userId);
}

export function getSystemStats(callerRole?: string) {
  const d = getDb();
  const excludeSA = callerRole && callerRole !== "super_admin";

  const totalUsers = excludeSA
    ? (d.prepare("SELECT COUNT(*) as c FROM users WHERE role != ?").get("super_admin") as any).c
    : (d.prepare("SELECT COUNT(*) as c FROM users").get() as any).c;

  const getIds = excludeSA
    ? () => d.prepare("SELECT id FROM users WHERE role != ?").all("super_admin").map((r: any) => r.id)
    : () => null;

  const excludedIds = getIds();

  const totalChats = excludeSA && excludedIds?.length
    ? (d.prepare(`SELECT COUNT(*) as c FROM chats WHERE user_id IN (${excludedIds.map(() => "?").join(",")})`).get(...excludedIds) as any).c
    : (d.prepare("SELECT COUNT(*) as c FROM chats").get() as any).c;

  const totalMessages = (d.prepare("SELECT COUNT(*) as c FROM messages").get() as any).c;

  const totalProjects = excludeSA && excludedIds?.length
    ? (d.prepare(`SELECT COUNT(*) as c FROM projects WHERE user_id IN (${excludedIds.map(() => "?").join(",")})`).get(...excludedIds) as any).c
    : (d.prepare("SELECT COUNT(*) as c FROM projects").get() as any).c;

  const chatsToday = excludeSA && excludedIds?.length
    ? (d.prepare(`SELECT COUNT(*) as c FROM chats WHERE date(created_at) = date('now') AND user_id IN (${excludedIds.map(() => "?").join(",")})`).get(...excludedIds) as any).c
    : (d.prepare("SELECT COUNT(*) as c FROM chats WHERE date(created_at) = date('now')").get() as any).c;

  const messagesToday = (d.prepare("SELECT COUNT(*) as c FROM messages WHERE date(created_at) = date('now')").get() as any).c;

  const activeUsers = excludeSA && excludedIds?.length
    ? (d.prepare(`SELECT COUNT(DISTINCT user_id) as c FROM chats WHERE date(updated_at) = date('now') AND user_id IN (${excludedIds.map(() => "?").join(",")})`).get(...excludedIds) as any).c
    : (d.prepare("SELECT COUNT(DISTINCT user_id) as c FROM chats WHERE date(updated_at) = date('now')").get() as any).c;

  return {
    totalUsers,
    totalChats,
    totalMessages,
    totalProjects,
    chatsToday,
    messagesToday,
    activeUsers,
  };
}

export function getChatsByUserRaw(userId: string) {
  const d = getDb();
  return d
    .prepare("SELECT * FROM chats WHERE user_id = ? ORDER BY updated_at DESC LIMIT 10")
    .all(userId) as any[];
}

export function getProjectsByUserRaw(userId: string) {
  const d = getDb();
  return d
    .prepare("SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 10")
    .all(userId) as any[];
}

/* ============ ADMIN: USER DETAIL ============ */

export function getUserByIdFull(userId: string) {
  const d = getDb();
  const user = d.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any;
  if (!user) return null;

  const stats = getUserStats(userId);
  const recentChats = d
    .prepare("SELECT id, title, created_at, updated_at FROM chats WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20")
    .all(userId) as any[];
  const recentProjects = d
    .prepare("SELECT id, name, created_at FROM projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 20")
    .all(userId) as any[];

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role || "user",
    picture: user.picture,
    google_id: user.google_id,
    created_at: user.created_at,
    ...stats,
    recentChats,
    recentProjects,
  };
}

/* ============ ADMIN: HEARTS ============ */

export function initHeartsTable() {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS hearts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT DEFAULT '',
      tone TEXT DEFAULT '',
      instructions TEXT DEFAULT '',
      limitations TEXT DEFAULT '',
      temperature REAL DEFAULT 0.7,
      knowledge_files TEXT DEFAULT '[]',
      tools TEXT DEFAULT '[]',
      agent_memory TEXT DEFAULT '',
      is_public INTEGER DEFAULT 0,
      is_preset INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { d.exec("CREATE INDEX IF NOT EXISTS idx_hearts_user ON hearts(user_id)"); } catch {}
  try { d.exec("CREATE INDEX IF NOT EXISTS idx_hearts_public ON hearts(is_public)"); } catch {}
  try { d.exec("ALTER TABLE chats ADD COLUMN heart_id TEXT REFERENCES hearts(id)"); } catch {}
}

export function getAllHearts() {
  const d = getDb();
  initHeartsTable();
  return d
    .prepare(`
      SELECT h.*, u.name AS user_name, u.email AS user_email
      FROM hearts h
      LEFT JOIN users u ON h.user_id = u.id
      ORDER BY h.is_preset DESC, h.updated_at DESC
    `)
    .all() as any[];
}

export function getHeartById(id: string) {
  const d = getDb();
  initHeartsTable();
  return d.prepare("SELECT * FROM hearts WHERE id = ?").get(id) as any;
}

export function createHeart(
  id: string,
  userId: string,
  name: string,
  role?: string,
  tone?: string,
  instructions?: string,
  limitations?: string,
  temperature?: number,
  tools?: string[],
  isPreset?: number
) {
  const d = getDb();
  initHeartsTable();
  d.prepare(`
    INSERT INTO hearts (id, user_id, name, role, tone, instructions, limitations, temperature, tools, is_preset)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, name, role || "", tone || "", instructions || "", limitations || "", temperature ?? 0.7, JSON.stringify(tools || []), isPreset || 0);
}

export function updateHeart(id: string, data: Record<string, any>) {
  const d = getDb();
  initHeartsTable();
  const fields = Object.keys(data).filter(k => k !== "id").map(k => `${k} = ?`).join(", ");
  const values = Object.keys(data).filter(k => k !== "id").map(k => data[k]);
  if (!fields) return;
  d.prepare(`UPDATE hearts SET ${fields}, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
}

export function deleteHeart(id: string) {
  const d = getDb();
  initHeartsTable();
  d.prepare("DELETE FROM hearts WHERE id = ?").run(id);
}

export function getHeartsByUser(userId: string) {
  const d = getDb();
  initHeartsTable();
  return d.prepare("SELECT * FROM hearts WHERE user_id = ? ORDER BY updated_at DESC").all(userId) as any[];
}

/* ============ ADMIN: CONFIG ============ */

export function initConfigTable() {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

export function getAllConfig() {
  const d = getDb();
  initConfigTable();
  return d.prepare("SELECT * FROM config ORDER BY key").all() as any[];
}

export function getConfig(key: string): string | null {
  const d = getDb();
  initConfigTable();
  const row = d.prepare("SELECT value FROM config WHERE key = ?").get(key) as any;
  return row?.value || null;
}

export function setConfig(key: string, value: string, description?: string) {
  const d = getDb();
  initConfigTable();
  d.prepare(`
    INSERT INTO config (key, value, description, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, description = COALESCE(excluded.description, config.description), updated_at = datetime('now')
  `).run(key, value, description || "");
}

export function deleteConfig(key: string) {
  const d = getDb();
  initConfigTable();
  d.prepare("DELETE FROM config WHERE key = ?").run(key);
}

export function seedDefaultConfig() {
  const defaults: Record<string, { value: string; description: string }> = {
    "max_chats_per_user": { value: "999", description: "Máximo de chats por usuario" },
    "max_file_size_mb": { value: "20", description: "Tamaño máximo de archivos (MB)" },
    "max_knowledge_files_per_heart": { value: "3", description: "Archivos de conocimiento por Heart" },
    "allow_registration": { value: "true", description: "Permitir nuevos registros" },
    "allow_guest_access": { value: "false", description: "Permitir acceso sin login" },
    "default_user_role": { value: "user", description: "Rol por defecto al registrarse" },
    "maintenance_mode": { value: "false", description: "Modo mantenimiento" },
    "ollama_context_length": { value: "65536", description: "Contexto del modelo (tokens)" },
    "ollama_num_predict": { value: "4096", description: "Tokens máximos de respuesta" },
    "ollama_temperature": { value: "0.3", description: "Temperatura por defecto del modelo" },
    "rate_limit_per_minute": { value: "30", description: "Rate limit por minuto" },
    "heart_memory_enabled": { value: "true", description: "Memoria persistente para Hearts" },
    "chat_summary_enabled": { value: "true", description: "Resúmenes automáticos de chat" },
  };

  const d = getDb();
  initConfigTable();
  for (const [key, cfg] of Object.entries(defaults)) {
    d.prepare(`
      INSERT INTO config (key, value, description) VALUES (?, ?, ?)
      ON CONFLICT(key) DO NOTHING
    `).run(key, cfg.value, cfg.description);
  }
}

/* ============ KNOWLEDGE BASE ============ */

export function initKnowledgeTable() {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      created_by TEXT REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

export function getKnowledgeEntries(category?: string) {
  const d = getDb();
  initKnowledgeTable();
  if (category) {
    return d
      .prepare("SELECT * FROM knowledge_entries WHERE category = ? ORDER BY updated_at DESC")
      .all(category) as any[];
  }
  return d
    .prepare("SELECT ke.*, u.name AS created_by_name FROM knowledge_entries ke LEFT JOIN users u ON ke.created_by = u.id ORDER BY ke.updated_at DESC")
    .all() as any[];
}

export function createKnowledgeEntry(id: string, title: string, content: string, category: string, createdBy: string) {
  const d = getDb();
  initKnowledgeTable();
  d.prepare(
    "INSERT INTO knowledge_entries (id, title, content, category, created_by) VALUES (?, ?, ?, ?, ?)"
  ).run(id, title, content, category, createdBy);
}

export function deleteKnowledgeEntry(id: string) {
  const d = getDb();
  initKnowledgeTable();
  d.prepare("DELETE FROM knowledge_entries WHERE id = ?").run(id);
}

export function updateKnowledgeEntry(id: string, title: string, content: string, category: string) {
  const d = getDb();
  initKnowledgeTable();
  d.prepare(
    "UPDATE knowledge_entries SET title = ?, content = ?, category = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(title, content, category, id);
}

/* ============ ADMIN: CHAT DETAIL ============ */

export function getChatWithMessages(chatId: string) {
  const d = getDb();
  const chat = d.prepare(`
    SELECT c.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
    FROM chats c
    LEFT JOIN users u ON c.user_id = u.id
    WHERE c.id = ?
  `).get(chatId) as any;
  if (!chat) return null;

  const messages = d.prepare("SELECT * FROM messages WHERE chat_id = ? ORDER BY id ASC").all(chatId) as any[];
  return { ...chat, messages };
}

/* ============ ADMIN: ALL PROJECTS ============ */

export function getAllProjectsAdmin(search = "") {
  const d = getDb();
  let sql = `
    SELECT p.*, u.name AS user_name, u.email AS user_email, u.role AS user_role,
      (SELECT COUNT(*) FROM chats WHERE project_id = p.id) AS chat_count
    FROM projects p
    LEFT JOIN users u ON p.user_id = u.id
  `;
  const params: any[] = [];
  if (search) {
    sql += " WHERE (p.name LIKE ? OR u.name LIKE ? OR u.email LIKE ?)";
    const q = `%${search}%`;
    params.push(q, q, q);
  }
  sql += " ORDER BY p.created_at DESC LIMIT 200";
  return d.prepare(sql).all(...params) as any[];
}

/* ============ ADMIN: ALL CHATS ============ */

export function getAllChatsAdmin(search = "") {
  const d = getDb();
  let sql = `
    SELECT c.id, c.title, c.created_at, c.updated_at, c.user_id, c.heart_id,
           u.name AS user_name, u.email AS user_email, u.role AS user_role,
           (SELECT COUNT(*) FROM messages WHERE chat_id = c.id) AS message_count,
           (SELECT content FROM messages WHERE chat_id = c.id ORDER BY id DESC LIMIT 1) AS last_message
    FROM chats c
    LEFT JOIN users u ON c.user_id = u.id
  `;
  const params: any[] = [];
  if (search) {
    sql += " WHERE (c.title LIKE ? OR u.name LIKE ? OR u.email LIKE ?)";
    const q = `%${search}%`;
    params.push(q, q, q);
  }
  sql += " ORDER BY c.updated_at DESC LIMIT 500";
  return d.prepare(sql).all(...params) as any[];
}

/* ============ AUDIT LOG ============ */

export function initAuditTable() {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      details TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { d.exec("CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)"); } catch {}
  try { d.exec("CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action)"); } catch {}
  try { d.exec("CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)"); } catch {}
}

export function logAudit(userId: string | null, action: string, details?: string, ip?: string) {
  const d = getDb();
  initAuditTable();
  d.prepare("INSERT INTO audit_log (user_id, action, details, ip) VALUES (?, ?, ?, ?)")
    .run(userId, action, details || "", ip || "");
}

export function getAuditLogs(limit = 100, offset = 0, action?: string, userId?: string) {
  const d = getDb();
  initAuditTable();
  let sql = `
    SELECT a.*, u.name AS user_name, u.email AS user_email
    FROM audit_log a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE 1=1
  `;
  const params: any[] = [];
  if (action) { sql += " AND a.action = ?"; params.push(action); }
  if (userId) { sql += " AND a.user_id = ?"; params.push(userId); }
  sql += " ORDER BY a.created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);
  return d.prepare(sql).all(...params) as any[];
}

export function countAuditLogs(action?: string, userId?: string) {
  const d = getDb();
  initAuditTable();
  let sql = "SELECT COUNT(*) as c FROM audit_log WHERE 1=1";
  const params: any[] = [];
  if (action) { sql += " AND action = ?"; params.push(action); }
  if (userId) { sql += " AND user_id = ?"; params.push(userId); }
  const row = d.prepare(sql).get(...params) as any;
  return row?.c || 0;
}

export function getAuditActions() {
  const d = getDb();
  initAuditTable();
  return d.prepare("SELECT DISTINCT action FROM audit_log ORDER BY action").all() as any[];
}

/* ============ ANNOUNCEMENTS ============ */

export function initAnnouncementsTable() {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'info',
      active INTEGER DEFAULT 1,
      created_by TEXT REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

export function getAnnouncements(activeOnly = false) {
  const d = getDb();
  initAnnouncementsTable();
  let sql = `
    SELECT a.*, u.name AS created_by_name
    FROM announcements a
    LEFT JOIN users u ON a.created_by = u.id
  `;
  if (activeOnly) sql += " WHERE a.active = 1";
  sql += " ORDER BY a.created_at DESC";
  return d.prepare(sql).all() as any[];
}

export function getActiveAnnouncements() {
  return getAnnouncements(true);
}

export function createAnnouncement(id: string, title: string, content: string, type: string, createdBy: string) {
  const d = getDb();
  initAnnouncementsTable();
  d.prepare("INSERT INTO announcements (id, title, content, type, created_by) VALUES (?, ?, ?, ?, ?)")
    .run(id, title, content, type, createdBy);
}

export function updateAnnouncement(id: string, data: Record<string, any>) {
  const d = getDb();
  initAnnouncementsTable();
  const fields = Object.keys(data).filter(k => k !== "id").map(k => `${k} = ?`).join(", ");
  const values = Object.keys(data).filter(k => k !== "id").map(k => data[k]);
  if (!fields) return;
  d.prepare(`UPDATE announcements SET ${fields}, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
}

export function deleteAnnouncement(id: string) {
  const d = getDb();
  initAnnouncementsTable();
  d.prepare("DELETE FROM announcements WHERE id = ?").run(id);
}

/* ============ BACKUPS (metadata) ============ */

export function initBackupsTable() {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS backups (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      size_bytes INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_by TEXT REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

export function createBackup(id: string, filename: string, createdBy: string) {
  const d = getDb();
  initBackupsTable();
  d.prepare("INSERT INTO backups (id, filename, created_by) VALUES (?, ?, ?)").run(id, filename, createdBy);
}

export function updateBackupStatus(id: string, status: string, sizeBytes?: number) {
  const d = getDb();
  initBackupsTable();
  if (sizeBytes !== undefined) {
    d.prepare("UPDATE backups SET status = ?, size_bytes = ? WHERE id = ?").run(status, sizeBytes, id);
  } else {
    d.prepare("UPDATE backups SET status = ? WHERE id = ?").run(status, id);
  }
}

export function getBackups(limit = 20) {
  const d = getDb();
  initBackupsTable();
  return d.prepare(`
    SELECT b.*, u.name AS created_by_name
    FROM backups b
    LEFT JOIN users u ON b.created_by = u.id
    ORDER BY b.created_at DESC LIMIT ?
  `).all(limit) as any[];
}

/* ============ LEGACY JSON MIGRATION ============ */
export function hasData() {
  const d = getDb();
  const row = d.prepare("SELECT COUNT(*) as count FROM chats").get() as any;
  return row.count > 0;
}

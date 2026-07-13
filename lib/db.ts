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

/* ============ LEGACY JSON MIGRATION ============ */
export function hasData() {
  const d = getDb();
  const row = d.prepare("SELECT COUNT(*) as count FROM chats").get() as any;
  return row.count > 0;
}

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
}

/* ============ USERS ============ */

export function createUser(
  id: string,
  email: string,
  name: string | null,
  passwordHash?: string,
  googleId?: string
) {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO users (id, email, name, password_hash, google_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(id, email, name, passwordHash || null, googleId || null);
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

export function updateChatTitle(id: string, title: string) {
  const d = getDb();
  d.prepare(
    "UPDATE chats SET title = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(title, id);
}

export function deleteChat(id: string) {
  const d = getDb();
  d.prepare("DELETE FROM chats WHERE id = ?").run(id);
}

/* ============ MESSAGES ============ */

export function getMessagesByChat(chatId: string) {
  const d = getDb();
  const rows = d
    .prepare("SELECT * FROM messages WHERE chat_id = ? ORDER BY id ASC")
    .all(chatId) as any[];

  return rows.map((row) => ({
    id: row.id,
    role: row.role === "assistant" ? "ai" : (row.role as "user" | "ai"),
    text: row.content,
    images: row.images ? JSON.parse(row.images) : undefined,
  }));
}

export function addMessage(
  chatId: string,
  role: string,
  content: string,
  images?: string[]
) {
  const d = getDb();
  d.prepare(
    "INSERT INTO messages (chat_id, role, content, images) VALUES (?, ?, ?, ?)"
  ).run(chatId, role, content, images ? JSON.stringify(images) : null);

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

/* ============ LEGACY JSON MIGRATION ============ */
export function hasData() {
  const d = getDb();
  const row = d.prepare("SELECT COUNT(*) as count FROM chats").get() as any;
  return row.count > 0;
}

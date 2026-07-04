//Este archivo consiste en un script de inicialización para la base de datos
//  SQLite utilizada en la aplicación. Su propósito es crear las tablas necesarias 
// y agregar un usuario de soporte predeterminado si no existe.
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const DB_PATH = path.join(process.cwd(), "data", "app.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

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

const id = "soporte-dev-user-id";
const email = "Admin@digna.com";
const userName = "Soporte";
const passwordHash = bcrypt.hashSync("Admin123", 10);

const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(id);

if (existing) {
  db.prepare(
    "UPDATE users SET email = ?, password_hash = ? WHERE id = ?"
  ).run(email, passwordHash, id);
  console.log("✅ Usuario Soporte actualizado.");
} else {
  db.prepare(
    "INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)"
  ).run(id, email, userName, passwordHash);
  console.log("✅ Usuario Soporte creado con ID:", id);
}

console.log("📧 Email:", email);
console.log("🔑 Contraseña: Admin123");

db.close();

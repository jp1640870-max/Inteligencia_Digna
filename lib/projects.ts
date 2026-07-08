import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "app.db");

let db: Database.Database;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        instructions TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
    `);
  }

  return db;
}

export function getProjectsByUser(userId: string) {
  return getDb()
    .prepare("SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId);
}

export function getProjectById(id: string) {
  return getDb()
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(id) as any;
}

export function createProject(userId: string, name: string, instructions: string) {
  const id = crypto.randomUUID();

  getDb()
    .prepare(`
      INSERT INTO projects (id, user_id, name, instructions)
      VALUES (?, ?, ?, ?)
    `)
    .run(id, userId, name, instructions);

  return getProjectById(id);
}

export function deleteProject(id: string, userId: string) {
  const result = getDb()
    .prepare("DELETE FROM projects WHERE id = ? AND user_id = ?")
    .run(id, userId);

  return result.changes > 0;
}

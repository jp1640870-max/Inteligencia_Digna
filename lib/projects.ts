import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "app.db");

let db: Database.Database;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        instructions TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);

      CREATE TABLE IF NOT EXISTS project_chats (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        added_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (project_id, chat_id)
      );

      CREATE INDEX IF NOT EXISTS idx_project_chats_project ON project_chats(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_chats_chat ON project_chats(chat_id);
    `);

    try { db.exec("ALTER TABLE project_chats ADD COLUMN chat_title TEXT DEFAULT ''"); } catch {}
    try { db.exec("UPDATE project_chats SET chat_title = (SELECT title FROM chats WHERE id = chat_id) WHERE chat_title = ''"); } catch {}
  }
  return db;
}

export function getProjectsByUser(userId: string, searchQuery?: string) {
  const d = getDb();
  if (searchQuery) {
    return d.prepare(`
      SELECT p.*, (SELECT COUNT(*) FROM project_chats pc WHERE pc.project_id = p.id) as chat_count
      FROM projects p
      WHERE p.user_id = ? AND p.name LIKE ?
      ORDER BY p.created_at DESC
    `).all(userId, `%${searchQuery}%`);
  }
  return d.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM project_chats pc WHERE pc.project_id = p.id) as chat_count
    FROM projects p
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `).all(userId);
}

export function getProjectById(id: string) {
  return getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) as any;
}

export function createProject(userId: string, name: string, instructions: string) {
  const id = crypto.randomUUID();
  getDb().prepare(`
    INSERT INTO projects (id, user_id, name, instructions)
    VALUES (?, ?, ?, ?)
  `).run(id, userId, name, instructions);
  return getProjectById(id);
}

export function updateProject(id: string, userId: string, data: { name?: string; instructions?: string }) {
  const sets: string[] = [];
  const params: any[] = [];
  if (data.name !== undefined) { sets.push("name = ?"); params.push(data.name); }
  if (data.instructions !== undefined) { sets.push("instructions = ?"); params.push(data.instructions); }
  if (sets.length === 0) return;
  params.push(id, userId);
  getDb().prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(...params);
}

export function deleteProject(id: string, userId: string) {
  const d = getDb();
  d.prepare("DELETE FROM project_chats WHERE project_id = ?").run(id);
  const result = d.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").run(id, userId);
  return result.changes > 0;
}

export function addChatToProject(projectId: string, chatId: string) {
  const d = getDb();
  const exists = d.prepare("SELECT * FROM project_chats WHERE project_id = ? AND chat_id = ?").get(projectId, chatId);
  if (exists) return;
  const chat = d.prepare("SELECT title FROM chats WHERE id = ?").get(chatId) as any;
  d.prepare("INSERT INTO project_chats (project_id, chat_id, chat_title) VALUES (?, ?, ?)").run(projectId, chatId, chat?.title || "");
}

export function syncProjectChatTitle(chatId: string, title: string) {
  getDb().prepare("UPDATE project_chats SET chat_title = ? WHERE chat_id = ?").run(title, chatId);
}

export function removeChatFromProject(projectId: string, chatId: string) {
  getDb().prepare("DELETE FROM project_chats WHERE project_id = ? AND chat_id = ?").run(projectId, chatId);
}

export function getChatsByProject(projectId: string) {
  const d = getDb();
  const row = d.prepare(`
    SELECT p.name as project_name FROM projects p WHERE p.id = ?
  `).get(projectId) as any;
  const projectName = row?.project_name || "";
  const rows = d.prepare(`
    SELECT c.* FROM chats c
    JOIN project_chats pc ON c.id = pc.chat_id
    WHERE pc.project_id = ?
    ORDER BY pc.added_at DESC
  `).all(projectId) as any[];
  return rows.map((row: any) => ({
    id: row.id,
    title: row.title,
    user_id: row.user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    project_name: projectName,
    messages: [],
  }));
}

export function getProjectsByChat(chatId: string, userId: string) {
  return getDb().prepare(`
    SELECT p.* FROM projects p
    JOIN project_chats pc ON p.id = pc.project_id
    WHERE pc.chat_id = ? AND p.user_id = ?
  `).all(chatId, userId);
}

export function getChatsSinProyecto(userId: string) {
  const d = getDb();
  const rows = d.prepare(`
    SELECT c.* FROM chats c
    WHERE c.user_id = ? AND c.id NOT IN (SELECT chat_id FROM project_chats)
    ORDER BY c.updated_at DESC
  `).all(userId) as any[];
  return rows.map((row: any) => ({
    id: row.id,
    title: row.title,
    messages: [],
  }));
}

import { query, withTransaction } from "./db-connection";
import type { PoolClient } from "pg";
import type { ChatRow, ProjectRow } from "@/types";

type DbRow = Record<string, unknown>;

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

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
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

export async function getProjectsByUser(userId: string, searchQuery?: string): Promise<ProjectRow[]> {
  let sql = `
    SELECT p.*, (SELECT COUNT(*)::int FROM project_chats pc WHERE pc.project_id = p.id) AS chat_count
    FROM projects p
    WHERE p.user_id = $1`;
  const params: unknown[] = [userId];
  if (searchQuery) {
    params.push(`%${searchQuery}%`);
    sql += ` AND p.name ILIKE $${params.length}`;
  }
  sql += " ORDER BY p.created_at DESC";
  const result = await query(sql, params);
  return (result.rows as DbRow[]).map(normalizeProject);
}

export async function getProjectById(id: string): Promise<ProjectRow | null> {
  const result = await query("SELECT * FROM projects WHERE id = $1 LIMIT 1", [id]);
  const row = result.rows[0] as DbRow | undefined;
  return row ? normalizeProject(row) : null;
}

export async function createProject(
  userId: string,
  name: string,
  instructions: string,
): Promise<ProjectRow | null> {
  const id = crypto.randomUUID();
  await query("INSERT INTO projects (id, user_id, name, instructions) VALUES ($1, $2, $3, $4)", [
    id,
    userId,
    name,
    instructions,
  ]);
  const project = await getProjectById(id);
  return project;
}

export async function updateProject(
  id: string,
  userId: string,
  data: { name?: string; instructions?: string },
): Promise<void> {
  const fields: string[] = [];
  const params: unknown[] = [];
  if (data.name !== undefined) {
    fields.push("name");
    params.push(data.name);
  }
  if (data.instructions !== undefined) {
    fields.push("instructions");
    params.push(data.instructions);
  }
  if (fields.length === 0) return;
  const assignments = fields.map((field, index) => `${field} = $${index + 1}`);
  params.push(id, userId);
  await query(
    `UPDATE projects SET ${assignments.join(", ")} WHERE id = $${fields.length + 1} AND user_id = $${fields.length + 2}`,
    params,
  );
}

export async function deleteProject(id: string, userId: string): Promise<boolean> {
  return withTransaction(async (client: PoolClient) => {
    await client.query("DELETE FROM project_chats WHERE project_id = $1", [id]);
    const result = await client.query("DELETE FROM projects WHERE id = $1 AND user_id = $2", [id, userId]);
    return (result.rowCount ?? 0) > 0;
  });
}

export async function addChatToProject(projectId: string, chatId: string): Promise<void> {
  await query(
    `INSERT INTO project_chats (project_id, chat_id, chat_title)
     SELECT $1, c.id, c.title
     FROM chats c
     WHERE c.id = $2
     ON CONFLICT (project_id, chat_id) DO NOTHING`,
    [projectId, chatId],
  );
}

export async function syncProjectChatTitle(chatId: string, title: string): Promise<void> {
  await query("UPDATE project_chats SET chat_title = $1 WHERE chat_id = $2", [title, chatId]);
}

export async function removeChatFromProject(projectId: string, chatId: string): Promise<void> {
  await query("DELETE FROM project_chats WHERE project_id = $1 AND chat_id = $2", [projectId, chatId]);
}

export async function getChatsByProject(
  projectId: string,
): Promise<Array<ChatRow & { project_name: string; messages: [] }>> {
  const [projectResult, chatsResult] = await Promise.all([
    query("SELECT name FROM projects WHERE id = $1 LIMIT 1", [projectId]),
    query(
      `SELECT c.*
       FROM chats c
       JOIN project_chats pc ON c.id = pc.chat_id
       WHERE pc.project_id = $1
       ORDER BY pc.added_at DESC`,
      [projectId],
    ),
  ]);
  const projectRow = projectResult.rows[0] as DbRow | undefined;
  const projectName = textValue(projectRow?.name);
  return (chatsResult.rows as DbRow[]).map((rawRow) => {
    const row = normalizeChat(rawRow);
    return { ...row, project_name: projectName, messages: [] };
  });
}

export async function getProjectsByChat(chatId: string, userId: string): Promise<ProjectRow[]> {
  const result = await query(
    `SELECT p.*
     FROM projects p
     JOIN project_chats pc ON p.id = pc.project_id
     WHERE pc.chat_id = $1 AND p.user_id = $2`,
    [chatId, userId],
  );
  return (result.rows as DbRow[]).map(normalizeProject);
}

export async function getChatsSinProyecto(
  userId: string,
): Promise<Array<{ id: string; title: string; messages: [] }>> {
  const result = await query(
    `SELECT c.*
     FROM chats c
     WHERE c.user_id = $1
       AND NOT EXISTS (SELECT 1 FROM project_chats pc WHERE pc.chat_id = c.id)
     ORDER BY c.updated_at DESC`,
    [userId],
  );
  return (result.rows as DbRow[]).map((row) => ({
    id: textValue(row.id),
    title: textValue(row.title),
    messages: [],
  }));
}

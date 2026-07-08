import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { addChatToProject, getProjectById } from "@/lib/projects";
import { createChat } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await context.params;
  const project = getProjectById(id);
  if (!project || project.user_id !== userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await _req.json();
  const chatId = crypto.randomUUID();
  const title = body.title || "Nueva conversación";

  createChat(chatId, userId, title);
  addChatToProject(id, chatId);

  return NextResponse.json({ id: chatId, title, projectId: id });
}

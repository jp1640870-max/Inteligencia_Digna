import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { addChatToProject, getChatsByProject, getProjectById, removeChatFromProject } from "@/lib/projects";
import { getChatById } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await context.params;
  const project = await getProjectById(id);
  if (!project || project.user_id !== userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const chats = await getChatsByProject(id);
  return NextResponse.json(chats);
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await context.params;
  const project = await getProjectById(id);
  if (!project || project.user_id !== userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { chatId } = await req.json();
  if (!chatId) {
    return NextResponse.json({ error: "chatId requerido" }, { status: 400 });
  }

  const chat = await getChatById(chatId);
  if (!chat || chat.user_id !== userId) {
    return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
  }

  await addChatToProject(id, chatId);
  const chats = await getChatsByProject(id);
  return NextResponse.json(chats);
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await context.params;
  const { chatId } = await req.json();
  if (!chatId) {
    return NextResponse.json({ error: "chatId requerido" }, { status: 400 });
  }

  const project = await getProjectById(id);
  if (!project || project.user_id !== userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  await removeChatFromProject(id, chatId);
  return NextResponse.json({ success: true });
}

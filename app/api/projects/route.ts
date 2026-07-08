import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { createProject, getProjectsByUser } from "@/lib/projects";

export async function GET() {
  const userId = await getUserIdFromRequest();

  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const projects = getProjectsByUser(userId);
  return NextResponse.json(projects);
}

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest();

  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await req.json();

  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });
  }

  const project = createProject(
    userId,
    body.name.trim(),
    body.instructions || ""
  );

  return NextResponse.json(project);
}

import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { getProjectsByUser } from "@/lib/projects";

export async function GET(req: NextRequest) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q") || "";
  const projects = getProjectsByUser(userId, q);
  return NextResponse.json(projects);
}

import { NextRequest, NextResponse } from "next/server";
import { requireRole, filterVisibleItems } from "@/lib/auth";
import { getAllProjectsAdmin } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { allowed, user } = await requireRole(["super_admin", "admin", "editor", "viewer"]);
  if (!allowed || !user) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || "";

  const all = getAllProjectsAdmin(search);
  const projects = filterVisibleItems(all, user);
  return NextResponse.json({ projects });
}

import { NextRequest, NextResponse } from "next/server";
import { requireRole, filterVisibleItems } from "@/lib/auth";
import { getAllChatsAdmin } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { allowed, user } = await requireRole(["super_admin", "admin", "editor", "viewer"]);
  if (!allowed || !user) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || "";

  const all = getAllChatsAdmin(search);
  const chats = filterVisibleItems(all, user);
  return NextResponse.json({ chats });
}

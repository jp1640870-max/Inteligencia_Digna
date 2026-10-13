import { NextRequest, NextResponse } from "next/server";
import {
  requireCapability,
  filterVisibleItems,
} from "@/lib/auth";
import { getAllChatsAdmin } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { allowed, status, user } = await requireCapability("panel.read");
  if (!allowed || !user) return NextResponse.json({ error: "No autorizado" }, { status });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || "";

  const all = await getAllChatsAdmin(search);
  const chats = filterVisibleItems(all, user);
  return NextResponse.json({ chats });
}

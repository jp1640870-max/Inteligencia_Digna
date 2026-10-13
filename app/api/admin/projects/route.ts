import { NextRequest, NextResponse } from "next/server";
import {
  requireCapability,
  filterVisibleItems,
} from "@/lib/auth";
import { getAllProjectsAdmin } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { allowed, status, user } = await requireCapability("panel.read");
  if (!allowed || !user) return NextResponse.json({ error: "No autorizado" }, { status });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || "";

  const all = await getAllProjectsAdmin(search);
  const projects = filterVisibleItems(all, user);
  return NextResponse.json({ projects });
}

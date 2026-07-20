import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getSystemStats } from "@/lib/db";

export async function GET() {
  const { allowed, user } = await requireRole(["super_admin", "admin", "editor", "viewer"]);
  if (!allowed || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const stats = getSystemStats(user.role);
  return NextResponse.json(stats);
}

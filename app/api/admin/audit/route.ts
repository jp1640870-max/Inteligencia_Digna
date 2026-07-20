import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getAuditLogs, countAuditLogs, getAuditActions } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { allowed, user } = await requireRole(["super_admin", "admin"]);
  if (!allowed || !user) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") || "100");
  const offset = parseInt(searchParams.get("offset") || "0");
  const action = searchParams.get("action") || undefined;
  const userId = searchParams.get("userId") || undefined;

  const logs = getAuditLogs(limit, offset, action, userId, user.role);
  const total = countAuditLogs(action, userId, user.role);
  const actions = getAuditActions();

  return NextResponse.json({ logs, total, actions });
}

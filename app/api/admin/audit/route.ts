import { NextRequest, NextResponse } from "next/server";
import {
  requireCapability,
} from "@/lib/auth";
import { getAuditLogs, countAuditLogs, getAuditActions } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { allowed, status, user } = await requireCapability("audit.read");
  if (!allowed || !user) return NextResponse.json({ error: "No autorizado" }, { status });

  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") || "100");
  const offset = parseInt(searchParams.get("offset") || "0");
  const action = searchParams.get("action") || undefined;
  const userId = searchParams.get("userId") || undefined;

  const [logs, total, actions] = await Promise.all([
    getAuditLogs(limit, offset, action, userId, user.role),
    countAuditLogs(action, userId, user.role),
    getAuditActions(),
  ]);

  return NextResponse.json({ logs, total, actions });
}

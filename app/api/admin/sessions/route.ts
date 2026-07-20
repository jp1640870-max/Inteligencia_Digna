import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { allowed } = await requireRole(["super_admin", "admin"]);
  if (!allowed) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  // Sesiones activas: usuarios con actividad hoy
  const { getSystemStats, getAllUsers } = await import("@/lib/db");
  const stats = getSystemStats();
  const users = getAllUsers();

  const activeUsers = users.filter((u: any) => {
    // Usuarios creados en las últimas 24h o con actividad reciente
    const created = new Date(u.created_at).getTime();
    return Date.now() - created < 24 * 60 * 60 * 1000;
  });

  return NextResponse.json({
    activeToday: stats.activeUsers,
    totalUsers: stats.totalUsers,
    recentLogins: activeUsers.slice(0, 20),
    timestamp: new Date().toISOString(),
  });
}

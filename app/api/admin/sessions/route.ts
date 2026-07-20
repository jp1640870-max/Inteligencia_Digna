import { NextRequest, NextResponse } from "next/server";
import { requireRole, filterVisibleUsers } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { allowed, user } = await requireRole(["super_admin", "admin"]);
  if (!allowed || !user) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  // Sesiones activas: usuarios con actividad hoy
  const { getSystemStats, getAllUsers } = await import("@/lib/db");
  const stats = getSystemStats(user.role);
  const allUsers = getAllUsers();
  const visibleUsers = filterVisibleUsers(allUsers, user);

  const recentUsers = visibleUsers.filter((u: any) => {
    const created = new Date(u.created_at).getTime();
    return Date.now() - created < 24 * 60 * 60 * 1000;
  });

  return NextResponse.json({
    activeToday: stats.activeUsers,
    totalUsers: stats.totalUsers,
    recentLogins: recentUsers.slice(0, 20),
    timestamp: new Date().toISOString(),
  });
}

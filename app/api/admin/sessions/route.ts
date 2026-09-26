import { NextResponse } from "next/server";
import { requireRole, filterVisibleUsers } from "@/lib/auth";

export async function GET() {
  const { allowed, user } = await requireRole(["super_admin", "admin"]);
  if (!allowed || !user) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  // Sesiones activas: usuarios con actividad hoy
  const { getSystemStats, getAllUsers } = await import("@/lib/db");
  const stats = await getSystemStats(user.role);
  const allUsers = await getAllUsers();
  const visibleUsers = filterVisibleUsers(allUsers, user);

  const recentUsers = visibleUsers
    .filter((u) => {
      const created = new Date(u.created_at).getTime();
      return Date.now() - created < 24 * 60 * 60 * 1000;
    })
    .map((entry) => ({
      id: entry.id,
      email: entry.email,
      name: entry.name,
      google_id: entry.google_id,
      picture: entry.picture,
      role: entry.role,
      created_at: entry.created_at,
      chat_count: entry.chat_count,
      project_count: entry.project_count,
    }));

  return NextResponse.json({
    activeToday: stats.activeUsers,
    totalUsers: stats.totalUsers,
    recentLogins: recentUsers.slice(0, 20),
    timestamp: new Date().toISOString(),
  });
}

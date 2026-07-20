import { NextResponse } from "next/server";
import { requireRole, filterVisibleUsers, filterVisibleItems } from "@/lib/auth";
import { getSystemStats, getAllUsers, getAllHearts, getAllChatsAdmin } from "@/lib/db";

export async function GET() {
  const { allowed, user } = await requireRole(["super_admin", "admin", "editor"]);
  if (!allowed || !user) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const isSuperAdmin = user.role === "super_admin";

  const stats = getSystemStats(user.role);
  const allUsers = getAllUsers();
  const hearts = getAllHearts();
  const allChats = getAllChatsAdmin();

  const users = isSuperAdmin ? allUsers : filterVisibleUsers(allUsers, user);
  const chats = isSuperAdmin ? allChats : filterVisibleItems(allChats, user);

  const report = {
    generatedAt: new Date().toISOString(),
    summary: stats,
    usersByRole: groupBy(users, "role"),
    heartsByType: {
      presets: hearts.filter((h: any) => h.is_preset).length,
      public: hearts.filter((h: any) => h.is_public).length,
      total: hearts.length,
    },
    topUsers: users
      .sort((a: any, b: any) => (b.chat_count || 0) - (a.chat_count || 0))
      .slice(0, 10)
      .map((u: any) => ({ name: u.name || u.email, email: u.email, role: u.role, chats: u.chat_count })),
    topChats: chats.slice(0, 10).map((c: any) => ({
      title: c.title,
      user: c.user_name || c.user_email,
      messages: c.message_count,
      updated: c.updated_at,
    })),
  };

  return NextResponse.json(report);
}

function groupBy(array: any[], key: string) {
  const map: Record<string, number> = {};
  array.forEach((item) => {
    const k = item[key] || "unknown";
    map[k] = (map[k] || 0) + 1;
  });
  return map;
}

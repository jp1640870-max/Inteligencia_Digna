import { NextResponse } from "next/server";
import {
  requireCapability,
  filterVisibleUsers,
  filterVisibleItems,
} from "@/lib/auth";
import { getSystemStats, getAllUsers, getAllHearts, getAllChatsAdmin } from "@/lib/db";

export async function GET() {
  const { allowed, status, user } = await requireCapability("panel.read");
  if (!allowed || !user) return NextResponse.json({ error: "No autorizado" }, { status });

  const [stats, allUsers, hearts, allChats] = await Promise.all([
    getSystemStats(user.role),
    getAllUsers(),
    getAllHearts(),
    getAllChatsAdmin(),
  ]);

  // Sin caso especial para `super_admin`: el filtro ya declara la regla de que
  // un `super_admin` es invisible para todos menos para sí mismo, y saltar el
  // filtro para ese rol hacía que los informes mostraran una regla distinta de
  // la que aplica el listado de usuarios. Dos reglas que se contradicen, y la que
  // pierde es la del panel de usuarios, que además es la que se audita.
  const users = filterVisibleUsers(allUsers, user);
  const chats = filterVisibleItems(allChats, user);

  const report = {
    generatedAt: new Date().toISOString(),
    summary: stats,
    usersByRole: groupBy(users, "role"),
    heartsByType: {
      presets: hearts.filter((h) => h.is_preset).length,
      public: hearts.filter((h) => h.is_public).length,
      total: hearts.length,
    },
    topUsers: users
      .sort((a, b) => (b.chat_count || 0) - (a.chat_count || 0))
      .slice(0, 10)
      .map((u) => ({ name: u.name || u.email, email: u.email, role: u.role, chats: u.chat_count })),
    topChats: chats.slice(0, 10).map((c) => ({
      title: c.title,
      user: c.user_name || c.user_email,
      messages: c.message_count,
      updated: c.updated_at,
    })),
  };

  return NextResponse.json(report);
}

function groupBy<T extends object>(array: T[], key: Extract<keyof T, string>) {
  const map: Record<string, number> = {};
  array.forEach((item) => {
    const value = item[key];
    const k = value ? String(value) : "unknown";
    map[k] = (map[k] || 0) + 1;
  });
  return map;
}

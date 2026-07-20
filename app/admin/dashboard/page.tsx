"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Users,
  MessageSquare,
  FolderKanban,
  Brain,
  Activity,
  ChevronRight,
  BarChart3,
  Settings,
  Shield,
  BookOpen,
} from "lucide-react";

type StatCard = {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  href: string;
  color: string;
};

type SystemStats = {
  totalUsers: number;
  totalChats: number;
  totalMessages: number;
  totalProjects: number;
  chatsToday: number;
  messagesToday: number;
  activeUsers: number;
};

const placeholderNav = [
  { label: "Usuarios", href: "/admin/usuarios", icon: <Users size={18} />, color: "from-blue-600 to-blue-800" },
  { label: "Conversaciones", href: "/admin/chats", icon: <MessageSquare size={18} />, color: "from-green-600 to-green-800" },
  { label: "Proyectos", href: "/admin/proyectos", icon: <FolderKanban size={18} />, color: "from-purple-600 to-purple-800" },
  { label: "Hearts", href: "/admin/hearts", icon: <Brain size={18} />, color: "from-amber-500 to-amber-700" },
  { label: "Sistema", href: "/admin/sistema", icon: <Activity size={18} />, color: "from-teal-500 to-teal-700" },
  { label: "Configuración", href: "/admin/configuracion", icon: <Settings size={18} />, color: "from-rose-500 to-rose-700" },
  { label: "Auditoría", href: "/admin/auditoria", icon: <Shield size={18} />, color: "from-indigo-500 to-indigo-700" },
  { label: "Knowledge Base", href: "/admin/knowledge", icon: <BookOpen size={18} />, color: "from-cyan-500 to-cyan-700" },
];

export default function AdminDashboard() {
  const [stats, setStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  const statCards: StatCard[] = [
    { label: "Usuarios", value: stats?.totalUsers ?? "—", icon: <Users size={22} />, href: "/admin/usuarios", color: "from-blue-600 to-blue-800" },
    { label: "Chats hoy", value: stats?.chatsToday ?? "—", icon: <MessageSquare size={22} />, href: "/admin/chats", color: "from-green-600 to-green-800" },
    { label: "Proyectos", value: stats?.totalProjects ?? "—", icon: <FolderKanban size={22} />, href: "/admin/proyectos", color: "from-purple-600 to-purple-800" },
    { label: "Mensajes", value: stats?.totalMessages ?? "—", icon: <MessageSquare size={22} />, href: "/admin/chats", color: "from-amber-500 to-amber-700" },
    { label: "Activos hoy", value: stats?.activeUsers ?? "—", icon: <Activity size={22} />, href: "/admin/usuarios", color: "from-teal-500 to-teal-700" },
  ];

  return (
    <div className="space-y-8">
      <h1 className="text-lg font-semibold">Dashboard</h1>

      {/* ─── Stats Cards ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {statCards.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className={`rounded-2xl p-5 bg-gradient-to-br ${stat.color} hover:scale-[1.02] transition-transform shadow-lg`}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-white/70">{stat.icon}</span>
              <ChevronRight size={16} className="text-white/50" />
            </div>
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-xs text-white/70 mt-1">{stat.label}</p>
          </Link>
        ))}
      </div>

      {/* ─── Navigation Grid ─── */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Secciones
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {placeholderNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 p-4 rounded-xl bg-[#121824] border border-[#202938] hover:bg-[#1e293b] hover:border-green-500/30 transition-all group"
            >
              <span className="text-green-500/70 group-hover:text-green-400 transition-colors">
                {item.icon}
              </span>
              <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
                {item.label}
              </span>
              <ChevronRight size={14} className="ml-auto text-gray-600 group-hover:text-green-400 transition-colors" />
            </Link>
          ))}
        </div>
      </div>

      {/* ─── Placeholder info ─── */}
      <div className="rounded-xl bg-[#121824] border border-[#202938] p-6">
        <h3 className="text-sm font-semibold text-green-400 mb-2">
          🚧 Panel en construcción
        </h3>
        <p className="text-sm text-gray-400">
          Las secciones de este panel se están implementando progresivamente.
          Próximamente: gestión de usuarios, monitoreo en vivo, configuración
          global y más.
        </p>
        <div className="mt-4 flex gap-2">
          <span className="px-2.5 py-1 rounded-full bg-green-600/20 text-green-400 text-[10px] font-medium border border-green-500/30">
            Fase 1: Roles y acceso ✅
          </span>
          <span className="px-2.5 py-1 rounded-full bg-amber-600/20 text-amber-400 text-[10px] font-medium border border-amber-500/30">
            Fase 2: En desarrollo
          </span>
        </div>
      </div>
    </div>
  );
}

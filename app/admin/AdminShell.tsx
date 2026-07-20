"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  Users,
  MessageSquare,
  FolderKanban,
  Brain,
  Activity,
  Settings,
  Shield,
  BarChart3,
  BookOpen,
  LogOut,
  ClipboardList,
  HardDrive,
  Megaphone,
  UserCheck,
} from "lucide-react";
import { useAuthStore, ADMIN_VISIBLE_ROLES } from "@/lib/stores/auth-store";

const navItems = [
  { label: "Dashboard", href: "/admin/dashboard", icon: <BarChart3 size={18} /> },
  { label: "Usuarios", href: "/admin/usuarios", icon: <Users size={18} /> },
  { label: "Conversaciones", href: "/admin/chats", icon: <MessageSquare size={18} /> },
  { label: "Hearts", href: "/admin/hearts", icon: <Brain size={18} /> },
  { label: "Anuncios", href: "/admin/anuncios", icon: <Megaphone size={18} /> },
  { label: "Auditoría", href: "/admin/auditoria", icon: <Shield size={18} /> },
  { label: "Sesiones", href: "/admin/sesiones", icon: <UserCheck size={18} /> },
  { label: "Sistema", href: "/admin/sistema", icon: <Activity size={18} /> },
  { label: "Configuración", href: "/admin/configuracion", icon: <Settings size={18} /> },
  { label: "Knowledge Base", href: "/admin/knowledge", icon: <BookOpen size={18} /> },
  { label: "Backups", href: "/admin/backups", icon: <HardDrive size={18} /> },
  { label: "Reportes", href: "/admin/reportes", icon: <ClipboardList size={18} /> },
];

export default function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const logout = useAuthStore((s) => s.logout);

  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!loading && (!user || !ADMIN_VISIBLE_ROLES.includes(user.role))) {
      router.push("/");
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="h-screen bg-[#030812] flex items-center justify-center">
        <div className="text-green-400 text-lg animate-pulse">Cargando...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#030812] text-white flex">
      {/* ─── Sidebar ─── */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-[#0d131d] border-r border-[#202938] transform transition-transform duration-200 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0 flex flex-col`}
      >
        {/* Logo */}
        <div className="p-4 border-b border-[#202938]">
          <div className="flex items-center gap-3">
            <img src="/LogoSaludDigna.svg" className="w-10 h-10" alt="Logo" />
            <div>
              <h2 className="text-sm font-bold text-green-400">Inteligencia Digna</h2>
              <p className="text-[10px] text-gray-500">Panel de Administración</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setSidebarOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                pathname === item.href || pathname.startsWith(item.href + "/")
                  ? "bg-green-600/20 text-green-400 border border-green-500/30"
                  : "text-gray-400 hover:text-white hover:bg-[#1e293b]"
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        {/* User info */}
        <div className="p-3 border-t border-[#202938]">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-xs font-bold">
              {(user.name || user.email)[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white truncate">{user.name || user.email}</p>
              <p className="text-[10px] text-gray-500 capitalize">{user.role.replace("_", " ")}</p>
            </div>
            <button
              onClick={logout}
              className="text-gray-500 hover:text-red-400 transition-colors"
              title="Cerrar sesión"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Overlay móvil */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ─── Main ─── */}
      <main className="flex-1 overflow-y-auto">
        {/* Top bar */}
        <header className="sticky top-0 bg-[#030812]/95 backdrop-blur-sm border-b border-[#202938] px-4 lg:px-8 py-3 flex items-center gap-4 z-30">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-[#1e293b] transition"
          >
            <BarChart3 size={20} />
          </button>
          <div className="flex-1" />
          <Link
            href="/"
            className="text-xs text-gray-500 hover:text-green-400 transition-colors"
          >
            ← Volver a la app
          </Link>
        </header>

        <div className="p-4 lg:p-8">{children}</div>
      </main>
    </div>
  );
}

"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MessageSquare, FolderKanban, Calendar, Mail, Trash2, Key, Eye, EyeOff, User, Shield } from "lucide-react";
import { useAuthStore } from "@/lib/stores/auth-store";

type UserDetail = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  picture: string | null;
  google_id: string | null;
  created_at: string;
  projectCount: number;
  chatCount: number;
  recentChats: { id: string; title: string; created_at: string; updated_at: string }[];
  recentProjects: { id: string; name: string; created_at: string; updated_at: string }[];
};

const ROLE_STYLES: Record<string, string> = {
  user: "bg-gray-600",
  viewer: "bg-blue-600",
  editor: "bg-purple-600",
  admin: "bg-amber-600",
  super_admin: "bg-red-600",
};

export default function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const currentUser = useAuthStore((s) => s.user);
  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Password change
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/users/${id}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Error al cargar usuario");
        setUser(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  const handleRoleChange = async (newRole: string) => {
    if (!user) return;
    setUpdating(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        setUser({ ...user, role: newRole });
        setMessage({ type: "success", text: "Rol actualizado" });
      } else {
        const data = await res.json();
        setMessage({ type: "error", text: data.error || "Error" });
      }
    } catch {
      setMessage({ type: "error", text: "Error de red" });
    }
    setUpdating(false);
    setTimeout(() => setMessage(null), 3000);
  };

  const handlePasswordChange = async () => {
    if (!user || newPassword.length < 6) {
      setMessage({ type: "error", text: "La contraseña debe tener al menos 6 caracteres" });
      return;
    }
    setChangingPassword(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      if (res.ok) {
        setNewPassword("");
        setShowPassword(false);
        setMessage({ type: "success", text: "Contraseña actualizada" });
      } else {
        const data = await res.json();
        setMessage({ type: "error", text: data.error || "Error" });
      }
    } catch {
      setMessage({ type: "error", text: "Error de red" });
    }
    setChangingPassword(false);
    setTimeout(() => setMessage(null), 3000);
  };

  const handleDelete = async () => {
    if (!user || !confirm(`¿Eliminar a "${user.email}" permanentemente?`)) return;
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      if (res.ok) router.push("/admin/usuarios");
    } catch {}
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-green-400 text-sm animate-pulse">Cargando...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400">Usuario no encontrado</p>
        <Link href="/admin/usuarios" className="text-green-400 text-sm hover:underline mt-2 inline-block">
          ← Volver a usuarios
        </Link>
      </div>
    );
  }

  const isGoogleUser = !!user.google_id;
  const myRole = currentUser?.role || "user";
  const canEdit = ["super_admin", "admin", "editor"].includes(myRole);
  const canDelete = ["super_admin", "admin"].includes(myRole);

  /** Roles que puede asignar este usuario */
  const ASSIGNABLE_ROLES: Record<string, string[]> = {
    super_admin: ["user", "viewer", "editor", "admin", "super_admin"],
    admin: ["user", "viewer", "editor", "admin"],
    editor: ["user"],
  };
  const myAssignableRoles = ASSIGNABLE_ROLES[myRole] || [];

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link
        href="/admin/usuarios"
        className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-green-400 transition-colors"
      >
        <ArrowLeft size={14} />
        Volver a usuarios
      </Link>

      {/* Message toast */}
      {message && (
        <div className={`px-4 py-2.5 rounded-xl text-sm ${
          message.type === "success"
            ? "bg-green-600/20 text-green-400 border border-green-500/30"
            : "bg-red-600/20 text-red-400 border border-red-500/30"
        }`}>
          {message.text}
        </div>
      )}

      {/* Profile header */}
      <div className="rounded-xl bg-[#121824] border border-[#202938] p-6">
        <div className="flex items-start gap-5">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-green-500 to-green-700 flex items-center justify-center text-2xl font-bold shrink-0">
            {(user.name || user.email)[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-white truncate">{user.name || "Sin nombre"}</h1>
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium text-white ${ROLE_STYLES[user.role] || "bg-gray-600"}`}>
                {user.role.replace("_", " ")}
              </span>
              {isGoogleUser && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-600/20 text-blue-400 border border-blue-500/30">
                  Google OAuth
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-gray-400">
              <span className="flex items-center gap-1.5">
                <Mail size={14} />
                {user.email}
              </span>
              <span className="flex items-center gap-1.5">
                <Calendar size={14} />
                Registrado: {new Date(user.created_at).toLocaleDateString("es-MX")}
              </span>
            </div>
          </div>

          {canEdit && (
            <div className="flex gap-2">
              <select
                value={user.role}
                disabled={updating}
                onChange={(e) => handleRoleChange(e.target.value)}
                className="bg-[#030812] border border-[#202938] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-green-500/50 disabled:opacity-50"
              >
                {myAssignableRoles.map((r) => (
                  <option key={r} value={r} className="bg-[#030812]">{r.replace("_", " ")}</option>
                ))}
              </select>
              {canDelete && currentUser?.id !== user.id && (
                <button
                  onClick={handleDelete}
                  className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Eliminar usuario"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl bg-[#121824] border border-[#202938] p-4">
          <p className="text-2xl font-bold text-white">{user.chatCount}</p>
          <p className="text-xs text-gray-500 mt-1">Chats totales</p>
        </div>
        <div className="rounded-xl bg-[#121824] border border-[#202938] p-4">
          <p className="text-2xl font-bold text-white">{user.projectCount}</p>
          <p className="text-xs text-gray-500 mt-1">Proyectos</p>
        </div>
        <div className="rounded-xl bg-[#121824] border border-[#202938] p-4">
          <p className="text-2xl font-bold text-white">{user.recentChats.length}</p>
          <p className="text-xs text-gray-500 mt-1">Chats recientes</p>
        </div>
        <div className="rounded-xl bg-[#121824] border border-[#202938] p-4">
          <p className="text-2xl font-bold text-white">{user.recentProjects.length}</p>
          <p className="text-xs text-gray-500 mt-1">Proyectos recientes</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Password change */}
        <div className="rounded-xl bg-[#121824] border border-[#202938] p-5">
          <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
            <Key size={16} className="text-amber-400" />
            Contraseña
          </h3>
          {isGoogleUser ? (
            <div className="bg-blue-600/10 border border-blue-500/20 rounded-xl px-4 py-3">
              <p className="text-xs text-blue-300">
                Este usuario inició sesión con Google OAuth. No tiene contraseña configurada.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Solo aplica a usuarios sin Google OAuth.
              </p>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Nueva contraseña (mín. 6 caracteres)"
                  className="w-full bg-[#030812] border border-[#202938] rounded-xl pl-4 pr-10 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50"
                />
                <button
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {canEdit && (
                <button
                  onClick={handlePasswordChange}
                  disabled={changingPassword || newPassword.length < 6}
                  className="w-full px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium disabled:opacity-50 transition-colors"
                >
                  {changingPassword ? "Actualizando..." : "Cambiar contraseña"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Recent Chats */}
        <div className="rounded-xl bg-[#121824] border border-[#202938] p-5">
          <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
            <MessageSquare size={16} className="text-green-400" />
            Chats recientes
          </h3>
          {user.recentChats.length === 0 ? (
            <p className="text-xs text-gray-500">Sin chats</p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {user.recentChats.map((chat) => (
                <div key={chat.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[#1e293b] transition-colors">
                  <span className="text-sm text-gray-300 truncate max-w-[200px]">{chat.title}</span>
                  <span className="text-[10px] text-gray-600 shrink-0">
                    {new Date(chat.updated_at).toLocaleDateString("es-MX")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Projects */}
        <div className="rounded-xl bg-[#121824] border border-[#202938] p-5">
          <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
            <FolderKanban size={16} className="text-purple-400" />
            Proyectos recientes
          </h3>
          {user.recentProjects.length === 0 ? (
            <p className="text-xs text-gray-500">Sin proyectos</p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {user.recentProjects.map((proj) => (
                <div key={proj.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[#1e293b] transition-colors">
                  <span className="text-sm text-gray-300 truncate max-w-[200px]">{proj.name}</span>
                  <span className="text-[10px] text-gray-600 shrink-0">
                    {new Date(proj.updated_at).toLocaleDateString("es-MX")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

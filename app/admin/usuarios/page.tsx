"use client";

import { useEffect, useState, useCallback } from "react";
import { Trash2, Shield, Search, RefreshCw, ChevronDown, Plus, X } from "lucide-react";
import Link from "next/link";
import type { UserRole } from "@/types";
import { useAuthStore } from "@/lib/stores/auth-store";

type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  google_id: string | null;
  picture: string | null;
  created_at: string;
  chat_count: number;
  project_count: number;
};

const ROLE_OPTIONS: { value: UserRole; label: string; color: string }[] = [
  { value: "user", label: "Usuario", color: "bg-gray-600" },
  { value: "viewer", label: "Viewer", color: "bg-blue-600" },
  { value: "editor", label: "Editor", color: "bg-purple-600" },
  { value: "admin", label: "Admin", color: "bg-amber-600" },
  { value: "super_admin", label: "Super Admin", color: "bg-red-600" },
];

/** Roles que puede asignar cada rol administrativo */
const ASSIGNABLE_ROLES: Record<string, UserRole[]> = {
  super_admin: ["user", "viewer", "editor", "admin", "super_admin"],
  admin: ["user", "viewer", "editor", "admin"],
  editor: ["user"],
};

export default function AdminUsuarios() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ email: "", password: "", name: "", role: "user" as string });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const currentUser = useAuthStore((s) => s.user);
  const myRole = currentUser?.role || "user";
  const canCreate = ["super_admin", "admin", "editor"].includes(myRole);
  const canDelete = ["super_admin", "admin"].includes(myRole);
  const canEditRole = ["super_admin", "admin", "editor"].includes(myRole);
  const myAssignableRoles = ASSIGNABLE_ROLES[myRole] || [];

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleRoleChange = async (userId: string, newRole: string) => {
    setChangingRole(userId);
    try {
      await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      await loadUsers();
    } catch {}
    setChangingRole(null);
  };

  const handleDelete = async (userId: string, email: string) => {
    if (!confirm(`¿Eliminar al usuario "${email}"? Esta acción no se puede deshacer.`)) return;
    try {
      await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
      await loadUsers();
    } catch {}
  };

  const handleCreate = async () => {
    setCreateError("");
    if (!createForm.email || !createForm.password) {
      setCreateError("Email y contraseña son requeridos");
      return;
    }
    if (createForm.password.length < 6) {
      setCreateError("La contraseña debe tener al menos 6 caracteres");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });
      if (res.ok) {
        setShowCreate(false);
        setCreateForm({ email: "", password: "", name: "", role: "user" });
        await loadUsers();
      } else {
        const data = await res.json();
        setCreateError(data.error || "Error al crear usuario");
      }
    } catch {
      setCreateError("Error de red");
    }
    setCreating(false);
  };

  const filtered = users.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.name && u.name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Usuarios</h1>
        <div className="flex gap-2">
          <button
            onClick={loadUsers}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#121824] border border-[#202938] text-xs text-gray-400 hover:text-white transition-colors"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Recargar
          </button>
          {canCreate && (
            <button
              onClick={() => { setShowCreate(true); setCreateError(""); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-medium transition-colors"
            >
              <Plus size={14} />
              Crear usuario
            </button>
          )}
        </div>
      </div>

      {/* Create User Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-[#121824] border border-[#202938] rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-white">Crear usuario</h2>
              <button onClick={() => setShowCreate(false)} className="p-1 rounded-lg text-gray-500 hover:text-white hover:bg-[#1e293b] transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Email *</label>
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  placeholder="correo@ejemplo.com"
                  className="w-full bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Nombre</label>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder="Nombre completo"
                  className="w-full bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Contraseña *</label>
                <input
                  type="password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Rol</label>
                <select
                  value={createForm.role}
                  onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
                  className="w-full bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-green-500/50"
                >
                  {ROLE_OPTIONS.filter((r) => myAssignableRoles.includes(r.value)).map((r) => (
                    <option key={r.value} value={r.value} className="bg-[#030812]">{r.label}</option>
                  ))}
                </select>
              </div>

              {createError && (
                <p className="text-xs text-red-400 bg-red-600/10 border border-red-500/30 rounded-lg px-3 py-2">{createError}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowCreate(false)} className="flex-1 px-4 py-2.5 rounded-xl text-sm text-gray-400 hover:text-white border border-[#202938] hover:bg-[#1e293b] transition-colors">
                  Cancelar
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  {creating ? "Creando..." : "Crear usuario"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          placeholder="Buscar por email o nombre..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-[#121824] border border-[#202938] rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50 transition-colors"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-[#202938]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#0d131d] border-b border-[#202938]">
              <th className="text-left px-4 py-3 font-medium text-gray-400">Usuario</th>
              <th className="text-left px-4 py-3 font-medium text-gray-400">Email</th>
              <th className="text-center px-4 py-3 font-medium text-gray-400">Chats</th>
              <th className="text-center px-4 py-3 font-medium text-gray-400">Proyectos</th>
              <th className="text-left px-4 py-3 font-medium text-gray-400">Rol</th>
              <th className="text-center px-4 py-3 font-medium text-gray-400">Auth</th>
              <th className="text-center px-4 py-3 font-medium text-gray-400">Registro</th>
              <th className="text-center px-4 py-3 font-medium text-gray-400">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-gray-500">
                  <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
                  Cargando usuarios...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-gray-500">
                  {search ? "No se encontraron usuarios" : "No hay usuarios registrados"}
                </td>
              </tr>
            ) : (
              filtered.map((u) => {
                const roleOpt = ROLE_OPTIONS.find((r) => r.value === u.role) || ROLE_OPTIONS[0];
                const isChanging = changingRole === u.id;

                return (
                  <tr key={u.id} className="border-b border-[#202938] last:border-0 hover:bg-[#121824]/50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/admin/usuarios/${u.id}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                        <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-xs font-bold shrink-0">
                          {((u.name || u.email || "?")[0]).toUpperCase()}
                        </div>
                        <span className="text-white font-medium truncate max-w-[160px]">
                          {u.name || "—"}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-400 truncate max-w-[200px]">{u.email}</td>
                    <td className="px-4 py-3 text-center text-gray-400">{u.chat_count}</td>
                    <td className="px-4 py-3 text-center text-gray-400">{u.project_count}</td>
                    <td className="px-4 py-3">
                      {canEditRole ? (
                        <div className="relative inline-block">
                          <select
                            value={u.role}
                            disabled={isChanging}
                            onChange={(e) => handleRoleChange(u.id, e.target.value)}
                            className={`appearance-none ${roleOpt.color} text-white text-[11px] font-medium px-2.5 py-1 rounded-full pr-7 cursor-pointer disabled:opacity-50 border-0 focus:outline-none focus:ring-2 focus:ring-green-500/50`}
                          >
                            {ROLE_OPTIONS.filter((opt) => myAssignableRoles.includes(opt.value) || opt.value === u.role).map((opt) => (
                              <option key={opt.value} value={opt.value} className="bg-[#0d131d] text-white">
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-white/70" />
                        </div>
                      ) : (
                        <span className={`${roleOpt.color} text-white text-[11px] font-medium px-2.5 py-1 rounded-full inline-block`}>
                          {roleOpt.label}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {u.google_id ? (
                        <span className="text-[10px] text-blue-400 bg-blue-600/10 px-2 py-0.5 rounded-full">Google</span>
                      ) : (
                        <span className="text-[10px] text-gray-500 bg-gray-600/10 px-2 py-0.5 rounded-full">Email</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-500 text-[11px]">
                      {new Date(u.created_at).toLocaleDateString("es-MX", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Link
                          href={`/admin/usuarios/${u.id}`}
                          className="p-1.5 rounded-lg text-gray-500 hover:text-green-400 hover:bg-green-500/10 transition-colors"
                          title="Ver detalle"
                        >
                          <Shield size={16} />
                        </Link>
                        {canDelete && (
                          <button
                            onClick={() => handleDelete(u.id, u.email)}
                            className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Eliminar usuario"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gray-600">
        Total: {users.length} usuario{users.length !== 1 ? "s" : ""}
        {search && ` (${filtered.length} filtrados)`}
      </p>
    </div>
  );
}

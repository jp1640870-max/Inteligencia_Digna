"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MessageSquare, FolderKanban, Calendar, Mail, Trash2, Key, Eye, EyeOff, Building2, Users, X } from "lucide-react";
import { useAuthStore } from "@/lib/stores/auth-store";
import { assignableRolesFor } from "@/types";

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
  areas: { id: string; name: string }[];
  groups: { id: string; name: string }[];
  recentChats: { id: string; title: string; created_at: string; updated_at: string }[];
  recentProjects: { id: string; name: string; created_at: string; updated_at: string }[];
};

/** Área o grupo: la tarjeta de membresías trata los dos igual. */
type Membership = { id: string; name: string };
type AreaLite = { id: string; name: string };
type GroupLite = { id: string; name: string };

const ROLE_STYLES: Record<string, string> = {
  user: "bg-gray-600",
  editor: "bg-purple-600",
  admin: "bg-amber-600",
  super_admin: "bg-red-600",
};

export default function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Password change
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // Membresías: las que tiene el usuario y el catálogo completo de áreas y
  // grupos activos, para poder quitar una y ofrecer la que le falta.
  const [allAreas, setAllAreas] = useState<AreaLite[]>([]);
  const [allGroups, setAllGroups] = useState<GroupLite[]>([]);
  const [membershipBusy, setMembershipBusy] = useState<string | null>(null);

  const currentUser = useAuthStore((s) => s.user);
  const myRole = currentUser?.role || "user";
  // Asignar pertenencia decide a qué puede leer alguien. Es de perímetro:
  // un `editor` ve las membresías pero no las mueve, y las APIs de miembros
  // le devuelven 403 de todas formas.
  const canAssignMembership = ["super_admin", "admin"].includes(myRole);

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

  // Catálogos para los selectores. Diferido a una macrotarea para no hacer
  // setState síncrono dentro del efecto (react-hooks/set-state-in-effect), igual
  // que en la lista de usuarios.
  useEffect(() => {
    const load = async () => {
      try {
        const [areasRes, groupsRes] = await Promise.all([
          fetch("/api/admin/areas"),
          fetch("/api/admin/groups"),
        ]);
        if (areasRes.ok) {
          const data = await areasRes.json();
          setAllAreas((data.areas ?? []).map((a: AreaLite) => ({ id: a.id, name: a.name })));
        }
        if (groupsRes.ok) {
          const data = await groupsRes.json();
          setAllGroups((data.groups ?? []).map((g: GroupLite) => ({ id: g.id, name: g.name })));
        }
      } catch {}
    };
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, []);

  /**
   * Alta o baja de una pertenencia.
   *
   * El alta envía `{ userId }` en el body y la baja `?userId=` en la query: son
   * las dos formas distintas que esperan las rutas de miembros. Mandarlo al revés
   * devolvía `userId es requerido` sin llegar a tocar nada.
   *
   * El alta es idempotente en el servidor, así que un doble clic no rompe nada;
   * la baja responde 404 si ya no era miembro.
   */
  const toggleMembership = async (
    kind: "areas" | "groups",
    principalId: string,
    member: boolean,
  ) => {
    setMembershipBusy(principalId);
    try {
      const res = await fetch(
        member
          ? `/api/admin/${kind}/${principalId}/members`
          : `/api/admin/${kind}/${principalId}/members?userId=${encodeURIComponent(id)}`,
        {
          method: member ? "POST" : "DELETE",
          ...(member
            ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: id }) }
            : {}),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage({ type: "error", text: data.error || "No se pudo actualizar" });
        return;
      }
      const next: Membership =
        kind === "areas"
          ? { id: principalId, name: allAreas.find((a) => a.id === principalId)?.name ?? "área" }
          : { id: principalId, name: allGroups.find((g) => g.id === principalId)?.name ?? "grupo" };
      setUser((prev) =>
        prev
          ? {
              ...prev,
              [kind]: member
                ? [...prev[kind], next]
                : prev[kind].filter((m) => m.id !== principalId),
            }
          : prev,
      );
      setMessage({ type: "success", text: member ? `Añadido a ${next.name}` : `Quitado de ${next.name}` });
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage({ type: "error", text: "Error de red" });
    } finally {
      setMembershipBusy(null);
    }
  };

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
  const canEdit = ["super_admin", "admin", "editor"].includes(myRole);
  const canDelete = ["super_admin", "admin"].includes(myRole);

  /** Roles que puede asignar este usuario. La tabla vive en `@/types`. */
  const myAssignableRoles = assignableRolesFor(myRole);

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

      {/* ─── Áreas y grupos ─── */}
      <div className="rounded-xl bg-[#121824] border border-[#202938] p-5">
        <h3 className="text-sm font-medium text-white mb-1 flex items-center gap-2">
          <Building2 size={16} className="text-cyan-400" />
          Áreas y grupos
        </h3>
        <p className="text-xs text-gray-500 mb-4">
          Entrar en un área no da acceso por sí solo: solo recupera los documentos que el área
          ya tiene concedidos. Sin al menos un área, este usuario no lee nada de la base de
          conocimiento.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {(
            [
              { kind: "areas" as const, label: "Áreas", icon: Building2, catalog: allAreas },
              { kind: "groups" as const, label: "Grupos", icon: Users, catalog: allGroups },
            ] as const
          ).map(({ kind, label, icon: Icon, catalog }) => {
            const assigned = user[kind];
            const available = catalog.filter((c) => !assigned.some((m) => m.id === c.id));
            return (
              <div key={kind}>
                <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
                  <Icon size={12} />
                  {label}
                  <span className="text-gray-600">({assigned.length})</span>
                </p>

                {assigned.length === 0 ? (
                  <p className="text-xs text-gray-600 mb-2">Sin asignar</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {assigned.map((m) => (
                      <span
                        key={m.id}
                        className="inline-flex items-center gap-1 text-[11px] bg-cyan-600/10 text-cyan-400 px-2 py-1 rounded-full"
                      >
                        {m.name}
                        {canAssignMembership && (
                          <button
                            disabled={membershipBusy === m.id}
                            onClick={() => toggleMembership(kind, m.id, false)}
                            className="text-cyan-300/60 hover:text-red-400 transition-colors disabled:opacity-40"
                            title={`Quitar de ${m.name}`}
                          >
                            <X size={11} />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}

                {canAssignMembership && available.length > 0 && (
                  <select
                    value=""
                    disabled={membershipBusy !== null}
                    onChange={(e) => {
                      if (e.target.value) toggleMembership(kind, e.target.value, true);
                    }}
                    className="w-full appearance-none bg-[#030812] border border-[#202938] rounded-lg px-3 py-2 text-xs text-gray-500 focus:outline-none disabled:opacity-50"
                  >
                    <option value="">+ añadir a {label.toLowerCase()}...</option>
                    {available.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>

        {!canAssignMembership && (
          <p className="text-[11px] text-gray-600 mt-4">
            Solo un administrador puede cambiar estas pertenencias.
          </p>
        )}
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

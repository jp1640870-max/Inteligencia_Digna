"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Users, Activity, Clock, User, Shield } from "lucide-react";
import { useAuthStore } from "@/lib/stores/auth-store";

export default function AdminSesiones() {
  const currentUser = useAuthStore((s) => s.user);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [targetEmail, setTargetEmail] = useState("");
  const [impersonating, setImpersonating] = useState(false);
  const [impersonateMsg, setImpersonateMsg] = useState("");

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/sessions");
      if (res.ok) setData(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const handleImpersonate = async () => {
    if (!targetEmail.trim()) return;
    setImpersonating(true);
    setImpersonateMsg("");
    try {
      // Buscar usuario por email primero
      const usersRes = await fetch("/api/admin/users");
      if (!usersRes.ok) { setImpersonateMsg("Error al buscar usuarios"); setImpersonating(false); return; }
      const { users } = await usersRes.json();
      const target = users.find((u: any) => u.email.toLowerCase() === targetEmail.toLowerCase());
      if (!target) { setImpersonateMsg("Usuario no encontrado"); setImpersonating(false); return; }

      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: target.id }),
      });
      const data2 = await res.json();
      if (res.ok) {
        setImpersonateMsg(`✅ ${data2.message}`);
        // Ofrecer redirigir
        if (confirm(`¿Ir a la app como ${target.email}?`)) {
          document.cookie = `token=${data2.token}; path=/; max-age=604800; SameSite=Lax`;
          window.location.href = "/";
        }
      } else {
        setImpersonateMsg(`❌ ${data2.error}`);
      }
    } catch {}
    setImpersonating(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Sesiones</h1>
        <button onClick={loadSessions} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#121824] border border-[#202938] text-xs text-gray-400 hover:text-white transition-colors">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Recargar
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl bg-[#121824] border border-[#202938] p-5">
          <Activity size={20} className="text-green-400 mb-2" />
          <p className="text-2xl font-bold text-white">{data?.activeToday ?? "—"}</p>
          <p className="text-xs text-gray-500 mt-1">Activos hoy</p>
        </div>
        <div className="rounded-xl bg-[#121824] border border-[#202938] p-5">
          <Users size={20} className="text-blue-400 mb-2" />
          <p className="text-2xl font-bold text-white">{data?.totalUsers ?? "—"}</p>
          <p className="text-xs text-gray-500 mt-1">Usuarios totales</p>
        </div>
        <div className="rounded-xl bg-[#121824] border border-[#202938] p-5">
          <Clock size={20} className="text-amber-400 mb-2" />
          <p className="text-2xl font-bold text-white">{data?.recentLogins?.length ?? "—"}</p>
          <p className="text-xs text-gray-500 mt-1">Registros 24h</p>
        </div>
      </div>

      {/* Impersonación */}
      {currentUser?.role === "super_admin" && (
        <div className="rounded-xl bg-[#121824] border border-[#202938] p-5">
          <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
            <Shield size={16} className="text-amber-400" />
            Impersonar usuario
          </h3>
          <p className="text-xs text-gray-500 mb-3">
            Entra a la app como otro usuario para ver exactamente lo que él ve.
          </p>
          <div className="flex gap-3">
            <input
              value={targetEmail}
              onChange={(e) => setTargetEmail(e.target.value)}
              placeholder="Email del usuario a impersonar..."
              className="flex-1 bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50"
            />
            <button
              onClick={handleImpersonate}
              disabled={impersonating || !targetEmail.trim()}
              className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium disabled:opacity-50 transition-colors"
            >
              {impersonating ? "..." : "Impersonar"}
            </button>
          </div>
          {impersonateMsg && (
            <p className="text-xs mt-2 text-gray-400">{impersonateMsg}</p>
          )}
        </div>
      )}

      {/* Usuarios recientes */}
      <div className="rounded-xl bg-[#121824] border border-[#202938] p-5">
        <h3 className="text-sm font-medium text-white mb-3">Usuarios recientes (últimas 24h)</h3>
        {data?.recentLogins?.length > 0 ? (
          <div className="space-y-1">
            {data.recentLogins.map((u: any) => (
              <div key={u.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#1e293b] transition-colors">
                <div className="w-7 h-7 rounded-full bg-green-600 flex items-center justify-center text-[10px] font-bold shrink-0">
                  {(u.name || u.email || "?")[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{u.name || u.email}</p>
                  <p className="text-[10px] text-gray-500">{u.email}</p>
                </div>
                <span className="text-[10px] text-gray-600 shrink-0">{u.role?.replace("_", " ")}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500">Sin datos</p>
        )}
      </div>
    </div>
  );
}

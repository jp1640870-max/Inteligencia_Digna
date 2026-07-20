"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Download, HardDrive, Calendar, Database, Shield } from "lucide-react";
import { useAuthStore } from "@/lib/stores/auth-store";

type Backup = {
  id: string;
  filename: string;
  size_bytes: number;
  status: string;
  created_by_name: string | null;
  created_at: string;
};

export default function AdminBackups() {
  const user = useAuthStore((s) => s.user);
  const canCreate = user?.role === "super_admin" || user?.role === "admin";
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const loadBackups = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/backups");
      if (res.ok) {
        const data = await res.json();
        setBackups(data.backups);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadBackups(); }, [loadBackups]);

  const handleCreateBackup = async () => {
    if (!canCreate) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/backups", { method: "POST" });
      if (res.ok) await loadBackups();
    } catch {}
    setCreating(false);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Backups</h1>
        <div className="flex gap-2">
          <button onClick={loadBackups} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#121824] border border-[#202938] text-xs text-gray-400 hover:text-white transition-colors">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Recargar
          </button>
          {canCreate && (
            <button
              onClick={handleCreateBackup}
              disabled={creating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-medium disabled:opacity-50 transition-colors"
            >
              <HardDrive size={14} className={creating ? "animate-spin" : ""} />
              {creating ? "Creando..." : "Crear backup"}
            </button>
          )}
        </div>
      </div>

      {!canCreate && (
        <div className="rounded-xl bg-amber-600/10 border border-amber-500/30 p-4 text-amber-400 text-sm">
          Solo super_admin puede crear backups.
        </div>
      )}

      <div className="rounded-xl bg-[#121824] border border-[#202938] p-5">
        <div className="flex items-center gap-3 mb-4">
          <Database size={20} className="text-green-400" />
          <div>
            <h3 className="text-sm font-medium text-white">Base de Datos SQLite</h3>
            <p className="text-[11px] text-gray-500">Backup completo del archivo app.db</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#202938]">
                <th className="text-left px-3 py-2 font-medium text-gray-400 text-[11px]">Archivo</th>
                <th className="text-right px-3 py-2 font-medium text-gray-400 text-[11px]">Tamaño</th>
                <th className="text-center px-3 py-2 font-medium text-gray-400 text-[11px]">Estado</th>
                <th className="text-left px-3 py-2 font-medium text-gray-400 text-[11px]">Creado por</th>
                <th className="text-left px-3 py-2 font-medium text-gray-400 text-[11px]">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-center py-8 text-gray-500">Cargando...</td></tr>
              ) : backups.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-8 text-gray-500">
                  <HardDrive size={24} className="mx-auto mb-2 opacity-50" />
                  No hay backups aún
                </td></tr>
              ) : (
                backups.map((b) => (
                  <tr key={b.id} className="border-b border-[#202938] last:border-0 hover:bg-[#1e293b]/50 transition-colors">
                    <td className="px-3 py-3 text-xs text-white truncate max-w-[200px]">{b.filename}</td>
                    <td className="px-3 py-3 text-xs text-gray-400 text-right">{formatSize(b.size_bytes)}</td>
                    <td className="px-3 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        b.status === "completed" ? "bg-green-600/20 text-green-400" :
                        b.status === "failed" ? "bg-red-600/20 text-red-400" :
                        "bg-amber-600/20 text-amber-400"
                      }`}>
                        {b.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-500">{b.created_by_name || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-500">{new Date(b.created_at).toLocaleString("es-MX")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl bg-[#121824] border border-[#202938] p-5">
        <h3 className="text-sm font-medium text-white mb-2">💡 Información</h3>
        <ul className="text-xs text-gray-500 space-y-1 list-disc pl-4">
          <li>Los backups se almacenan en <code className="text-green-400">data/backups/</code></li>
          <li>Se realiza un WAL checkpoint antes de copiar la DB</li>
          <li>Para restaurar: detén la app, copia el backup a <code className="text-green-400">data/app.db</code>, reinicia</li>
          <li>Los backups no incluyen archivos subidos (solo la DB)</li>
        </ul>
      </div>
    </div>
  );
}

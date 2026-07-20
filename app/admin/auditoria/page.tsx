"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Search, Filter, Calendar } from "lucide-react";

type AuditEntry = {
  id: number;
  user_id: string | null;
  action: string;
  details: string;
  ip: string;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
};

const ACTION_COLORS: Record<string, string> = {
  login: "bg-green-600/20 text-green-400",
  logout: "bg-gray-600/20 text-gray-400",
  register: "bg-blue-600/20 text-blue-400",
  role_change: "bg-amber-600/20 text-amber-400",
  config_change: "bg-purple-600/20 text-purple-400",
  impersonate: "bg-red-600/20 text-red-400",
  delete_user: "bg-red-600/20 text-red-400",
  create_heart: "bg-indigo-600/20 text-indigo-400",
  delete_heart: "bg-red-600/20 text-red-400",
  create_announcement: "bg-cyan-600/20 text-cyan-400",
  backup: "bg-teal-600/20 text-teal-400",
};

export default function AdminAuditoria() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const perPage = 50;

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(perPage), offset: String(page * perPage) });
      if (filterAction) params.set("action", filterAction);
      const res = await fetch(`/api/admin/audit?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs);
        setTotal(data.total);
        if (data.actions) setActions(data.actions.map((a: any) => a.action));
      }
    } catch {}
    setLoading(false);
  }, [page, filterAction]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const filtered = search
    ? logs.filter((l) =>
        (l.details || "").toLowerCase().includes(search.toLowerCase()) ||
        (l.user_email || "").toLowerCase().includes(search.toLowerCase()) ||
        l.action.toLowerCase().includes(search.toLowerCase())
      )
    : logs;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Auditoría</h1>
        <button onClick={loadLogs} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#121824] border border-[#202938] text-xs text-gray-400 hover:text-white transition-colors">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Recargar
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar en auditoría..." className="w-full bg-[#121824] border border-[#202938] rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50" />
        </div>
        <select value={filterAction} onChange={(e) => { setFilterAction(e.target.value); setPage(0); }} className="bg-[#121824] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-green-500/50">
          <option value="" className="bg-[#030812]">Todas las acciones</option>
          {actions.map((a) => (
            <option key={a} value={a} className="bg-[#030812]">{a.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#202938]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#0d131d] border-b border-[#202938]">
              <th className="text-left px-4 py-3 font-medium text-gray-400">Fecha</th>
              <th className="text-left px-4 py-3 font-medium text-gray-400">Usuario</th>
              <th className="text-left px-4 py-3 font-medium text-gray-400">Acción</th>
              <th className="text-left px-4 py-3 font-medium text-gray-400">Detalles</th>
              <th className="text-right px-4 py-3 font-medium text-gray-400">IP</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-12 text-gray-500">Cargando...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-12 text-gray-500">Sin registros</td></tr>
            ) : (
              filtered.map((log) => (
                <tr key={log.id} className="border-b border-[#202938] last:border-0 hover:bg-[#121824]/50 transition-colors">
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString("es-MX")}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs truncate max-w-[150px]">
                    {log.user_name || log.user_email || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium ${ACTION_COLORS[log.action] || "bg-gray-600/20 text-gray-400"}`}>
                      {log.action.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 max-w-[300px] truncate">{log.details}</td>
                  <td className="px-4 py-3 text-right text-[10px] text-gray-600">{log.ip || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{total} registros (pág. {page + 1})</span>
        <div className="flex gap-2">
          <button disabled={page === 0} onClick={() => setPage(page - 1)} className="px-3 py-1.5 rounded-lg bg-[#121824] border border-[#202938] disabled:opacity-30 hover:text-white transition-colors">Anterior</button>
          <button disabled={(page + 1) * perPage >= total} onClick={() => setPage(page + 1)} className="px-3 py-1.5 rounded-lg bg-[#121824] border border-[#202938] disabled:opacity-30 hover:text-white transition-colors">Siguiente</button>
        </div>
      </div>
    </div>
  );
}

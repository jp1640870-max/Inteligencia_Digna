"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Download, BarChart3, Users, MessageSquare, Heart, Activity } from "lucide-react";

type Report = {
  generatedAt: string;
  summary: {
    totalUsers: number;
    totalChats: number;
    totalMessages: number;
    totalProjects: number;
    chatsToday: number;
    activeUsers: number;
  };
  usersByRole: Record<string, number>;
  heartsByType: { presets: number; public: number; total: number };
  topUsers: { name: string; email: string; role: string; chats: number }[];
  topChats: { title: string; user: string; messages: number; updated: string }[];
};

export default function AdminReportes() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/reports");
      if (res.ok) setReport(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadReport(); }, [loadReport]);

  const handleDownloadJSON = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reporte-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-500 animate-pulse">Generando reporte...</div>;
  }

  if (!report) {
    return <div className="text-center py-12 text-gray-500">Error al generar reporte</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Reportes</h1>
        <div className="flex gap-2">
          <button onClick={loadReport} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#121824] border border-[#202938] text-xs text-gray-400 hover:text-white transition-colors">
            <RefreshCw size={14} />
            Regenerar
          </button>
          <button onClick={handleDownloadJSON} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-medium transition-colors">
            <Download size={14} />
            Exportar JSON
          </button>
        </div>
      </div>

      <p className="text-[11px] text-gray-500">Generado: {new Date(report.generatedAt).toLocaleString("es-MX")}</p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {Object.entries(report.summary).map(([key, val]) => (
          <div key={key} className="rounded-xl bg-[#121824] border border-[#202938] p-4 text-center">
            <p className="text-xl font-bold text-white">{val}</p>
            <p className="text-[10px] text-gray-500 mt-1">{key.replace(/([A-Z])/g, " $1").trim()}</p>
          </div>
        ))}
      </div>

      {/* Users by role */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl bg-[#121824] border border-[#202938] p-5">
          <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
            <Users size={16} className="text-blue-400" />
            Usuarios por rol
          </h3>
          <div className="space-y-2">
            {Object.entries(report.usersByRole).map(([role, count]) => (
              <div key={role} className="flex items-center justify-between">
                <span className="text-sm text-gray-300 capitalize">{role.replace("_", " ")}</span>
                <div className="flex items-center gap-3">
                  <div className="w-32 lg:w-48 h-2 rounded-full bg-[#030812] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-green-500"
                      style={{ width: `${(count / report.summary.totalUsers) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm text-white font-medium w-8 text-right">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-[#121824] border border-[#202938] p-5">
          <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
            <Heart size={16} className="text-purple-400" />
            Hearts
          </h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">Totales</span>
              <span className="text-sm text-white font-medium">{report.heartsByType.total}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">Presets</span>
              <span className="text-sm text-white font-medium">{report.heartsByType.presets}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">Públicos</span>
              <span className="text-sm text-white font-medium">{report.heartsByType.public}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Top users */}
      <div className="rounded-xl bg-[#121824] border border-[#202938] p-5">
        <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
          <BarChart3 size={16} className="text-amber-400" />
          Top 10 usuarios por actividad
        </h3>
        <div className="space-y-1">
          {report.topUsers.map((u, i) => (
            <div key={u.email} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#1e293b] transition-colors">
              <span className="text-xs text-gray-500 w-5 text-right">{i + 1}.</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{u.name || u.email}</p>
              </div>
              <span className="text-[10px] text-gray-500 capitalize">{u.role.replace("_", " ")}</span>
              <span className="text-xs text-gray-400">{u.chats} chats</span>
            </div>
          ))}
        </div>
      </div>

      {/* Top chats */}
      <div className="rounded-xl bg-[#121824] border border-[#202938] p-5">
        <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
          <MessageSquare size={16} className="text-green-400" />
          Top 10 conversaciones
        </h3>
        <div className="space-y-1">
          {report.topChats.map((c, i) => (
            <div key={c.title + i} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#1e293b] transition-colors">
              <span className="text-xs text-gray-500 w-5 text-right">{i + 1}.</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{c.title}</p>
                <p className="text-[10px] text-gray-500">{c.user}</p>
              </div>
              <span className="text-xs text-gray-400">{c.messages} msgs</span>
              <span className="text-[10px] text-gray-600">{new Date(c.updated).toLocaleDateString("es-MX")}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

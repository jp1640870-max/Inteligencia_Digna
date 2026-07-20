"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Activity, Database, Cpu, HardDrive, Wifi } from "lucide-react";

type CheckResult = {
  status: "ok" | "error";
  detail?: string;
  latency?: number;
};

type HealthResponse = {
  status: "healthy" | "degraded";
  timestamp: string;
  checks: Record<string, CheckResult>;
};

const CHECK_ICONS: Record<string, React.ReactNode> = {
  database: <Database size={18} />,
  ollama: <Cpu size={18} />,
  memory: <HardDrive size={18} />,
  node: <Activity size={18} />,
};

const CHECK_LABELS: Record<string, string> = {
  database: "Base de Datos",
  ollama: "Ollama (LLM)",
  memory: "Memoria del Servidor",
  node: "Node.js",
};

export default function AdminSistema() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const loadHealth = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/health");
      if (res.ok) setHealth(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  // Auto-refresh cada 15s
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(loadHealth, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadHealth]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Estado del Sistema</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-green-500"
            />
            Auto-refresh (15s)
          </label>
          <button
            onClick={loadHealth}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#121824] border border-[#202938] text-xs text-gray-400 hover:text-white transition-colors"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Recargar
          </button>
        </div>
      </div>

      {/* Status global */}
      {health && (
        <div
          className={`flex items-center gap-3 px-5 py-4 rounded-xl border ${
            health.status === "healthy"
              ? "bg-green-600/10 border-green-500/30 text-green-400"
              : "bg-amber-600/10 border-amber-500/30 text-amber-400"
          }`}
        >
          <Activity size={24} />
          <div>
            <p className="font-semibold text-sm">
              {health.status === "healthy" ? "✅ Todos los sistemas operativos" : "⚠️ Servicios degradados"}
            </p>
            <p className="text-xs opacity-70">
              Última actualización: {new Date(health.timestamp).toLocaleString("es-MX")}
            </p>
          </div>
        </div>
      )}

      {/* Checks grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Object.entries(CHECK_LABELS).map(([key, label]) => {
          const check = health?.checks[key];
          const icon = CHECK_ICONS[key] || <Wifi size={18} />;

          return (
            <div
              key={key}
              className={`rounded-xl border p-5 transition-colors ${
                !check
                  ? "bg-[#121824] border-[#202938]"
                  : check.status === "ok"
                  ? "bg-[#121824] border-[#202938]"
                  : "bg-amber-600/5 border-amber-500/30"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className={check?.status === "ok" ? "text-green-400" : check ? "text-amber-400" : "text-gray-500"}>
                    {icon}
                  </span>
                  <div>
                    <h3 className="text-sm font-medium text-white">{label}</h3>
                    {check ? (
                      <div className="mt-1 space-y-0.5">
                        <p className="text-xs text-gray-400">{check.detail}</p>
                        {check.latency !== undefined && (
                          <p className="text-[11px] text-gray-500">
                            Latencia: {check.latency}ms
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 mt-1">Cargando...</p>
                    )}
                  </div>
                </div>
                {check && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      check.status === "ok"
                        ? "bg-green-600/20 text-green-400"
                        : "bg-amber-600/20 text-amber-400"
                    }`}
                  >
                    {check.status === "ok" ? "Online" : "Error"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Stats rápidas desde DB */}
      <HealthStats />

      {/* Info adicional */}
      <div className="rounded-xl bg-[#121824] border border-[#202938] p-5">
        <h3 className="text-sm font-medium text-white mb-2">Información del Entorno</h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
          <div>
            <p className="text-gray-500">Node.js</p>
            <p className="text-gray-300">{typeof process !== "undefined" ? process.version : "—"}</p>
          </div>
          <div>
            <p className="text-gray-500">Plataforma</p>
            <p className="text-gray-300">{typeof process !== "undefined" ? process.platform : "—"}</p>
          </div>
          <div>
            <p className="text-gray-500">Arquitectura</p>
            <p className="text-gray-300">{typeof process !== "undefined" ? process.arch : "—"}</p>
          </div>
          <div>
            <p className="text-gray-500">Next.js</p>
            <p className="text-gray-300">16.2.9</p>
          </div>
          <div>
            <p className="text-gray-500">Modelo LLM</p>
            <p className="text-gray-300">Gemma 4 26B</p>
          </div>
          <div>
            <p className="text-gray-500">Hardware</p>
            <p className="text-gray-300">DGX Spark</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function HealthStats() {
  const [stats, setStats] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  if (!stats) return null;

  const items = [
    { label: "Usuarios totales", value: stats.totalUsers },
    { label: "Chats totales", value: stats.totalChats },
    { label: "Mensajes totales", value: stats.totalMessages },
    { label: "Proyectos totales", value: stats.totalProjects },
    { label: "Chats hoy", value: stats.chatsToday },
    { label: "Mensajes hoy", value: stats.messagesToday },
  ];

  return (
    <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl bg-[#121824] border border-[#202938] p-4 text-center">
          <p className="text-xl font-bold text-white">{item.value}</p>
          <p className="text-[10px] text-gray-500 mt-1">{item.label}</p>
        </div>
      ))}
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Search, Save, RotateCcw } from "lucide-react";
import { useAuthStore } from "@/lib/stores/auth-store";

type ConfigItem = {
  key: string;
  value: string;
  description: string;
  updated_at: string;
};

const CATEGORIES: Record<string, { label: string; keys: string[] }> = {
  general: { label: "Generales", keys: ["allow_registration", "allow_guest_access", "default_user_role", "maintenance_mode"] },
  limits: { label: "Límites", keys: ["max_chats_per_user", "max_file_size_mb", "max_knowledge_files_per_heart", "rate_limit_per_minute"] },
  ollama: { label: "Ollama / Modelo", keys: ["ollama_context_length", "ollama_num_predict", "ollama_temperature"] },
  features: { label: "Features", keys: ["heart_memory_enabled", "chat_summary_enabled"] },
};

const BOOLEAN_KEYS = ["allow_registration", "allow_guest_access", "maintenance_mode", "heart_memory_enabled", "chat_summary_enabled"];

export default function AdminConfig() {
  const user = useAuthStore((s) => s.user);
  const canEdit = user?.role === "super_admin" || user?.role === "admin";

  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/config");
      if (res.ok) {
        const data = await res.json();
        setConfigs(data.configs);
        const map: Record<string, string> = {};
        data.configs.forEach((c: ConfigItem) => { map[c.key] = c.value; });
        setEditing(map);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleSave = async (key: string) => {
    setSaving(key);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: editing[key] }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: `${key} actualizado` });
        setTimeout(() => setMessage(null), 2000);
      } else {
        setMessage({ type: "error", text: "Error al guardar" });
      }
    } catch {
      setMessage({ type: "error", text: "Error de red" });
    }
    setSaving(null);
  };

  const configMap = new Map(configs.map((c) => [c.key, c]));

  const filteredCategories = Object.entries(CATEGORIES)
    .map(([slug, cat]) => ({
      ...cat,
      slug,
      items: cat.keys.filter((k) => k.toLowerCase().includes(search.toLowerCase())),
    }))
    .filter((cat) => cat.items.length > 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Configuración</h1>
        <div className="flex items-center gap-2">
          {message && (
            <span className={`text-xs px-3 py-1.5 rounded-lg ${message.type === "success" ? "bg-green-600/20 text-green-400" : "bg-red-600/20 text-red-400"}`}>
              {message.text}
            </span>
          )}
          <button
            onClick={loadConfig}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#121824] border border-[#202938] text-xs text-gray-400 hover:text-white transition-colors"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Recargar
          </button>
        </div>
      </div>

      {!canEdit && (
        <div className="rounded-xl bg-amber-600/10 border border-amber-500/30 p-4 text-amber-400 text-sm">
          Solo los usuarios <strong>super_admin</strong> pueden modificar la configuración.
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar configuración..."
          className="w-full bg-[#121824] border border-[#202938] rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50"
        />
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">
          <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
          Cargando configuración...
        </div>
      ) : (
        filteredCategories.map((cat) => (
          <div key={cat.slug}>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">{cat.label}</h2>
            <div className="rounded-xl border border-[#202938] overflow-hidden">
              {cat.items.map((key) => {
                const cfg = configMap.get(key);
                const isBool = BOOLEAN_KEYS.includes(key);
                const isSaving = saving === key;

                return (
                  <div key={key} className="flex items-center justify-between px-5 py-3.5 border-b border-[#202938] last:border-0 hover:bg-[#121824]/50 transition-colors">
                    <div className="flex-1 min-w-0 mr-4">
                      <p className="text-sm text-white font-medium">{key.replace(/_/g, " ")}</p>
                      {cfg?.description && <p className="text-[11px] text-gray-500 mt-0.5">{cfg.description}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isBool ? (
                        <button
                          disabled={!canEdit || isSaving}
                          onClick={() => {
                            const newVal = editing[key] === "true" ? "false" : "true";
                            setEditing({ ...editing, [key]: newVal });
                            handleSave(key);
                          }}
                          className={`relative w-12 h-6 rounded-full transition-colors ${
                            editing[key] === "true" ? "bg-green-600" : "bg-gray-600"
                          } disabled:opacity-50`}
                        >
                          <span
                            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                              editing[key] === "true" ? "translate-x-6" : "translate-x-0.5"
                            }`}
                          />
                        </button>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <input
                            value={editing[key] || ""}
                            disabled={!canEdit}
                            onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                            className="w-24 lg:w-32 bg-[#030812] border border-[#202938] rounded-lg px-3 py-1.5 text-xs text-white text-right focus:outline-none focus:border-green-500/50 disabled:opacity-50"
                          />
                          {canEdit && (
                            <button
                              onClick={() => handleSave(key)}
                              disabled={isSaving}
                              className="p-1.5 rounded-lg text-gray-500 hover:text-green-400 hover:bg-green-500/10 transition-colors disabled:opacity-50"
                              title="Guardar"
                            >
                              {isSaving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {!loading && filteredCategories.length === 0 && (
        <div className="text-center py-12 text-gray-500">Sin resultados</div>
      )}
    </div>
  );
}

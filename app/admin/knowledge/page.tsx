"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, RefreshCw, Search, BookOpen } from "lucide-react";

type KnowledgeEntry = {
  id: string;
  title: string;
  content: string;
  category: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

const CATEGORIES = ["general", "legal", "medico", "procesos", "faq", "seguridad"];

export default function AdminKnowledge() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", category: "general" });
  const [saving, setSaving] = useState(false);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const url = filterCategory
        ? `/api/admin/knowledge?category=${filterCategory}`
        : "/api/admin/knowledge";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries);
      }
    } catch {}
    setLoading(false);
  }, [filterCategory]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const handleCreate = async () => {
    if (!form.title.trim() || !form.content.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/admin/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setForm({ title: "", content: "", category: "general" });
      setShowForm(false);
      await loadEntries();
    } catch {}
    setSaving(false);
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`¿Eliminar "${title}"?`)) return;
    try {
      await fetch(`/api/admin/knowledge/${id}`, { method: "DELETE" });
      await loadEntries();
    } catch {}
  };

  const filtered = entries.filter(
    (e) =>
      e.title.toLowerCase().includes(search.toLowerCase()) ||
      e.content.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Knowledge Base</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={loadEntries}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#121824] border border-[#202938] text-xs text-gray-400 hover:text-white transition-colors"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Recargar
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-medium transition-colors"
          >
            <Plus size={14} />
            Nueva entrada
          </button>
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-xl bg-[#121824] border border-[#202938] p-5 space-y-4">
          <h3 className="text-sm font-medium text-white">Nueva entrada de conocimiento</h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <input
              type="text"
              placeholder="Título"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50 transition-colors"
            />
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-green-500/50 transition-colors"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat} className="bg-[#030812]">
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </option>
              ))}
            </select>
            <div className="flex gap-2 justify-end items-center">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2.5 rounded-xl text-xs text-gray-400 hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={saving || !form.title.trim() || !form.content.trim()}
                className="px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-xs font-medium transition-colors disabled:opacity-50"
              >
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
          <textarea
            placeholder="Contenido de la entrada de conocimiento..."
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            rows={6}
            className="w-full bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50 transition-colors resize-y"
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Buscar en knowledge base..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#121824] border border-[#202938] rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50 transition-colors"
          />
        </div>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="bg-[#121824] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-green-500/50 transition-colors"
        >
          <option value="" className="bg-[#030812]">Todas las categorías</option>
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat} className="bg-[#030812]">
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* Entries list */}
      <div className="space-y-3">
        {loading ? (
          <div className="text-center py-12 text-gray-500">
            <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
            Cargando entradas...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <BookOpen size={32} className="mx-auto mb-3 opacity-50" />
            {search || filterCategory
              ? "No se encontraron entradas con esos filtros"
              : "No hay entradas en la base de conocimiento"}
          </div>
        ) : (
          filtered.map((entry) => (
            <div
              key={entry.id}
              className="rounded-xl bg-[#121824] border border-[#202938] p-5 hover:border-green-500/20 transition-colors group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-medium text-white truncate">{entry.title}</h3>
                    <span className="px-2 py-0.5 rounded-full bg-green-600/20 text-green-400 text-[10px] font-medium shrink-0">
                      {entry.category}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 line-clamp-3 whitespace-pre-wrap">
                    {entry.content}
                  </p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-[10px] text-gray-600">
                      Por: {entry.created_by_name || "—"}
                    </span>
                    <span className="text-[10px] text-gray-600">
                      {new Date(entry.updated_at).toLocaleDateString("es-MX")}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(entry.id, entry.title)}
                  className="p-2 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                  title="Eliminar entrada"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <p className="text-[11px] text-gray-600">
        Total: {entries.length} entrada{entries.length !== 1 ? "s" : ""}
        {(search || filterCategory) && ` (${filtered.length} filtrados)`}
      </p>
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, RefreshCw, Megaphone, Eye, EyeOff } from "lucide-react";

type Announcement = {
  id: string;
  title: string;
  content: string;
  type: string;
  active: number;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

const TYPE_STYLES: Record<string, string> = {
  info: "bg-blue-600/20 text-blue-400 border-blue-500/30",
  warning: "bg-amber-600/20 text-amber-400 border-amber-500/30",
  important: "bg-red-600/20 text-red-400 border-red-500/30",
};

export default function AdminAnuncios() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", type: "info" });
  const [saving, setSaving] = useState(false);

  const loadAnnouncements = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/announcements");
      if (res.ok) {
        const data = await res.json();
        setAnnouncements(data.announcements);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadAnnouncements(); }, [loadAnnouncements]);

  const handleCreate = async () => {
    if (!form.title.trim() || !form.content.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setForm({ title: "", content: "", type: "info" });
      setShowForm(false);
      await loadAnnouncements();
    } catch {}
    setSaving(false);
  };

  const handleToggle = async (id: string, currentActive: number) => {
    try {
      await fetch(`/api/admin/announcements/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: currentActive ? 0 : 1 }),
      });
      await loadAnnouncements();
    } catch {}
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`¿Eliminar "${title}"?`)) return;
    try {
      await fetch(`/api/admin/announcements/${id}`, { method: "DELETE" });
      await loadAnnouncements();
    } catch {}
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Anuncios</h1>
        <div className="flex gap-2">
          <button onClick={loadAnnouncements} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#121824] border border-[#202938] text-xs text-gray-400 hover:text-white transition-colors">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Recargar
          </button>
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-medium transition-colors">
            <Plus size={14} />
            Nuevo anuncio
          </button>
        </div>
      </div>

      {showForm && (
        <div className="rounded-xl bg-[#121824] border border-[#202938] p-5 space-y-4">
          <h3 className="text-sm font-medium text-white">Nuevo anuncio</h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Título del anuncio" className="bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50" />
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-green-500/50">
              <option value="info" className="bg-[#030812]">Info</option>
              <option value="warning" className="bg-[#030812]">Advertencia</option>
              <option value="important" className="bg-[#030812]">Importante</option>
            </select>
            <div className="flex gap-2 justify-end items-center">
              <button onClick={() => setShowForm(false)} className="px-4 py-2.5 rounded-xl text-xs text-gray-400 hover:text-white">Cancelar</button>
              <button onClick={handleCreate} disabled={saving || !form.title.trim() || !form.content.trim()} className="px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-xs font-medium disabled:opacity-50">
                {saving ? "Guardando..." : "Publicar"}
              </button>
            </div>
          </div>
          <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={4} placeholder="Contenido del anuncio..." className="w-full bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50 resize-y" />
        </div>
      )}

      <div className="space-y-3">
        {loading ? (
          <div className="text-center py-12 text-gray-500">Cargando...</div>
        ) : announcements.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Megaphone size={32} className="mx-auto mb-3 opacity-50" />
            No hay anuncios
          </div>
        ) : (
          announcements.map((a) => (
            <div key={a.id} className={`rounded-xl border p-5 transition-colors ${TYPE_STYLES[a.type] || TYPE_STYLES.info} ${!a.active ? "opacity-50" : ""}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Megaphone size={16} />
                    <h3 className="text-sm font-semibold">{a.title}</h3>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-black/20">{a.type}</span>
                    {!a.active && <span className="text-[10px] text-gray-500">(oculto)</span>}
                  </div>
                  <p className="text-sm opacity-80 whitespace-pre-wrap">{a.content}</p>
                  <div className="flex items-center gap-3 mt-2 text-[10px] opacity-60">
                    <span>Por: {a.created_by_name || "—"}</span>
                    <span>{new Date(a.created_at).toLocaleDateString("es-MX")}</span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => handleToggle(a.id, a.active)} className="p-1.5 rounded-lg hover:bg-black/20 transition-colors" title={a.active ? "Ocultar" : "Mostrar"}>
                    {a.active ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button onClick={() => handleDelete(a.id, a.title)} className="p-1.5 rounded-lg hover:bg-black/20 transition-colors" title="Eliminar">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

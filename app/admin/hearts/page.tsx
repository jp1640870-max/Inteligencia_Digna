"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, RefreshCw, Search, Settings, Brain, Globe, User, Star } from "lucide-react";

type Heart = {
  id: string;
  user_id: string;
  name: string;
  role: string;
  tone: string;
  instructions: string;
  limitations: string;
  temperature: number;
  knowledge_files: string;
  tools: string;
  agent_memory: string;
  is_public: number;
  is_preset: number;
  created_at: string;
  updated_at: string;
  user_name: string | null;
  user_email: string | null;
};

const TOOLS_LIST = ["read_files", "generate_docs", "web_search", "analyze_images"];

const TEMPLATES = [
  { name: "Asistente Corporativo", role: "Asistente corporativo", tone: "Formal y profesional", instructions: "Responde consultas generales sobre la empresa, políticas internas, y procedimientos. Mantén un tono profesional y servicial.", temperature: 0.3, tools: [] },
  { name: "Analista de Datos", role: "Analista de datos", tone: "Técnico y preciso", instructions: "Analiza datos, genera reportes y visualizaciones. Proporciona insights accionables basados en la información disponible.", temperature: 0.2, tools: ["read_files", "generate_docs"] },
  { name: "Mentor de Ventas", role: "Mentor de ventas", tone: "Motivacional y práctico", instructions: "Ayuda a mejorar técnicas de venta, manejo de objeciones, y cierre de negocios. Proporciona ejemplos y guiones.", temperature: 0.7, tools: ["read_files"] },
  { name: "Redactor de Contenido", role: "Redactor profesional", tone: "Creativo y versátil", instructions: "Redacta, edita y mejora contenido escrito. Adapta el tono según la audiencia y el propósito del texto.", temperature: 0.8, tools: ["generate_docs"] },
];

export default function AdminHearts() {
  const [hearts, setHearts] = useState<Heart[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreator, setShowCreator] = useState(false);
  const [form, setForm] = useState({ name: "", role: "", tone: "", instructions: "", limitations: "", temperature: 0.7, tools: [] as string[], isPreset: false });
  const [saving, setSaving] = useState(false);

  const loadHearts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/hearts");
      if (res.ok) {
        const data = await res.json();
        setHearts(data.hearts);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadHearts(); }, [loadHearts]);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/admin/hearts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          tools: form.tools,
          isPreset: form.isPreset,
        }),
      });
      setForm({ name: "", role: "", tone: "", instructions: "", limitations: "", temperature: 0.7, tools: [], isPreset: false });
      setShowCreator(false);
      await loadHearts();
    } catch {}
    setSaving(false);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar el Heart "${name}"?`)) return;
    try {
      await fetch(`/api/admin/hearts/${id}`, { method: "DELETE" });
      await loadHearts();
    } catch {}
  };

  const handleTogglePreset = async (heart: Heart) => {
    try {
      await fetch(`/api/admin/hearts/${heart.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_preset: heart.is_preset ? 0 : 1 }),
      });
      await loadHearts();
    } catch {}
  };

  const loadTemplate = (template: typeof TEMPLATES[0]) => {
    setForm({
      name: template.name,
      role: template.role,
      tone: template.tone,
      instructions: template.instructions,
      limitations: "",
      temperature: template.temperature,
      tools: [...template.tools],
      isPreset: true,
    });
  };

  const filtered = hearts.filter(
    (h) =>
      h.name.toLowerCase().includes(search.toLowerCase()) ||
      (h.role && h.role.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* Disclaimer */}
      <div className="rounded-xl bg-amber-600/10 border border-amber-500/30 p-4 text-amber-400 text-sm">
        <p className="font-medium text-xs">⚙️ Hearts: Gestión de panel completada</p>
        <p className="text-xs opacity-80 mt-1">
          Puedes crear, editar y desactivar Hearts desde aquí. La integración con el chat
          (seleccionar Heart al conversar, inyección de personalidad en el prompt) estará
          disponible en una próxima actualización del sistema.
        </p>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Hearts</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={loadHearts}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#121824] border border-[#202938] text-xs text-gray-400 hover:text-white transition-colors"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Recargar
          </button>
          <button
            onClick={() => setShowCreator(!showCreator)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-medium transition-colors"
          >
            <Plus size={14} />
            Nuevo Heart
          </button>
        </div>
      </div>

      {/* Creator */}
      {showCreator && (
        <div className="rounded-xl bg-[#121824] border border-[#202938] p-5 space-y-4">
          <h3 className="text-sm font-medium text-white">Crear nuevo Heart</h3>

          {/* Templates */}
          <div>
            <p className="text-[11px] text-gray-500 mb-2">Plantillas precargadas:</p>
            <div className="flex flex-wrap gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  onClick={() => loadTemplate(t)}
                  className="px-3 py-1.5 rounded-lg bg-[#030812] border border-[#202938] text-xs text-gray-400 hover:text-white hover:border-green-500/30 transition-colors"
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-[11px] text-gray-500 block mb-1">Nombre *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nombre del Heart" className="w-full bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50" />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-1">Rol</label>
              <input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Ej: Analista, Mentor, Coach..." className="w-full bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50" />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-1">Tono</label>
              <input value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} placeholder="Ej: Formal, Casual, Técnico..." className="w-full bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50" />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] text-gray-500 block mb-1">Instrucciones</label>
              <textarea value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} rows={3} className="w-full bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50 resize-y" />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-1">Limitaciones</label>
              <textarea value={form.limitations} onChange={(e) => setForm({ ...form, limitations: e.target.value })} rows={3} className="w-full bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50 resize-y" />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-end">
            <div>
              <label className="text-[11px] text-gray-500 block mb-1">Temperatura: {form.temperature}</label>
              <input type="range" min="0" max="2" step="0.1" value={form.temperature} onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) })} className="w-full accent-green-500" />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-1">Herramientas</label>
              <div className="flex flex-wrap gap-2">
                {TOOLS_LIST.map((t) => (
                  <label key={t} className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                    <input type="checkbox" checked={form.tools.includes(t)} onChange={() => setForm({ ...form, tools: form.tools.includes(t) ? form.tools.filter((x) => x !== t) : [...form.tools, t] })} className="accent-green-500" />
                    {t.replace(/_/g, " ")}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3 justify-end">
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                <input type="checkbox" checked={form.isPreset} onChange={(e) => setForm({ ...form, isPreset: e.target.checked })} className="accent-green-500" />
                Heart precargado (empresa)
              </label>
              <button onClick={() => setShowCreator(false)} className="px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white">Cancelar</button>
              <button onClick={handleCreate} disabled={saving || !form.name.trim()} className="px-4 py-2 rounded-xl bg-green-600 hover:bg-green-500 text-white text-xs font-medium disabled:opacity-50">Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar hearts por nombre o rol..." className="w-full bg-[#121824] border border-[#202938] rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50" />
      </div>

      {/* Hearts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full text-center py-12 text-gray-500">
            <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
            Cargando hearts...
          </div>
        ) : filtered.length === 0 ? (
          <div className="col-span-full text-center py-12 text-gray-500">
            <Brain size={32} className="mx-auto mb-3 opacity-50" />
            {search ? "Sin resultados" : "No hay hearts creados"}
          </div>
        ) : (
          filtered.map((heart) => (
            <div key={heart.id} className="rounded-xl bg-[#121824] border border-[#202938] p-5 hover:border-green-500/20 transition-colors group">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
                    <Brain size={20} className="text-white" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-white">{heart.name}</h3>
                    {heart.role && <p className="text-[11px] text-gray-500">{heart.role}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleTogglePreset(heart)} className={`p-1.5 rounded-lg transition-colors ${heart.is_preset ? "text-amber-400 hover:bg-amber-500/10" : "text-gray-500 hover:text-amber-400 hover:bg-amber-500/10"}`} title={heart.is_preset ? "Quitar preset" : "Marcar como preset"}>
                    <Star size={14} fill={heart.is_preset ? "currentColor" : "none"} />
                  </button>
                  <button onClick={() => handleDelete(heart.id, heart.name)} className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Eliminar">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="space-y-2 text-xs text-gray-400">
                <div className="flex items-center gap-2">
                  <Settings size={12} />
                  <span>Temp: {heart.temperature}</span>
                  {heart.tone && <span>· Tono: {heart.tone}</span>}
                </div>
                {heart.instructions && (
                  <p className="text-gray-500 line-clamp-2">{heart.instructions}</p>
                )}
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  {heart.is_preset > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-600/20 text-amber-400 text-[10px]">Preset</span>}
                  {heart.is_public > 0 && <span className="px-2 py-0.5 rounded-full bg-blue-600/20 text-blue-400 text-[10px]">Público</span>}
                  {(JSON.parse(heart.tools || "[]") as string[]).map((t) => (
                    <span key={t} className="px-2 py-0.5 rounded-full bg-green-600/20 text-green-400 text-[10px]">{t.replace(/_/g, " ")}</span>
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-1 text-[10px] text-gray-600">
                  <User size={10} />
                  <span>{heart.user_name || heart.user_email || "—"}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <p className="text-[11px] text-gray-600">Total: {hearts.length} heart{hearts.length !== 1 ? "s" : ""}{search && ` (${filtered.length} filtrados)`}</p>
    </div>
  );
}

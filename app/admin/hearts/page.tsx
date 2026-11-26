"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Brain,
  LifeBuoy,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Star,
  Trash2,
  User,
} from "lucide-react";

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
  is_featured: number;
  scope: "personal" | "company";
  agent_key: string | null;
  created_at: string;
  updated_at: string;
  user_name: string | null;
  user_email: string | null;
};

type TabType = "company" | "user";

type HeartForm = {
  name: string;
  role: string;
  tone: string;
  instructions: string;
  limitations: string;
  temperature: number;
  tools: string[];
  isFeatured: boolean;
};

const TOOLS_LIST = ["read_files", "generate_docs", "web_search", "analyze_images"];

const TOOL_LABELS: Record<string, string> = {
  read_files: "Leer archivos",
  generate_docs: "Generar documentos",
  web_search: "Buscar en la web",
  analyze_images: "Analizar imágenes",
};

const EMPTY_FORM: HeartForm = {
  name: "",
  role: "",
  tone: "",
  instructions: "",
  limitations: "",
  temperature: 0.7,
  tools: [],
  isFeatured: false,
};

const TEMPLATES = [
  { name: "Asistente Corporativo", role: "Asistente corporativo", tone: "Formal y profesional", instructions: "Responde consultas generales sobre la empresa, políticas internas, y procedimientos. Mantén un tono profesional y servicial.", temperature: 0.3, tools: [] },
  { name: "Analista de Datos", role: "Analista de datos", tone: "Técnico y preciso", instructions: "Analiza datos, genera reportes y visualizaciones. Proporciona insights accionables basados en la información disponible.", temperature: 0.2, tools: ["read_files", "generate_docs"] },
  { name: "Mentor de Ventas", role: "Mentor de ventas", tone: "Motivacional y práctico", instructions: "Ayuda a mejorar técnicas de venta, manejo de objeciones, y cierre de negocios. Proporciona ejemplos y guiones.", temperature: 0.7, tools: ["read_files"] },
  { name: "Redactor de Contenido", role: "Redactor profesional", tone: "Creativo y versátil", instructions: "Redacta, edita y mejora contenido escrito. Adapta el tono según la audiencia y el propósito del texto.", temperature: 0.8, tools: ["generate_docs"] },
];

function parseTools(value: string): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function formFromHeart(heart: Heart): HeartForm {
  return {
    name: heart.name,
    role: heart.role,
    tone: heart.tone,
    instructions: heart.instructions,
    limitations: heart.limitations,
    temperature: heart.temperature,
    tools: parseTools(heart.tools),
    isFeatured: Boolean(heart.is_featured),
  };
}

export default function AdminHearts() {
  const [hearts, setHearts] = useState<Heart[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreator, setShowCreator] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<HeartForm>({ ...EMPTY_FORM, tools: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("company");

  const loadHearts = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === "company") {
        const res = await fetch("/api/admin/hearts");
        if (res.ok) {
          const data = await res.json();
          setHearts(Array.isArray(data.hearts) ? data.hearts : []);
          setError(null);
        } else {
          const errorData = await res.json().catch(() => ({ error: "Error al cargar Hearts de empresa" }));
          setError(errorData.error || "Error desconocido");
          setHearts([]);
        }
      } else {
        const res = await fetch("/api/admin/hearts/user");
        if (res.ok) {
          const data = await res.json();
          setHearts(Array.isArray(data.hearts) ? data.hearts : []);
          setError(null);
        } else {
          const errorData = await res.json().catch(() => ({ error: "Error al cargar Hearts de usuarios" }));
          setError(errorData.error || "Error desconocido");
          setHearts([]);
        }
      }
    } catch {
      setError("Error al cargar los Hearts");
      setHearts([]);
    }
    setLoading(false);
  }, [activeTab]);

  // Fetch inicial diferido a una macrotarea: evita setState síncrono dentro
  // del efecto (react-hooks/set-state-in-effect) sin cambiar comportamiento.
  useEffect(() => {
    const id = setTimeout(() => { void loadHearts(); }, 0);
    return () => clearTimeout(id);
  }, [loadHearts]);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setSearch("");
    setShowCreator(false);
    setEditingId(null);
    setError(null);
  };

  const editingHeart = editingId
    ? hearts.find((heart) => heart.id === editingId) || null
    : null;
  const editingOfficial = Boolean(editingHeart?.agent_key);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, tools: [] });
    setError(null);
    setShowCreator(true);
  };

  const openEdit = (heart: Heart) => {
    setEditingId(heart.id);
    setForm(formFromHeart(heart));
    setError(null);
    setShowCreator(true);
  };

  const closeCreator = () => {
    if (saving) return;
    setShowCreator(false);
    setEditingId(null);
    setError(null);
  };

  const handleSave = async () => {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        editingId ? `/api/admin/hearts/${editingId}` : "/api/admin/hearts",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "No se pudo guardar el Heart.");
        return;
      }
      setShowCreator(false);
      setEditingId(null);
      setForm({ ...EMPTY_FORM, tools: [] });
      await loadHearts();
    } catch {
      setError("No se pudo guardar el Heart.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (heart: Heart) => {
    if (heart.agent_key) {
      setError("El agente oficial no se puede eliminar.");
      return;
    }
    const kind = heart.scope === "company" ? "Heart de empresa" : "Heart de usuario";
    if (!confirm(`¿Eliminar el ${kind} "${heart.name}"?`)) return;
    try {
      const res = await fetch(`/api/admin/hearts/${heart.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "No se pudo eliminar el Heart.");
        return;
      }
      await loadHearts();
    } catch {
      setError("No se pudo eliminar el Heart.");
    }
  };

  const handleToggleFeatured = async (heart: Heart) => {
    try {
      const res = await fetch(`/api/admin/hearts/${heart.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_featured: heart.is_featured ? 0 : 1 }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "No se pudo cambiar el fijado.");
        return;
      }
      await loadHearts();
    } catch {
      setError("No se pudo cambiar el fijado.");
    }
  };

  const loadTemplate = (template: (typeof TEMPLATES)[number]) => {
    setForm({
      name: template.name,
      role: template.role,
      tone: template.tone,
      instructions: template.instructions,
      limitations: "",
      temperature: template.temperature,
      tools: [...template.tools],
      isFeatured: false,
    });
  };

  const filtered = hearts.filter(
    (h) =>
      h.name.toLowerCase().includes(search.toLowerCase()) ||
      (h.role && h.role.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-amber-600/10 border border-amber-500/30 p-4 text-amber-400 text-sm">
        <p className="font-medium text-xs">Hearts de empresa y usuarios</p>
        <p className="text-xs opacity-80 mt-1">
          Solo el panel de administración crea y edita Hearts de empresa. En la
          vista Hearts, los usuarios pueden conversar, fijarlos en su panel y
          duplicarlos como Hearts personales. Desde este panel también puedes
          revisar, editar y eliminar los Hearts personales creados por los
          usuarios. El agente oficial de Soporte Técnico está vinculado a su
          Heart y no se puede eliminar.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-1 border border-[#202938] rounded-lg p-1 bg-[#121824]">
          <button
            onClick={() => handleTabChange("company")}
            className={`px-4 py-2 text-sm rounded-md transition-colors ${
              activeTab === "company"
                ? "bg-[#0b1625] text-white shadow-inner"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Hearts de Empresa
          </button>
          <button
            onClick={() => handleTabChange("user")}
            className={`px-4 py-2 text-sm rounded-md transition-colors ${
              activeTab === "user"
                ? "bg-[#0b1625] text-white shadow-inner"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Hearts de Usuarios
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadHearts()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#121824] border border-[#202938] text-xs text-gray-400 hover:text-white transition-colors"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Recargar
          </button>
          {activeTab === "company" && (
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-medium transition-colors"
            >
              <Plus size={14} />
              Nuevo Heart de empresa
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
          {error}
        </div>
      )}

      {showCreator && (
        <div className="rounded-xl bg-[#121824] border border-[#202938] p-5 space-y-4">
          <h3 className="text-sm font-medium text-white">
            {editingId
              ? activeTab === "company"
                ? "Editar Heart de empresa"
                : "Editar Heart de usuario"
              : activeTab === "company"
                ? "Crear Heart de empresa"
                : "Crear Heart de usuario"}
          </h3>

          {editingOfficial && (
            <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-300">
              El comportamiento del agente oficial de Soporte se define en el
              backend. Aquí solo puedes ajustar su presentación y si aparece
              fijado.
            </p>
          )}

          {editingId && activeTab === "user" && (
            <p className="rounded-lg border border-blue-500/25 bg-blue-500/10 px-3 py-2 text-[11px] text-blue-300">
              Estás editando un Heart personal. Los cambios se aplican al Heart
              del usuario, pero no cambian su propietario ni lo convierten en
              Heart de empresa.
            </p>
          )}

          {!editingId && activeTab === "company" && (
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
          )}

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
              <textarea value={form.instructions} disabled={editingOfficial} onChange={(e) => setForm({ ...form, instructions: e.target.value })} rows={3} className="w-full bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50 resize-y disabled:opacity-50" />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-1">Limitaciones</label>
              <textarea value={form.limitations} disabled={editingOfficial} onChange={(e) => setForm({ ...form, limitations: e.target.value })} rows={3} className="w-full bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50 resize-y disabled:opacity-50" />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-end">
            <div>
              <label className="text-[11px] text-gray-500 block mb-1">Temperatura: {form.temperature}</label>
              <input type="range" min="0" max="2" step="0.1" value={form.temperature} disabled={editingOfficial} onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) })} className="w-full accent-green-500 disabled:opacity-50" />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-1">Herramientas</label>
              <div className="flex flex-wrap gap-2">
                {TOOLS_LIST.map((t) => (
                  <label key={t} className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                    <input type="checkbox" checked={form.tools.includes(t)} disabled={editingOfficial} onChange={() => setForm({ ...form, tools: form.tools.includes(t) ? form.tools.filter((x) => x !== t) : [...form.tools, t] })} className="accent-green-500" />
                    {TOOL_LABELS[t] || t.replace(/_/g, " ")}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 justify-end">
              {activeTab === "company" && (
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={form.isFeatured} onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })} className="accent-green-500" />
                  Fijar en Hearts de todos
                </label>
              )}
              <button onClick={closeCreator} className="px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white">Cancelar</button>
              <button onClick={handleSave} disabled={saving || !form.name.trim()} className="px-4 py-2 rounded-xl bg-green-600 hover:bg-green-500 text-white text-xs font-medium disabled:opacity-50">
                {saving ? "Guardando..." : editingId ? "Guardar cambios" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar hearts por nombre o rol..." className="w-full bg-[#121824] border border-[#202938] rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full text-center py-12 text-gray-500">
            <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
            Cargando hearts...
          </div>
        ) : filtered.length === 0 ? (
          <div className="col-span-full text-center py-12 text-gray-500">
            <Brain size={32} className="mx-auto mb-3 opacity-50" />
            {search ? "Sin resultados" : activeTab === "company" ? "No hay hearts de empresa creados" : "No hay hearts de usuarios creados"}
          </div>
        ) : (
          filtered.map((heart) => {
            const official = Boolean(heart.agent_key);
            const toolLabels = official
              ? ["Base de conocimiento", "Archivos de conversación", "Escalamiento"]
              : parseTools(heart.tools).map((tool) => TOOL_LABELS[tool] || tool.replace(/_/g, " "));

            return (
              <div key={heart.id} className="rounded-xl bg-[#121824] border border-[#202938] p-5 hover:border-green-500/20 transition-colors group">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
                      {official ? <LifeBuoy size={20} className="text-white" /> : <Brain size={20} className="text-white" />}
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-white">{heart.name}</h3>
                      {heart.role && <p className="text-[11px] text-gray-500">{heart.role}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(heart)} className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors" title="Editar">
                      <Pencil size={14} />
                    </button>
                    {heart.scope === "company" && (
                      <button onClick={() => handleToggleFeatured(heart)} className={`p-1.5 rounded-lg transition-colors ${heart.is_featured ? "text-amber-400 hover:bg-amber-500/10" : "text-gray-500 hover:text-amber-400 hover:bg-amber-500/10"}`} title={heart.is_featured ? "Quitar fijado global" : "Fijar en Hearts de todos"}>
                        <Star size={14} fill={heart.is_featured ? "currentColor" : "none"} />
                      </button>
                    )}
                    <button onClick={() => handleDelete(heart)} disabled={official} className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30 disabled:hover:text-gray-500" title={official ? "El agente oficial no se puede eliminar" : "Eliminar"}>
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
                    <span className="px-2 py-0.5 rounded-full bg-blue-600/20 text-blue-400 text-[10px]">
                      {heart.scope === "company" ? "Empresa" : "Usuario"}
                    </span>
                    {official && <span className="px-2 py-0.5 rounded-full bg-emerald-600/20 text-emerald-400 text-[10px]">Oficial</span>}
                    {heart.is_featured > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-600/20 text-amber-400 text-[10px]">Fijado</span>}
                    {toolLabels.map((label) => (
                      <span key={label} className="px-2 py-0.5 rounded-full bg-green-600/20 text-green-400 text-[10px]">{label}</span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 pt-1 text-[10px] text-gray-600">
                    <User size={10} />
                    <span>{heart.user_name || heart.user_email || "—"}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="text-[11px] text-gray-600">Total: {hearts.length} heart{hearts.length !== 1 ? "s" : ""}{search && ` (${filtered.length} filtrados)`}</p>
    </div>
  );
}

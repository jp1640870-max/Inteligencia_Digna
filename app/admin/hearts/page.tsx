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
import { HEART_TOOLS, HEART_TOOL_LABELS } from "@/lib/heart-config";
import { HEART_STATUSES, type HeartStatus } from "@/lib/heart-definition";

type Heart = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  role: string;
  tone: string;
  instructions: string;
  limitations: string;
  temperature: number;
  model: string | null;
  status: HeartStatus;
  version: number;
  published_at: string | null;
  tools: string[];
  knowledge_files: string[];
  scope: "personal" | "company";
  agent_key: string | null;
  is_featured: boolean;
  created_at: string;
  updated_at: string;
  user_name: string | null;
  user_email: string | null;
};

type TabType = "company" | "user";

type HeartForm = {
  name: string;
  description: string;
  role: string;
  tone: string;
  instructions: string;
  limitations: string;
  temperature: number;
  model: string;
  tools: string[];
  isFeatured: boolean;
  initialStatus: "draft" | "published";
};

type HeartVersionItem = {
  version: number;
  createdAt: string;
  authorId: string;
  changeSummary: string;
  snapshot: { identity?: { description?: string } };
};

const STATUS_LABELS: Record<HeartStatus, string> = {
  draft: "Borrador",
  published: "Publicado",
  paused: "Pausado",
  revoked: "Revocado",
  archived: "Archivado",
};

const STATUS_STYLES: Record<HeartStatus, string> = {
  draft: "bg-gray-600/20 text-gray-300",
  published: "bg-green-600/20 text-green-400",
  paused: "bg-amber-600/20 text-amber-400",
  revoked: "bg-red-600/20 text-red-400",
  archived: "bg-gray-700/20 text-gray-500",
};

const EMPTY_FORM: HeartForm = {
  name: "",
  description: "",
  role: "",
  tone: "",
  instructions: "",
  limitations: "",
  temperature: 0.7,
  model: "",
  tools: [],
  isFeatured: false,
  initialStatus: "draft",
};

const TEMPLATES = [
  { name: "Asistente Corporativo", role: "Asistente corporativo", tone: "Formal y profesional", description: "Responde consultas generales sobre políticas y procedimientos internos.", instructions: "Responde consultas generales sobre la empresa, políticas internas, y procedimientos. Mantén un tono profesional y servicial.", temperature: 0.3, tools: [] as string[] },
  { name: "Analista de Datos", role: "Analista de datos", tone: "Técnico y preciso", description: "Analiza datos internos y genera reportes accionables.", instructions: "Analiza datos, genera reportes y visualizaciones. Proporciona insights accionables basados en la información disponible.", temperature: 0.2, tools: ["read_files", "generate_docs"] },
  { name: "Mentor de Ventas", role: "Mentor de ventas", tone: "Motivacional y práctico", description: "Ayuda a mejorar técnicas de venta y cierre de negocios.", instructions: "Ayuda a mejorar técnicas de venta, manejo de objeciones, y cierre de negocios. Proporciona ejemplos y guiones.", temperature: 0.7, tools: ["read_files"] },
  { name: "Redactor de Contenido", role: "Redactor profesional", tone: "Creativo y versátil", description: "Redacta, edita y mejora contenido escrito.", instructions: "Redacta, edita y mejora contenido escrito. Adapta el tono según la audiencia y el propósito del texto.", temperature: 0.8, tools: ["generate_docs"] },
];

function formFromHeart(heart: Heart): HeartForm {
  return {
    name: heart.name,
    description: heart.description,
    role: heart.role,
    tone: heart.tone,
    instructions: heart.instructions,
    limitations: heart.limitations,
    temperature: heart.temperature,
    model: heart.model ?? "",
    tools: [...heart.tools],
    isFeatured: heart.is_featured,
    initialStatus: heart.status === "draft" ? "draft" : "published",
  };
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function AdminHearts() {
  const [hearts, setHearts] = useState<Heart[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | HeartStatus>("all");
  const [showCreator, setShowCreator] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<HeartForm>({ ...EMPTY_FORM, tools: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("company");
  const [versionsFor, setVersionsFor] = useState<string | null>(null);
  const [versions, setVersions] = useState<HeartVersionItem[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);

  const loadHearts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("scope", activeTab === "company" ? "company" : "personal");
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search.trim()) params.set("q", search.trim());
      const res = await fetch(`/api/admin/hearts?${params.toString()}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "Error al cargar los Hearts");
        setHearts([]);
      } else {
        const data = (await res.json()) as { hearts: Heart[] };
        setHearts(Array.isArray(data.hearts) ? data.hearts : []);
        setError(null);
      }
    } catch {
      setError("Error al cargar los Hearts");
      setHearts([]);
    }
    setLoading(false);
  }, [activeTab, statusFilter, search]);

  // Fetch inicial diferido a una macrotarea: evita setState síncrono dentro
  // del efecto (react-hooks/set-state-in-effect) sin cambiar comportamiento.
  useEffect(() => {
    const id = setTimeout(() => { void loadHearts(); }, 0);
    return () => clearTimeout(id);
  }, [loadHearts]);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setSearch("");
    setStatusFilter("all");
    setShowCreator(false);
    setEditingId(null);
    setError(null);
    setVersionsFor(null);
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
      const payload = {
        ...form,
        model: form.model.trim() || null,
        status: editingId ? undefined : form.initialStatus,
      };
      const res = await fetch(
        editingId ? `/api/admin/hearts/${editingId}` : "/api/admin/hearts",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
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
      const res = await fetch(`/api/admin/hearts/${heart.id}`, { method: "DELETE" });
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
        body: JSON.stringify({ is_featured: !heart.is_featured }),
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

  const handleStatus = async (
    heart: Heart,
    action: "publish" | "pause" | "revoke" | "archive" | "reactivate",
  ) => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/hearts/${heart.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          changeSummary: action === "publish" ? "Publicado desde el panel de Hearts" : "",
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "No se pudo cambiar el estado.");
        return;
      }
      await loadHearts();
    } catch {
      setError("No se pudo cambiar el estado.");
    }
  };

  const handleVersions = async (heart: Heart) => {
    if (versionsFor === heart.id) {
      setVersionsFor(null);
      return;
    }
    setVersionsFor(heart.id);
    setVersions([]);
    setLoadingVersions(true);
    try {
      const res = await fetch(`/api/admin/hearts/${heart.id}/versions`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "No se pudieron leer las versiones.");
        return;
      }
      const data = (await res.json()) as { versions: HeartVersionItem[] };
      setVersions(Array.isArray(data.versions) ? data.versions : []);
    } catch {
      setError("No se pudieron leer las versiones.");
    } finally {
      setLoadingVersions(false);
    }
  };

  const loadTemplate = (template: (typeof TEMPLATES)[number]) => {
    setForm({
      name: template.name,
      role: template.role,
      tone: template.tone,
      description: template.description,
      instructions: template.instructions,
      limitations: "",
      temperature: template.temperature,
      model: "",
      tools: [...template.tools],
      isFeatured: false,
      initialStatus: form.initialStatus,
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-amber-600/10 border border-amber-500/30 p-4 text-amber-400 text-sm">
        <p className="font-medium text-xs">Definiciones, estados y versiones</p>
        <p className="text-xs opacity-80 mt-1">
          Los Hearts son definiciones validadas y versionadas. El estado se
          administra desde cada tarjeta; publicar crea un snapshot inmutable.
          El agente oficial de Soporte mantiene su comportamiento en el backend y
          no cambia de estado ni se elimina desde este panel.
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
              Estás editando un Heart personal. Los cambios no modifican su
              propietario ni lo convierten en Heart de empresa.
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] text-gray-500 block mb-1">Nombre *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nombre del Heart" className="w-full bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50" />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-1">Descripción</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Para qué sirve este Heart" className="w-full bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50" />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-[11px] text-gray-500 block mb-1">Rol</label>
              <input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Ej: Analista, Mentor, Coach..." className="w-full bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50" />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-1">Tono</label>
              <input value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} placeholder="Ej: Formal, Casual, Técnico..." className="w-full bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50" />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-1">Modelo local (vacío = actual del chat)</label>
              <input value={form.model} disabled={editingOfficial} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="Ej: llama3.1" className="w-full bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50 disabled:opacity-50" />
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

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-end">
            <div>
              <label className="text-[11px] text-gray-500 block mb-1">Temperatura: {form.temperature}</label>
              <input type="range" min="0" max="2" step="0.1" value={form.temperature} disabled={editingOfficial} onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) })} className="w-full accent-green-500 disabled:opacity-50" />
            </div>
            <div className="lg:col-span-2">
              <label className="text-[11px] text-gray-500 block mb-1">Herramientas</label>
              <div className="flex flex-wrap gap-2">
                {HEART_TOOLS.map((t) => (
                  <label key={t} className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                    <input type="checkbox" checked={form.tools.includes(t)} disabled={editingOfficial} onChange={() => setForm({ ...form, tools: form.tools.includes(t) ? form.tools.filter((x) => x !== t) : [...form.tools, t] })} className="accent-green-500" />
                    {HEART_TOOL_LABELS[t]}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-1">Estado inicial</label>
              <select
                value={form.initialStatus}
                disabled={Boolean(editingId)}
                onChange={(e) => setForm({ ...form, initialStatus: e.target.value as "draft" | "published" })}
                className="w-full bg-[#030812] border border-[#202938] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-green-500/50 disabled:opacity-50"
              >
                <option value="draft">Borrador</option>
                <option value="published">Publicado</option>
              </select>
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
            <button onClick={() => void handleSave()} disabled={saving || !form.name.trim()} className="px-4 py-2 rounded-xl bg-green-600 hover:bg-green-500 text-white text-xs font-medium disabled:opacity-50">
              {saving ? "Guardando..." : editingId ? "Guardar cambios" : "Guardar"}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar hearts por nombre, descripción o rol..." className="w-full bg-[#121824] border border-[#202938] rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50" />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | HeartStatus)}
          className="bg-[#121824] border border-[#202938] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-green-500/50"
        >
          <option value="all">Todos los estados</option>
          {HEART_STATUSES.map((status) => (
            <option key={status} value={status}>{STATUS_LABELS[status]}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full text-center py-12 text-gray-500">
            <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
            Cargando hearts...
          </div>
        ) : hearts.length === 0 ? (
          <div className="col-span-full text-center py-12 text-gray-500">
            <Brain size={32} className="mx-auto mb-3 opacity-50" />
            No hay hearts para este filtro
          </div>
        ) : (
          hearts.map((heart) => {
            const official = Boolean(heart.agent_key);
            const toolLabels = official
              ? ["Base de conocimiento", "Archivos de conversación", "Escalamiento"]
              : heart.tools.map((tool) => HEART_TOOL_LABELS[tool as keyof typeof HEART_TOOL_LABELS] || tool.replace(/_/g, " "));
            const canPublish = !official && (heart.status === "draft" || heart.status === "paused" || heart.status === "published");

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
                      <button onClick={() => void handleToggleFeatured(heart)} className={`p-1.5 rounded-lg transition-colors ${heart.is_featured ? "text-amber-400 hover:bg-amber-500/10" : "text-gray-500 hover:text-amber-400 hover:bg-amber-500/10"}`} title={heart.is_featured ? "Quitar fijado global" : "Fijar en Hearts de todos"}>
                        <Star size={14} fill={heart.is_featured ? "currentColor" : "none"} />
                      </button>
                    )}
                    <button onClick={() => void handleDelete(heart)} disabled={official} className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30 disabled:hover:text-gray-500" title={official ? "El agente oficial no se puede eliminar" : "Eliminar"}>
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
                  {heart.description && <p className="text-gray-500 line-clamp-2">{heart.description}</p>}
                  {heart.instructions && (
                    <p className="text-gray-500 line-clamp-2">{heart.instructions}</p>
                  )}
                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] ${STATUS_STYLES[heart.status]}`}>
                      {STATUS_LABELS[heart.status]}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-indigo-600/20 text-indigo-400 text-[10px]">v{heart.version}</span>
                    <span className="px-2 py-0.5 rounded-full bg-blue-600/20 text-blue-400 text-[10px]">
                      {heart.scope === "company" ? "Empresa" : "Usuario"}
                    </span>
                    {official && <span className="px-2 py-0.5 rounded-full bg-emerald-600/20 text-emerald-400 text-[10px]">Oficial</span>}
                    {heart.is_featured && <span className="px-2 py-0.5 rounded-full bg-amber-600/20 text-amber-400 text-[10px]">Fijado</span>}
                    {toolLabels.map((label) => (
                      <span key={label} className="px-2 py-0.5 rounded-full bg-green-600/20 text-green-400 text-[10px]">{label}</span>
                    ))}
                  </div>
                  <div className="text-[10px] text-gray-600">
                    Publicado: {formatDate(heart.published_at)}
                    {heart.model ? ` · Modelo: ${heart.model}` : " · Modelo del chat"}
                  </div>
                  <div className="flex items-center gap-2 pt-1 text-[10px] text-gray-600">
                    <User size={10} />
                    <span>{heart.user_name || heart.user_email || "—"}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-3 mt-3 border-t border-[#202938]">
                  <button onClick={() => void handleVersions(heart)} className="px-2 py-1 rounded-lg bg-[#030812] border border-[#202938] text-[10px] text-gray-400 hover:text-white transition-colors">
                    Historial v{heart.version}
                  </button>
                  {canPublish && (
                    <button onClick={() => void handleStatus(heart, "publish")} className="px-2 py-1 rounded-lg bg-green-600/15 text-green-400 text-[10px] hover:bg-green-600/25 transition-colors">
                      {heart.status === "published" ? "Nueva versión" : "Publicar"}
                    </button>
                  )}
                  {heart.status === "published" && !official && (
                    <button onClick={() => void handleStatus(heart, "pause")} className="px-2 py-1 rounded-lg bg-amber-600/15 text-amber-400 text-[10px] hover:bg-amber-600/25 transition-colors">
                      Pausar
                    </button>
                  )}
                  {(heart.status === "published" || heart.status === "paused") && !official && (
                    <button onClick={() => void handleStatus(heart, "revoke")} className="px-2 py-1 rounded-lg bg-red-600/15 text-red-400 text-[10px] hover:bg-red-600/25 transition-colors">
                      Revocar
                    </button>
                  )}
                  {heart.status !== "archived" && !official && (
                    <button onClick={() => void handleStatus(heart, "archive")} className="px-2 py-1 rounded-lg bg-gray-600/15 text-gray-400 text-[10px] hover:bg-gray-600/25 transition-colors">
                      Archivar
                    </button>
                  )}
                  {heart.status === "archived" && !official && (
                    <button onClick={() => void handleStatus(heart, "reactivate")} className="px-2 py-1 rounded-lg bg-blue-600/15 text-blue-400 text-[10px] hover:bg-blue-600/25 transition-colors">
                      Reactivar
                    </button>
                  )}
                </div>

                {versionsFor === heart.id && (
                  <div className="mt-3 rounded-lg bg-[#030812] border border-[#202938] p-3 space-y-2">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide">Historial de versiones</p>
                    {loadingVersions ? (
                      <p className="text-[11px] text-gray-500">Cargando...</p>
                    ) : versions.length === 0 ? (
                      <p className="text-[11px] text-gray-500">Sin snapshots. Los Hearts anteriores a la migración se tratan como v1.</p>
                    ) : (
                      versions.map((version) => (
                        <div key={version.version} className="text-[10px] text-gray-400 border-b border-[#202938] last:border-0 pb-2 last:pb-0">
                          <span className="text-white font-medium">v{version.version}</span>
                          {" · "}{formatDate(version.createdAt)}
                          {version.changeSummary ? ` · ${version.changeSummary}` : ""}
                          {version.snapshot?.identity?.description ? (
                            <p className="text-gray-500 mt-0.5">{version.snapshot.identity.description}</p>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <p className="text-[11px] text-gray-600">
        Total: {hearts.length} heart{hearts.length !== 1 ? "s" : ""}
        {search && ` (búsqueda: ${search})`}
      </p>
    </div>
  );
}

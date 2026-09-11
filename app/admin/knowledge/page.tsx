"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Plus,
  Trash2,
  RefreshCw,
  Search,
  BookOpen,
  FileText,
  FolderOpen,
  UploadCloud,
  AlertTriangle,
  CheckCircle2,
  Copy,
  ListRestart,
  X,
} from "lucide-react";

// ─── Tipos ───
type KbFile = {
  id: string;
  filename: string;
  format: string;
  size_bytes: number;
  category_id: string | null;
  category_name: string | null;
  category_label: string | null;
  status: "active" | "hold" | "processing";
  conflict_with: string | null;
  conflict_with_filename: string | null;
  uploader_name: string | null;
  created_at: string;
  updated_at: string;
  chunk_count: number;
};

type KbCategory = {
  id: string;
  name: string;
  label: string;
  file_count: number;
  active_count: number;
};

type UploadResult = {
  name: string;
  status: "active" | "hold" | "duplicate" | "invalid" | "error";
  message: string;
  fileId?: string;
};

type Tab = "archivos" | "entradas" | "categorias";

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active: { label: "Activo", cls: "bg-green-600/20 text-green-400 border-green-500/30" },
  hold: { label: "En revisión", cls: "bg-amber-600/20 text-amber-400 border-amber-500/30" },
  processing: { label: "Procesando", cls: "bg-blue-600/20 text-blue-400 border-blue-500/30" },
};

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AdminKnowledge() {
  const [tab, setTab] = useState<Tab>("archivos");

  // Archivos
  const [files, setFiles] = useState<KbFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Categorías
  const [categories, setCategories] = useState<KbCategory[]>([]);

  // Upload
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);
  const [uploadCategory, setUploadCategory] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Entrada manual
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", category: "" });
  const [saving, setSaving] = useState(false);

  // Nueva categoría
  const [newCatLabel, setNewCatLabel] = useState("");

  // Modal de conflicto
  const [conflictFile, setConflictFile] = useState<KbFile | null>(null);
  const [conflictBusy, setConflictBusy] = useState(false);

  const loadCategories = useCallback(() => {
    fetch("/api/admin/knowledge/categories")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((data) => setCategories(data.categories || []))
      .catch(() => {});
  }, []);

  const loadFiles = useCallback(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (search) params.set("search", search);
    const qs = params.toString();
    fetch(`/api/admin/knowledge/files${qs ? `?${qs}` : ""}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((data) => setFiles(data.files || []))
      .catch(() => {})
      .finally(() => setLoadingFiles(false));
  }, [search, statusFilter]);

  useEffect(() => {
    loadFiles();
    loadCategories();
  }, [loadFiles, loadCategories]);

  // categoría por defecto para upload (general)
  const defaultUploadCategory = categories.find((c) => c.name === "general")?.id || "";

  // ─── Acciones ───
  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setUploadResults([]);
    try {
      const formData = new FormData();
      Array.from(fileList).forEach((f) => formData.append("files", f));
      if (uploadCategory) formData.append("categoryId", uploadCategory);

      const res = await fetch("/api/admin/knowledge/files", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setUploadResults(data.results || []);
        await loadFiles();
        await loadCategories();
      } else {
        const err = await res.json().catch(() => ({}));
        setUploadResults([{ name: "*", status: "error", message: err.error || "Error al subir" }]);
      }
    } catch {
      setUploadResults([{ name: "*", status: "error", message: "Error de conexión al subir" }]);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (file: KbFile) => {
    if (!confirm(`¿Eliminar "${file.filename}"? Se quitará de la base de conocimiento.`)) return;
    try {
      const res = await fetch(`/api/admin/knowledge/files/${file.id}`, { method: "DELETE" });
      if (res.ok) {
        await loadFiles();
        await loadCategories();
      }
    } catch {}
  };

  const handleReindex = async (file: KbFile) => {
    try {
      const res = await fetch(`/api/admin/knowledge/files/${file.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reindex" }),
      });
      const data = await res.json().catch(() => ({}));
      alert(data.message || (res.ok ? "Reindexado" : data.error || "Error"));
      await loadFiles();
    } catch {}
  };

  const handleMoveCategory = async (file: KbFile, categoryId: string) => {
    if (!categoryId || categoryId === file.category_id) return;
    try {
      await fetch(`/api/admin/knowledge/files/${file.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "move", categoryId }),
      });
      await loadFiles();
    } catch {}
  };

  // Resolución de conflicto
  const resolveConflict = async (action: "keep-both" | "delete-new" | "delete-old", file: KbFile) => {
    setConflictBusy(true);
    try {
      const res = await fetch(`/api/admin/knowledge/files/${file.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Error al resolver el conflicto");
      } else {
        setConflictFile(null);
        await loadFiles();
        await loadCategories();
      }
    } catch {}
    setConflictBusy(false);
  };

  // Entrada manual
  const handleCreateEntry = async () => {
    if (!form.title.trim() || !form.content.trim()) return;
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("textEntry", "1");
      formData.append("title", form.title);
      formData.append("content", form.content);
      const catId = form.category || defaultUploadCategory;
      if (catId) formData.append("categoryId", catId);

      const res = await fetch("/api/admin/knowledge/files", {
        method: "POST",
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      setUploadResults(data.results || (res.ok ? [] : [{ name: form.title, status: "error", message: data.error || "Error" }]));
      if (res.ok) {
        setForm({ title: "", content: "", category: "" });
        setShowForm(false);
        await loadFiles();
        await loadCategories();
      }
    } catch {}
    setSaving(false);
  };

  // Categorías
  const handleCreateCategory = async () => {
    if (!newCatLabel.trim()) return;
    try {
      const res = await fetch("/api/admin/knowledge/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newCatLabel }),
      });
      if (res.ok) {
        setNewCatLabel("");
        await loadCategories();
      }
    } catch {}
  };

  const handleDeleteCategory = async (cat: KbCategory) => {
    if (cat.file_count > 0) {
      alert(`La categoría "${cat.label}" tiene ${cat.file_count} archivo(s). Reasígnelos antes de eliminar.`);
      return;
    }
    if (!confirm(`¿Eliminar la categoría "${cat.label}"?`)) return;
    try {
      const res = await fetch(`/api/admin/knowledge/categories/${cat.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) alert(data.error || "No se pudo eliminar");
      await loadCategories();
    } catch {}
  };

  const filteredFiles = files.filter((f) => {
    if (!search) return true;
    return f.filename.toLowerCase().includes(search.toLowerCase());
  });

  const entryFiles = files.filter((f) => f.format === "text");

  // ─── Render ───
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Knowledge Base</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Documentos y entradas consultables por el modelo al responder a los usuarios
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { loadFiles(); loadCategories(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#121824] border border-[#202938] text-xs text-gray-400 hover:text-white transition-colors"
          >
            <RefreshCw size={14} className={loadingFiles ? "animate-spin" : ""} />
            Recargar
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#202938] pb-0">
        {([
          { id: "archivos", label: `Archivos (${files.filter((f) => f.format !== "text").length})`, icon: <FileText size={14} /> },
          { id: "entradas", label: `Entradas de texto (${entryFiles.length})`, icon: <BookOpen size={14} /> },
          { id: "categorias", label: `Categorías (${categories.length})`, icon: <FolderOpen size={14} /> },
        ] as { id: Tab; label: string; icon: React.ReactNode }[]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-xs font-medium transition-colors border-b-2 ${
              tab === t.id
                ? "text-green-400 border-green-500/60 bg-[#121824]/50"
                : "text-gray-500 border-transparent hover:text-gray-300"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Resultados de última operación */}
      {uploadResults.length > 0 && (
        <div className="space-y-1.5">
          {uploadResults.map((r, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${
                r.status === "active" || r.status === "duplicate"
                  ? "bg-green-600/10 border-green-500/20 text-green-300"
                  : r.status === "hold"
                    ? "bg-amber-600/10 border-amber-500/20 text-amber-300"
                    : "bg-red-600/10 border-red-500/20 text-red-300"
              }`}
            >
              {r.status === "active" ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : r.status === "hold" ? <AlertTriangle size={14} className="mt-0.5 shrink-0" /> : <X size={14} className="mt-0.5 shrink-0" />}
              <div>
                <span className="font-medium">{r.name}</span>: {r.message}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══════════ PESTAÑA: ARCHIVOS ═══════════ */}
      {tab === "archivos" && (
        <>
          {/* Upload zone */}
          <div className="rounded-xl bg-[#121824] border border-dashed border-[#2a3550] p-5">
            <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                <UploadCloud size={16} className={uploading ? "animate-pulse" : ""} />
                {uploading ? "Procesando archivos..." : "Subir archivos"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.csv"
                multiple
                className="hidden"
                onChange={(e) => {
                  handleUpload(e.target.files);
                  e.target.value = "";
                }}
              />
              <span className="text-[11px] text-gray-500">
                PDF, DOCX, XLSX, XLS, TXT, MD, CSV · El texto se extrae e indexa automáticamente
              </span>
              <select
                value={uploadCategory}
                onChange={(e) => setUploadCategory(e.target.value)}
                className="ml-auto bg-[#030812] border border-[#202938] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-green-500/50"
              >
                <option value="">Categoría: General</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id} className="bg-[#030812]">
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Filtros */}
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Buscar por nombre de archivo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-[#121824] border border-[#202938] rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50 transition-colors"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-[#121824] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-green-500/50 transition-colors"
            >
              <option value="" className="bg-[#030812]">Todos los estados</option>
              <option value="active" className="bg-[#030812]">Activos</option>
              <option value="hold" className="bg-[#030812]">En revisión</option>
              <option value="processing" className="bg-[#030812]">Procesando</option>
            </select>
          </div>

          {/* Lista */}
          {loadingFiles ? (
            <div className="text-center py-12 text-gray-500">
              <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
              Cargando archivos...
            </div>
          ) : filteredFiles.filter((f) => f.format !== "text").length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <FileText size={32} className="mx-auto mb-3 opacity-50" />
              {search || statusFilter
                ? "No se encontraron archivos con esos filtros"
                : "No hay archivos subidos. Sube un documento para que el modelo pueda consultarlo."}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredFiles.filter((f) => f.format !== "text").map((file) => {
                const badge = STATUS_BADGE[file.status] || STATUS_BADGE.processing;
                return (
                  <div
                    key={file.id}
                    className="rounded-xl bg-[#121824] border border-[#202938] p-4 hover:border-green-500/20 transition-colors"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                      <FileText size={18} className="text-green-500/60 shrink-0 hidden lg:block" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-white truncate">{file.filename}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${badge.cls}`}>
                            {badge.label}
                          </span>
                          {file.conflict_with && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-600/20 text-orange-400 border border-orange-500/30">
                              ⚠ Conflicto con &quot;{file.conflict_with_filename}&quot;
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500 flex-wrap">
                          <span>{file.category_label || "General"}</span>
                          <span>{formatBytes(file.size_bytes)}</span>
                          <span>{file.chunk_count > 0 ? `${file.chunk_count} fragmentos indexados` : "sin indexar"}</span>
                          <span>{file.uploader_name ? `Por: ${file.uploader_name}` : ""}</span>
                          <span>{new Date(file.updated_at).toLocaleDateString("es-MX")}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                        <select
                          value={file.category_id || defaultUploadCategory}
                          onChange={(e) => handleMoveCategory(file, e.target.value)}
                          className="bg-[#030812] border border-[#202938] rounded-lg px-2 py-1.5 text-[11px] text-gray-300 focus:outline-none"
                          title="Cambiar categoría"
                        >
                          {categories.map((c) => (
                            <option key={c.id} value={c.id} className="bg-[#030812]">
                              {c.label}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleReindex(file)}
                          className="p-2 rounded-lg text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                          title="Reindexar"
                        >
                          <ListRestart size={15} />
                        </button>
                        <button
                          onClick={() => handleDelete(file)}
                          className="p-2 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    {file.status === "hold" && file.conflict_with && (
                      <div className="mt-3 pt-3 border-t border-[#202938] flex items-center gap-2">
                        <AlertTriangle size={14} className="text-amber-400" />
                        <span className="text-[11px] text-gray-400 flex-1">
                          Se subió otro archivo con el mismo nombre. Decide qué hacer:
                        </span>
                        <button
                          onClick={() => setConflictFile(file)}
                          className="px-3 py-1.5 rounded-lg bg-amber-600/20 text-amber-400 text-[11px] font-medium border border-amber-500/30 hover:bg-amber-600/30 transition-colors"
                        >
                          Resolver conflicto
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ═══════════ PESTAÑA: ENTRADAS DE TEXTO ═══════════ */}
      {tab === "entradas" && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Entradas escritas a mano. Se indexan igual que los archivos y se consultan por el modelo.
            </p>
            <button
              onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-green-600 hover:bg-green-500 text-white text-xs font-medium transition-colors"
            >
              <Plus size={14} />
              Nueva entrada
            </button>
          </div>

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
                  <option value="" className="bg-[#030812]">Categoría: General</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id} className="bg-[#030812]">
                      {cat.label}
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
                    onClick={handleCreateEntry}
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

          {loadingFiles ? (
            <div className="text-center py-12 text-gray-500">
              <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
              Cargando entradas...
            </div>
          ) : entryFiles.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <BookOpen size={32} className="mx-auto mb-3 opacity-50" />
              No hay entradas de texto. Crea la primera arriba.
            </div>
          ) : (
            <div className="space-y-2">
              {entryFiles.map((entry) => {
                const badge = STATUS_BADGE[entry.status] || STATUS_BADGE.processing;
                return (
                  <div
                    key={entry.id}
                    className="rounded-xl bg-[#121824] border border-[#202938] p-4 hover:border-green-500/20 transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <BookOpen size={14} className="text-green-500/60" />
                          <span className="text-sm font-medium text-white truncate">{entry.filename}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-500">
                          <span>{entry.category_label || "General"}</span>
                          <span>{entry.chunk_count > 0 ? `${entry.chunk_count} fragmentos indexados` : "sin indexar"}</span>
                          <span>{new Date(entry.updated_at).toLocaleDateString("es-MX")}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleReindex(entry)}
                          className="p-2 rounded-lg text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                          title="Reindexar"
                        >
                          <ListRestart size={15} />
                        </button>
                        <button
                          onClick={() => handleDelete(entry)}
                          className="p-2 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                          title="Eliminar entrada"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ═══════════ PESTAÑA: CATEGORÍAS ═══════════ */}
      {tab === "categorias" && (
        <>
          <div className="rounded-xl bg-[#121824] border border-[#202938] p-5">
            <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center">
              <div className="flex-1">
                <p className="text-xs text-gray-400 mb-1.5">
                  Las categorías organizan la información y definirán el acceso por área/departamento en el futuro.
                  &quot;General&quot; es protegida y visible para todos.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Nueva categoría (ej. Recursos Humanos)"
                    value={newCatLabel}
                    onChange={(e) => setNewCatLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleCreateCategory(); }}
                    className="flex-1 bg-[#030812] border border-[#202938] rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50 transition-colors"
                  />
                  <button
                    onClick={handleCreateCategory}
                    disabled={!newCatLabel.trim()}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-xs font-medium transition-colors disabled:opacity-50"
                  >
                    <Plus size={14} />
                    Agregar
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className="rounded-xl bg-[#121824] border border-[#202938] p-4 flex items-center gap-3"
              >
                <div className="w-9 h-9 rounded-lg bg-green-600/20 flex items-center justify-center shrink-0">
                  <FolderOpen size={16} className="text-green-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{cat.label}</p>
                  <p className="text-[11px] text-gray-500">
                    {cat.active_count} activos · {cat.file_count} total
                    {cat.name === "general" && " · protegida"}
                  </p>
                </div>
                {cat.name !== "general" && (
                  <button
                    onClick={() => handleDeleteCategory(cat)}
                    className="p-2 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Eliminar categoría"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Modal: resolución de conflicto */}
      {conflictFile && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => !conflictBusy && setConflictFile(null)}>
          <div
            className="bg-[#121824] border border-[#2a3550] rounded-2xl p-6 max-w-md w-full space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-600/20 flex items-center justify-center shrink-0">
                <Copy size={18} className="text-amber-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Resolución de conflicto</h3>
                <p className="text-xs text-gray-400 mt-1">
                  El archivo <span className="text-white font-medium">&quot;{conflictFile.filename}&quot;</span> tiene el mismo
                  nombre que <span className="text-white font-medium">&quot;{conflictFile.conflict_with_filename}&quot;</span>.
                  ¿Cómo quieres proceder?
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => resolveConflict("keep-both", conflictFile)}
                disabled={conflictBusy}
                className="w-full text-left px-4 py-3 rounded-xl bg-green-600/10 border border-green-500/30 hover:bg-green-600/20 transition-colors disabled:opacity-50"
              >
                <p className="text-xs font-medium text-green-400">Mantener ambos</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  El nuevo se activa con el nombre &quot;{conflictFile.filename.replace(/(\.[^.]+)$/, " (2)$1")}&quot; y ambos quedan consultables.
                </p>
              </button>
              <button
                onClick={() => resolveConflict("delete-old", conflictFile)}
                disabled={conflictBusy}
                className="w-full text-left px-4 py-3 rounded-xl bg-blue-600/10 border border-blue-500/30 hover:bg-blue-600/20 transition-colors disabled:opacity-50"
              >
                <p className="text-xs font-medium text-blue-400">Eliminar el anterior</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  El archivo anterior se borra y el nuevo queda activo y consultable.
                </p>
              </button>
              <button
                onClick={() => resolveConflict("delete-new", conflictFile)}
                disabled={conflictBusy}
                className="w-full text-left px-4 py-3 rounded-xl bg-red-600/10 border border-red-500/30 hover:bg-red-600/20 transition-colors disabled:opacity-50"
              >
                <p className="text-xs font-medium text-red-400">Eliminar el nuevo</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  El archivo nuevo se descarta y el anterior queda como estaba.
                </p>
              </button>
            </div>

            <button
              onClick={() => setConflictFile(null)}
              disabled={conflictBusy}
              className="w-full py-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <p className="text-[11px] text-gray-600">
        {files.length} documento{files.length !== 1 ? "s" : ""} en total
        ({files.filter((f) => f.status === "active").length} activos, {files.filter((f) => f.status === "hold").length} en revisión)
      </p>
    </div>
  );
}
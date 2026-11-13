"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Brain,
  Building2,
  Check,
  Copy,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import {
  EMPTY_HEART_DRAFT,
  HEART_LIMITS,
  HEART_TOOLS,
  HEART_TOOL_LABELS,
  type HeartDraft,
  type HeartTool,
} from "@/lib/heart-config";
import { useAgentsStore } from "@/lib/stores/agents-store";
import type { Agent } from "@/types";

type EditorState = { mode: "create" } | { mode: "edit"; agent: Agent };

const fieldClass =
  "surface-field w-full rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors";
const labelClass =
  "mb-1.5 block text-[11px] font-medium text-[var(--chat-muted)]";
const secondaryButton =
  "inline-flex items-center gap-1.5 rounded-lg border border-[var(--sidebar-border)] bg-[var(--sidebar-card)] px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--chat-muted)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[var(--chat-text)]";
const dangerButton =
  "inline-flex items-center gap-1.5 rounded-lg border border-transparent px-2 py-1.5 text-[11.5px] font-medium text-[var(--chat-muted)] transition-colors hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-400";

function draftFromAgent(agent: Agent): HeartDraft {
  return {
    name: agent.name,
    role: agent.role,
    tone: agent.tone,
    instructions: agent.instructions,
    limitations: agent.limitations,
    temperature: agent.temperature,
    tools: [...agent.tools],
  };
}

function AgentCard({
  agent,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  agent: Agent;
  onEdit: (agent: Agent) => void;
  onDuplicate: (agent: Agent) => void;
  onDelete: (agent: Agent) => void;
}) {
  return (
    <article className="surface-card group flex min-h-[212px] flex-col gap-3 rounded-2xl p-5 transition-colors hover:border-[var(--chat-accent-border)]">
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 text-white shadow-lg shadow-emerald-500/15">
          <Brain size={20} strokeWidth={1.8} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold text-[var(--chat-text-strong)]">
              {agent.name}
            </h3>
            {!agent.is_owner && (
              <span className="shrink-0 rounded-full bg-[var(--chat-accent-soft)] px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-[var(--chat-accent)]">
                Empresa
              </span>
            )}
          </div>
          <p className="truncate text-xs text-[var(--chat-muted)]">
            {agent.role || (agent.is_owner ? "Heart personal" : "Heart de la empresa")}
          </p>
        </div>
      </div>

      <p className="line-clamp-3 text-[12.5px] leading-relaxed text-[var(--chat-muted)]">
        {agent.instructions || agent.tone || "Sin instrucciones todavía."}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--sidebar-border)] px-2 py-0.5 text-[10px] text-[var(--chat-muted)]">
          <Settings size={10} strokeWidth={1.8} />
          Temp. {agent.temperature.toFixed(1)}
        </span>
        {agent.tools.map((tool) => (
          <span
            key={tool}
            className="rounded-full bg-[var(--sidebar-card)] px-2 py-0.5 text-[10px] text-[var(--chat-muted)]"
          >
            {HEART_TOOL_LABELS[tool]}
          </span>
        ))}
      </div>

      <div className="mt-auto flex items-center gap-1.5 border-t border-[var(--sidebar-border)] pt-3">
        {agent.is_owner ? (
          <>
            <button type="button" onClick={() => onEdit(agent)} className={secondaryButton}>
              <Pencil size={13} strokeWidth={1.8} />
              Editar
            </button>
            <button type="button" onClick={() => onDuplicate(agent)} className={secondaryButton}>
              <Copy size={13} strokeWidth={1.8} />
              Duplicar
            </button>
            <button
              type="button"
              onClick={() => onDelete(agent)}
              className={`${dangerButton} ml-auto`}
              aria-label={`Eliminar ${agent.name}`}
            >
              <Trash2 size={13} strokeWidth={1.8} />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => onDuplicate(agent)}
            className="accent-button inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px]"
          >
            <Copy size={13} strokeWidth={1.8} />
            Duplicar para personalizar
          </button>
        )}
      </div>
    </article>
  );
}

export default function AgentsView() {
  const agents = useAgentsStore((s) => s.agents);
  const loading = useAgentsStore((s) => s.loading);
  const loaded = useAgentsStore((s) => s.loaded);
  const storeError = useAgentsStore((s) => s.error);
  const loadAgents = useAgentsStore((s) => s.loadAgents);
  const createAgent = useAgentsStore((s) => s.createAgent);
  const updateAgent = useAgentsStore((s) => s.updateAgent);
  const duplicateAgent = useAgentsStore((s) => s.duplicateAgent);
  const deleteAgent = useAgentsStore((s) => s.deleteAgent);
  const clearError = useAgentsStore((s) => s.clearError);

  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [draft, setDraft] = useState<HeartDraft>({ ...EMPTY_HEART_DRAFT, tools: [] });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Fetch inicial diferido para no hacer setState síncrono dentro del efecto.
  useEffect(() => {
    const id = setTimeout(() => {
      void loadAgents();
    }, 0);
    return () => clearTimeout(id);
  }, [loadAgents]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return agents;
    return agents.filter((agent) =>
      [agent.name, agent.role, agent.tone, agent.instructions]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [agents, query]);

  const mine = filtered.filter((agent) => agent.is_owner);
  const company = filtered.filter((agent) => !agent.is_owner);
  const hasAgents = agents.length > 0;

  const openCreate = () => {
    clearError();
    setDraft({ ...EMPTY_HEART_DRAFT, tools: [] });
    setFormError(null);
    setEditor({ mode: "create" });
  };

  const openEdit = (agent: Agent) => {
    clearError();
    setDraft(draftFromAgent(agent));
    setFormError(null);
    setEditor({ mode: "edit", agent });
  };

  const closeEditor = () => {
    if (saving) return;
    setEditor(null);
    setFormError(null);
  };

  const toggleTool = (tool: HeartTool) => {
    setDraft((current) => ({
      ...current,
      tools: current.tools.includes(tool)
        ? current.tools.filter((item) => item !== tool)
        : [...current.tools, tool],
    }));
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editor || !draft.name.trim() || saving) return;

    setSaving(true);
    setFormError(null);
    const saved =
      editor.mode === "create"
        ? await createAgent(draft)
        : await updateAgent(editor.agent.id, draft);
    setSaving(false);

    if (saved) {
      setEditor(null);
      return;
    }
    setFormError(useAgentsStore.getState().error || "No se pudo guardar el Heart.");
  };

  const handleDuplicate = async (agent: Agent) => {
    clearError();
    await duplicateAgent(agent.id);
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    const ok = await deleteAgent(deleteTarget.id);
    setDeleting(false);
    if (ok) setDeleteTarget(null);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-6 pb-10 pt-16 lg:px-8 lg:pb-12 lg:pt-20">
        <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[var(--chat-accent)]">
              <Brain size={14} strokeWidth={1.9} />
              Espacio de trabajo
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--chat-text-strong)] sm:text-3xl">
              Hearts
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm text-[var(--chat-muted)]">
              Crea asistentes con su propio rol, tono e instrucciones. Los Hearts de la
              empresa puedes duplicarlos para adaptarlos a tu trabajo.
            </p>
          </div>

          <button
            type="button"
            onClick={openCreate}
            className="accent-button inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm"
          >
            <Plus size={16} strokeWidth={2} />
            Nuevo Heart
          </button>
        </header>

        <div className="relative mb-6">
          <Search
            size={16}
            strokeWidth={1.8}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--chat-muted-2)]"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nombre, rol o instrucciones..."
            aria-label="Buscar Hearts"
            className="surface-field w-full rounded-xl py-2.5 pl-10 pr-10 text-sm outline-none transition-colors"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--chat-muted)] transition-colors hover:text-[var(--chat-text)]"
              aria-label="Limpiar búsqueda"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {storeError && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
            <span>{storeError}</span>
            <button
              type="button"
              onClick={() => loadAgents(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/40 px-2.5 py-1.5 font-medium transition-colors hover:bg-red-500/15"
            >
              <RefreshCw size={12} />
              Reintentar
            </button>
          </div>
        )}

        {loading && !loaded ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="surface-card h-[212px] animate-pulse rounded-2xl opacity-60"
              />
            ))}
          </div>
        ) : !hasAgents ? (
          storeError ? null : (
            <div className="surface-card flex flex-col items-center rounded-2xl px-6 py-14 text-center">
              <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-500 text-white shadow-lg shadow-emerald-500/20">
                <Brain size={26} strokeWidth={1.7} />
              </div>
              <h2 className="text-base font-semibold text-[var(--chat-text-strong)]">
                Aún no hay Hearts
              </h2>
              <p className="mt-1.5 max-w-md text-sm text-[var(--chat-muted)]">
                Crea tu primer Heart para que responda con el rol, tono e instrucciones
                que necesitas.
              </p>
              <button
                type="button"
                onClick={openCreate}
                className="accent-button mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm"
              >
                <Plus size={16} />
                Crear mi primer Heart
              </button>
            </div>
          )
        ) : filtered.length === 0 ? (
          <p className="surface-card rounded-xl px-4 py-6 text-center text-sm text-[var(--chat-muted)]">
            No hay Hearts que coincidan con “{query}”.
          </p>
        ) : (
          <div className="space-y-8">
            <section>
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--chat-muted)]">
                  Mis Hearts
                </h2>
                <span className="rounded-full bg-[var(--sidebar-card)] px-2 py-0.5 text-[10px] font-medium text-[var(--chat-muted-2)]">
                  {mine.length}
                </span>
              </div>

              {mine.length === 0 ? (
                <p className="surface-card rounded-xl px-4 py-5 text-sm text-[var(--chat-muted)]">
                  {query
                    ? "Ningún Heart propio coincide con la búsqueda."
                    : "Todavía no tienes Hearts propios. Crea uno o duplica un Heart de la empresa."}
                </p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {mine.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      onEdit={openEdit}
                      onDuplicate={handleDuplicate}
                      onDelete={setDeleteTarget}
                    />
                  ))}
                </div>
              )}
            </section>

            {company.length > 0 && (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <Building2
                    size={14}
                    strokeWidth={1.8}
                    className="text-[var(--chat-muted-2)]"
                  />
                  <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--chat-muted)]">
                    De la empresa
                  </h2>
                  <span className="rounded-full bg-[var(--sidebar-card)] px-2 py-0.5 text-[10px] font-medium text-[var(--chat-muted-2)]">
                    {company.length}
                  </span>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {company.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      onEdit={openEdit}
                      onDuplicate={handleDuplicate}
                      onDelete={setDeleteTarget}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {/* ─── Editor ─── */}
      {editor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={closeEditor}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-editor-title"
            className="surface-modal max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-2xl p-5 sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2
                  id="agent-editor-title"
                  className="text-lg font-semibold text-[var(--chat-text-strong)]"
                >
                  {editor.mode === "create" ? "Nuevo Heart" : "Editar Heart"}
                </h2>
                <p className="mt-1 text-xs text-[var(--chat-muted)]">
                  Define cómo se comporta y qué herramientas puede usar.
                </p>
              </div>
              <button
                type="button"
                onClick={closeEditor}
                className="rounded-lg p-1.5 text-[var(--chat-muted)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[var(--chat-text)]"
                aria-label="Cerrar"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label htmlFor="agent-name" className={labelClass}>
                  Nombre *
                </label>
                <input
                  id="agent-name"
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                  placeholder="Ej. Analista de resultados"
                  maxLength={HEART_LIMITS.name}
                  autoFocus
                  required
                  className={fieldClass}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="agent-role" className={labelClass}>
                    Rol
                  </label>
                  <input
                    id="agent-role"
                    value={draft.role}
                    onChange={(event) =>
                      setDraft({ ...draft, role: event.target.value })
                    }
                    placeholder="Ej. Analista, mentor, redactor..."
                    maxLength={HEART_LIMITS.role}
                    className={fieldClass}
                  />
                </div>
                <div>
                  <label htmlFor="agent-tone" className={labelClass}>
                    Tono
                  </label>
                  <input
                    id="agent-tone"
                    value={draft.tone}
                    onChange={(event) =>
                      setDraft({ ...draft, tone: event.target.value })
                    }
                    placeholder="Ej. Formal, cercano, técnico..."
                    maxLength={HEART_LIMITS.tone}
                    className={fieldClass}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="agent-instructions" className={labelClass}>
                  Instrucciones
                </label>
                <textarea
                  id="agent-instructions"
                  value={draft.instructions}
                  onChange={(event) =>
                    setDraft({ ...draft, instructions: event.target.value })
                  }
                  placeholder="Describe cómo debe responder, qué debe priorizar y qué estilo debe mantener."
                  rows={4}
                  maxLength={HEART_LIMITS.instructions}
                  className={`${fieldClass} resize-y`}
                />
              </div>

              <div>
                <label htmlFor="agent-limitations" className={labelClass}>
                  Limitaciones
                </label>
                <textarea
                  id="agent-limitations"
                  value={draft.limitations}
                  onChange={(event) =>
                    setDraft({ ...draft, limitations: event.target.value })
                  }
                  placeholder="Qué no debe hacer o qué temas debe evitar."
                  rows={3}
                  maxLength={HEART_LIMITS.limitations}
                  className={`${fieldClass} resize-y`}
                />
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className={labelClass}>Temperatura</span>
                  <span className="rounded-full bg-[var(--chat-accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--chat-accent)]">
                    {draft.temperature.toFixed(1)}
                  </span>
                </div>
                <input
                  type="range"
                  min={HEART_LIMITS.temperatureMin}
                  max={HEART_LIMITS.temperatureMax}
                  step={0.1}
                  value={draft.temperature}
                  onChange={(event) =>
                    setDraft({ ...draft, temperature: Number(event.target.value) })
                  }
                  className="w-full accent-[var(--chat-accent)]"
                  aria-label="Temperatura"
                />
                <p className="mt-1 text-[10.5px] text-[var(--chat-muted-2)]">
                  0 = respuestas precisas · 2 = respuestas más creativas
                </p>
              </div>

              <div>
                <span className={labelClass}>Herramientas</span>
                <div className="flex flex-wrap gap-2">
                  {HEART_TOOLS.map((tool) => {
                    const active = draft.tools.includes(tool);
                    return (
                      <button
                        key={tool}
                        type="button"
                        onClick={() => toggleTool(tool)}
                        aria-pressed={active}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-medium transition-colors ${
                          active
                            ? "border-[var(--chat-accent-border)] bg-[var(--chat-accent-soft)] text-[var(--chat-accent)]"
                            : "border-[var(--sidebar-border)] bg-[var(--sidebar-card)] text-[var(--chat-muted)] hover:text-[var(--chat-text)]"
                        }`}
                      >
                        {active && <Check size={12} strokeWidth={2} />}
                        {HEART_TOOL_LABELS[tool]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {formError && (
                <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {formError}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-[var(--sidebar-border)] pt-4">
                <button
                  type="button"
                  onClick={closeEditor}
                  disabled={saving}
                  className="modal-secondary-button rounded-xl px-4 py-2 text-sm disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving || !draft.name.trim()}
                  className="accent-button inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm"
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  {editor.mode === "create" ? "Crear Heart" : "Guardar cambios"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Confirmar eliminación ─── */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !deleting && setDeleteTarget(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-delete-title"
            className="surface-modal w-full max-w-sm rounded-2xl p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-red-500/15 text-red-400">
                <Trash2 size={17} />
              </span>
              <h2
                id="agent-delete-title"
                className="text-base font-semibold text-[var(--chat-text-strong)]"
              >
                Eliminar Heart
              </h2>
            </div>
            <p className="text-sm text-[var(--chat-muted)]">
              ¿Eliminar <strong className="text-[var(--chat-text)]">{deleteTarget.name}</strong>?
              Esta acción no se puede deshacer.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="modal-secondary-button rounded-xl px-4 py-2 text-sm disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="inline-flex items-center gap-2 rounded-xl bg-red-500/90 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
              >
                {deleting && <Loader2 size={14} className="animate-spin" />}
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

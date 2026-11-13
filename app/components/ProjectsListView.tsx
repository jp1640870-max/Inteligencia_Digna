"use client";

import { useEffect, useState, useCallback } from "react";
import { Folder, Plus, Trash2, MessageSquare, Search } from "lucide-react";
import type { Project } from "@/types";

type Props = {
  onOpenProject: (projectId: string) => void;
  onProjectChanged: () => void;
};

export default function ProjectsListView({ onOpenProject, onProjectChanged }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [search, setSearch] = useState("");

  const loadProjects = useCallback(async () => {
    const params = search ? `?q=${encodeURIComponent(search)}` : "";
    const res = await fetch(`/api/projects${params}`);
    if (res.ok) setProjects(await res.json());
  }, [search]);

  // Fetch inicial diferido a una macrotarea: evita setState síncrono dentro
  // del efecto (react-hooks/set-state-in-effect) sin cambiar comportamiento.
  // TODO(Fase 2): migrar a fetching dirigido por eventos/Suspense.
  useEffect(() => {
    const id = setTimeout(() => { void loadProjects(); }, 0);
    return () => clearTimeout(id);
  }, [loadProjects]);

  const createProject = async () => {
    if (!name.trim()) return;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), instructions }),
    });
    if (res.ok) {
      setName("");
      setInstructions("");
      loadProjects();
      onProjectChanged();
    }
  };

  const deleteProject = async (id: string) => {
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (res.ok) {
      setProjects((prev) => prev.filter((p) => p.id !== id));
      onProjectChanged();
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="max-w-6xl mx-auto w-full px-6 pb-6 pt-16 lg:px-8 lg:pb-8 lg:pt-20">
        <h1 className="text-4xl font-bold text-green-400 flex items-center gap-3 mb-8">
          <Folder /> Proyectos
        </h1>

        <div className="surface-card mb-8 rounded-2xl p-6">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del proyecto"
            className="surface-field mb-4 w-full rounded-xl px-4 py-3 outline-none transition-colors"
            onKeyDown={(e) => { if (e.key === "Enter") createProject(); }}
          />

          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Instrucciones del proyecto para la IA..."
            className="surface-field mb-4 h-32 w-full resize-y rounded-xl px-4 py-3 outline-none transition-colors"
          />

          <button
            onClick={createProject}
            disabled={!name.trim()}
            className="accent-button flex items-center gap-2 rounded-xl px-5 py-3 transition-colors"
          >
            <Plus size={18} /> Crear proyecto
          </button>
        </div>

        <div className="relative mb-6">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--chat-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar proyectos..."
            className="surface-field w-full rounded-xl py-3 pl-12 pr-4 outline-none transition-colors"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.length === 0 && (
            <p className="col-span-full py-8 text-center text-[var(--chat-muted)]">
              {search ? "Sin resultados" : "No hay proyectos aún. Crea uno arriba."}
            </p>
          )}
          {projects.map((p) => (
            <div key={p.id} className="surface-card rounded-2xl p-5">
              <h2 className="mb-2 text-xl font-bold text-green-400">{p.name}</h2>
              <p className="mb-4 line-clamp-4 text-sm text-[var(--chat-muted)]">
                {p.instructions || "Sin instrucciones"}
              </p>
              {p.chat_count !== undefined && (
                <p className="mb-3 text-xs text-[var(--chat-muted-2)]">
                  {p.chat_count} {(p.chat_count as number) === 1 ? "chat" : "chats"}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => onOpenProject(p.id)}
                  className="accent-button flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 transition-colors"
                >
                  <MessageSquare size={16} /> Abrir
                </button>

                <button
                  onClick={() => deleteProject(p.id)}
                  className="danger-soft-button rounded-xl px-4 py-2 transition-colors"
                  aria-label={`Eliminar proyecto ${p.name}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

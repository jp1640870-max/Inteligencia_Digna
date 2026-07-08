"use client";

import { useEffect, useState } from "react";
import { Folder, Plus, Trash2, MessageSquare, Search, ArrowLeft } from "lucide-react";
import type { Project } from "@/types";

type Props = {
  darkMode: boolean;
  onOpenProject: (projectId: string) => void;
  onBack: () => void;
  onProjectChanged: () => void;
};

export default function ProjectsListView({ darkMode, onOpenProject, onBack, onProjectChanged }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [search, setSearch] = useState("");

  const c = {
    border: darkMode ? "border-[#202938]" : "border-gray-300",
    textMuted: darkMode ? "text-gray-400" : "text-gray-500",
    inputBg: darkMode ? "bg-[#030812]" : "bg-white",
    card: darkMode ? "bg-[#121824]" : "bg-white",
    hover: darkMode ? "hover:bg-[#1e293b]" : "hover:bg-gray-200",
  };

  const loadProjects = async () => {
    const params = search ? `?q=${encodeURIComponent(search)}` : "";
    const res = await fetch(`/api/projects${params}`);
    if (res.ok) setProjects(await res.json());
  };

  useEffect(() => {
    loadProjects();
  }, [search]);

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
      <div className="max-w-6xl mx-auto p-6 lg:p-8 w-full">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft size={18} />
          Volver
        </button>

        <h1 className="text-4xl font-bold text-green-400 flex items-center gap-3 mb-8">
          <Folder /> Proyectos
        </h1>

        <div className={`${c.card} ${c.border} border rounded-2xl p-6 mb-8`}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del proyecto"
            className={`w-full mb-4 ${c.inputBg} ${c.border} border rounded-xl px-4 py-3 text-white outline-none focus:border-green-500 transition-colors`}
            onKeyDown={(e) => { if (e.key === "Enter") createProject(); }}
          />

          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Instrucciones del proyecto para la IA..."
            className={`w-full h-32 mb-4 ${c.inputBg} ${c.border} border rounded-xl px-4 py-3 text-white outline-none focus:border-green-500 transition-colors resize-y`}
          />

          <button
            onClick={createProject}
            disabled={!name.trim()}
            className="bg-green-500 hover:bg-green-600 disabled:opacity-50 px-5 py-3 rounded-xl flex items-center gap-2 transition-colors"
          >
            <Plus size={18} /> Crear proyecto
          </button>
        </div>

        <div className="relative mb-6">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar proyectos..."
            className={`w-full pl-12 pr-4 py-3 ${c.card} ${c.border} border rounded-xl text-white outline-none focus:border-green-500 transition-colors`}
          />
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.length === 0 && (
            <p className={`${c.textMuted} col-span-full text-center py-8`}>
              {search ? "Sin resultados" : "No hay proyectos aún. Crea uno arriba."}
            </p>
          )}
          {projects.map((p) => (
            <div key={p.id} className={`${c.card} ${c.border} border rounded-2xl p-5`}>
              <h2 className="text-xl font-bold text-green-400 mb-2">{p.name}</h2>
              <p className={`${c.textMuted} text-sm mb-4 line-clamp-4`}>
                {p.instructions || "Sin instrucciones"}
              </p>
              {p.chat_count !== undefined && (
                <p className="text-xs text-gray-500 mb-3">
                  {p.chat_count} {(p.chat_count as number) === 1 ? "chat" : "chats"}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => onOpenProject(p.id)}
                  className="flex-1 bg-green-500 hover:bg-green-600 px-4 py-2 rounded-xl flex items-center justify-center gap-2 transition-colors"
                >
                  <MessageSquare size={16} /> Abrir
                </button>

                <button
                  onClick={() => deleteProject(p.id)}
                  className="bg-red-500 hover:bg-red-600 px-4 py-2 rounded-xl transition-colors"
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

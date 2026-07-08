"use client";

import { useEffect, useState } from "react";
import { Folder, Plus, Trash2, MessageSquare } from "lucide-react";

type Project = {
  id: string;
  name: string;
  instructions: string;
  createdAt: string;
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");

  const loadProjects = async () => {
    const res = await fetch("/api/projects");
    if (res.ok) setProjects(await res.json());
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const createProject = async () => {
    if (!name.trim()) return alert("Ponle nombre al proyecto");

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, instructions }),
    });

    if (res.ok) {
      setName("");
      setInstructions("");
      loadProjects();
    }
  };

  const openProject = (id: string) => {
    window.location.href = `/?projectId=${id}`;
  };

  const deleteProject = async (id: string) => {
    if (!confirm("¿Eliminar proyecto?")) return;

    const res = await fetch(`/api/projects/${id}`, {
      method: "DELETE",
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || "No se pudo eliminar");
      return;
    }

    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <main className="min-h-screen bg-[#030812] text-white p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold text-green-400 flex items-center gap-3 mb-8">
          <Folder /> Proyectos
        </h1>

        <div className="bg-[#121824] border border-[#202938] rounded-2xl p-6 mb-8">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del proyecto"
            className="w-full mb-4 bg-[#030812] border border-[#202938] rounded-xl px-4 py-3 outline-none"
          />

          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Instrucciones del proyecto para la IA..."
            className="w-full h-32 mb-4 bg-[#030812] border border-[#202938] rounded-xl px-4 py-3 outline-none"
          />

          <button
            onClick={createProject}
            className="bg-green-500 hover:bg-green-600 px-5 py-3 rounded-xl flex items-center gap-2"
          >
            <Plus size={18} /> Crear proyecto
          </button>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <div key={p.id} className="bg-[#121824] border border-[#202938] rounded-2xl p-5">
              <h2 className="text-xl font-bold text-green-400 mb-2">{p.name}</h2>
              <p className="text-gray-400 text-sm mb-4 line-clamp-4">
                {p.instructions || "Sin instrucciones"}
              </p>

              <div className="flex gap-2">
                <button
                  onClick={() => openProject(p.id)}
                  className="flex-1 bg-green-500 hover:bg-green-600 px-4 py-2 rounded-xl flex items-center justify-center gap-2"
                >
                  <MessageSquare size={16} /> Abrir
                </button>

                <button
                  onClick={() => deleteProject(p.id)}
                  className="bg-red-500 hover:bg-red-600 px-4 py-2 rounded-xl"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

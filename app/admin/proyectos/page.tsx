"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Search, FolderKanban, User, MessageSquare } from "lucide-react";
import Link from "next/link";

type ProjectEntry = {
  id: string;
  name: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  chat_count: number;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export default function AdminProyectos() {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const params = search ? `?search=${encodeURIComponent(search)}` : "";
      const res = await fetch(`/api/admin/projects${params}`);
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects);
      }
    } catch {}
    setLoading(false);
  }, [search]);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Proyectos</h1>
        <button onClick={loadProjects} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#121824] border border-[#202938] text-xs text-gray-400 hover:text-white transition-colors">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Recargar
        </button>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar proyectos..." className="w-full bg-[#121824] border border-[#202938] rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50" />
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-12 text-gray-500">Cargando...</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <FolderKanban size={32} className="mx-auto mb-3 opacity-50" />
            {search ? "Sin resultados" : "No hay proyectos"}
          </div>
        ) : (
          projects.map((proj) => (
            <div key={proj.id} className="rounded-xl bg-[#121824] border border-[#202938] p-4 hover:border-green-500/20 transition-colors group">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <FolderKanban size={14} className="text-purple-400 shrink-0" />
                    <h3 className="text-sm font-medium text-white truncate">{proj.name}</h3>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                    <span className="flex items-center gap-1">
                      <User size={12} />
                      <Link href={`/admin/usuarios/${proj.user_id}`} className="hover:text-green-400 transition-colors">
                        {proj.user_name || proj.user_email || "—"}
                      </Link>
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageSquare size={12} />
                      {proj.chat_count} chats
                    </span>
                    <span>{new Date(proj.updated_at).toLocaleDateString("es-MX")}</span>
                  </div>
                  {proj.description && (
                    <p className="text-xs text-gray-600 mt-1 truncate">{proj.description}</p>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <p className="text-[11px] text-gray-600">{projects.length} proyectos{search && " filtrados"}</p>
    </div>
  );
}

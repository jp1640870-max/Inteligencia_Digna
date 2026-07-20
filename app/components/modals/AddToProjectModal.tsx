"use client";

import { useState } from "react";
import { Folder } from "lucide-react";
import { useUIStore } from "@/lib/stores/ui-store";
import { useProjectStore } from "@/lib/stores/project-store";
import { useChatStore } from "@/lib/stores/chat-store";

export default function AddToProjectModal() {
  const showAddToProjectChatId = useUIStore((s) => s.showAddToProjectChatId);
  const closeAddToProjectModal = useUIStore((s) => s.closeAddToProjectModal);
  const projects = useProjectStore((s) => s.projects);
  const addChatToProject = useProjectStore((s) => s.addChatToProject);
  const createProjectAndAddChat = useProjectStore((s) => s.createProjectAndAddChat);
  const projectChats = useProjectStore((s) => s.projectChats);
  const chats = useChatStore((s) => s.chats);

  const [newProjectName, setNewProjectName] = useState("");

  if (!showAddToProjectChatId) return null;

  const chatId = showAddToProjectChatId;
  const projectChatIds = new Set(
    (projectChats[chatId] || []).map((c) => c.id)
  );
  const available = chats.filter((c) => !projectChatIds.has(c.id));

  const handleCreateAndAdd = async () => {
    if (!newProjectName.trim()) return;
    await createProjectAndAddChat(newProjectName.trim(), chatId);
    setNewProjectName("");
    closeAddToProjectModal();
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={closeAddToProjectModal}
    >
      <div
        className="bg-[#121824] border border-[#202938] rounded-2xl p-6 w-96 max-h-[70vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-white mb-4">
          Agregar a proyecto
        </h3>

        {projects.length > 0 && (
          <>
            <p className="text-xs text-gray-500 mb-2">Proyectos existentes</p>
            <div className="space-y-1 mb-4">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    addChatToProject(p.id, chatId);
                    closeAddToProjectModal();
                  }}
                  className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-[#1e293b] transition-colors flex items-center gap-2 text-white"
                >
                  <Folder size={14} className="shrink-0 text-gray-400" />
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <p className="text-xs text-gray-500 mb-2">Crear nuevo proyecto</p>
        <input
          value={newProjectName}
          onChange={(e) => setNewProjectName(e.target.value)}
          placeholder="Nombre del proyecto"
          className="w-full px-3 py-2 text-sm rounded-lg bg-transparent border border-[#202938] text-white placeholder-gray-500 outline-none focus:bg-[#1e293b] transition-colors mb-2"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreateAndAdd();
            if (e.key === "Escape") closeAddToProjectModal();
          }}
        />
        <div className="flex gap-2">
          <button
            onClick={handleCreateAndAdd}
            disabled={!newProjectName.trim()}
            className="flex-1 py-2 rounded-xl bg-green-500 hover:bg-green-600 disabled:opacity-50 text-sm font-medium transition-colors text-white"
          >
            Crear y agregar
          </button>
          <button
            onClick={closeAddToProjectModal}
            className="px-4 py-2 text-sm text-gray-500 hover:underline"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

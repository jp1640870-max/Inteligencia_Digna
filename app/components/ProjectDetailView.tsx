"use client";

import { useEffect, useState } from "react";
import { Folder, Plus, Trash2, MessageSquare, X, ArrowLeft, Save } from "lucide-react";
import type { Chat, Project } from "@/types";

type ProyectoConChats = Project & {
  chats: Chat[];
};

type Props = {
  projectId: string;
  darkMode: boolean;
  onBack: () => void;
  onOpenChat: (chat: Chat, projectId: string) => void;
  onProjectChanged: () => void;
};

export default function ProjectDetailView({ projectId, darkMode, onBack, onOpenChat, onProjectChanged }: Props) {
  const [project, setProject] = useState<ProyectoConChats | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState("");
  const [editInstructions, setEditInstructions] = useState("");
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showAddChatModal, setShowAddChatModal] = useState(false);
  const [availableChats, setAvailableChats] = useState<Chat[]>([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [newChatTitle, setNewChatTitle] = useState("");
  const [deleteChatTarget, setDeleteChatTarget] = useState<Chat | null>(null);

  useEffect(() => {
    loadProject();
  }, [projectId]);

  const loadProject = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setProject(data);
        setEditName(data.name);
        setEditInstructions(data.instructions || "");
      }
    } catch {}
    setLoading(false);
  };

  const handleRename = async () => {
    if (!editName.trim() || !project) return;
    await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim() }),
    });
    setEditingName(false);
    loadProject();
    onProjectChanged();
  };

  const handleSaveInstructions = async () => {
    if (!project) return;
    setSavingInstructions(true);
    await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructions: editInstructions }),
    });
    setSavingInstructions(false);
    loadProject();
  };

  const handleDelete = async () => {
    if (!project) return;
    const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
    if (res.ok) {
      onProjectChanged();
      onBack();
    }
  };

  const handleRemoveChat = async (chatId: string) => {
    if (!project) return;
    await fetch(`/api/projects/${project.id}/chats`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId }),
    });
    setDeleteChatTarget(null);
    loadProject();
    onProjectChanged();
  };

  const handleDeleteChatPermanent = async (chatId: string) => {
    await fetch(`/api/chat?id=${chatId}`, { method: "DELETE" });
    setDeleteChatTarget(null);
    loadProject();
    onProjectChanged();
  };

  const openAddChatModal = async () => {
    setShowAddChatModal(true);
    try {
      const res = await fetch("/api/chat");
      if (res.ok) {
        const allChats: Chat[] = await res.json();
        const projectChatIds = new Set(project?.chats.map((c) => c.id) || []);
        setAvailableChats(allChats.filter((c) => !projectChatIds.has(c.id)));
      }
    } catch {}
  };

  const handleAddChat = async (chatId: string) => {
    if (!project) return;
    const res = await fetch(`/api/projects/${project.id}/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId }),
    });
    if (res.ok) {
      setShowAddChatModal(false);
      loadProject();
      onProjectChanged();
    }
  };

  const handleNewChat = async () => {
    if (!project) return;
    const res = await fetch(`/api/projects/${project.id}/chats/new`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newChatTitle || undefined }),
    });
    if (res.ok) {
      const chat = await res.json();
      setShowNewChat(false);
      setNewChatTitle("");
      onProjectChanged();
      onOpenChat({ id: chat.id, title: chat.title, messages: [] } as Chat, project.id);
    }
  };

  const c = {
    border: darkMode ? "border-[#202938]" : "border-gray-300",
    textMuted: darkMode ? "text-gray-400" : "text-gray-500",
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-400">Cargando...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-400">Proyecto no encontrado</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 lg:p-8 w-full">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft size={18} />
          Volver a proyectos
        </button>

        <div className="flex items-start justify-between mb-8">
          <div className="flex-1">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={handleRename}
                  onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setEditingName(false) }}
                  className="text-3xl font-bold bg-[#121824] border border-green-500 rounded-xl px-3 py-2 outline-none w-full max-w-md text-white"
                  autoFocus
                />
              </div>
            ) : (
              <h1
                className="text-3xl font-bold text-green-400 flex items-center gap-3 cursor-pointer hover:text-green-300 transition-colors"
                onClick={() => setEditingName(true)}
              >
                <Folder size={28} />
                {project.name}
              </h1>
            )}
            <p className="text-sm text-gray-500 mt-1">
              {project.chats.length} {(project.chats.length as number) === 1 ? "chat" : "chats"}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setShowNewChat(true)}
              className="bg-green-500 hover:bg-green-600 px-4 py-2 rounded-xl flex items-center gap-2 text-sm transition-colors"
            >
              <Plus size={16} /> Nuevo chat
            </button>
            <button
              onClick={openAddChatModal}
              className="bg-[#121824] border border-[#202938] hover:bg-[#1e293b] px-4 py-2 rounded-xl flex items-center gap-2 text-sm transition-colors"
            >
              <Plus size={16} /> Agregar chat
            </button>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="bg-red-500/10 border border-red-500 text-red-400 hover:bg-red-500/20 px-4 py-2 rounded-xl flex items-center gap-2 text-sm transition-colors"
            >
              <Trash2 size={16} /> Eliminar
            </button>
          </div>
        </div>

        <div className="bg-[#121824] border border-[#202938] rounded-2xl p-6 mb-8">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Instrucciones del proyecto (contexto compartido)
          </label>
          <p className="text-xs text-gray-500 mb-3">
            Este texto se inyectará como contexto del sistema en todos los chats de este proyecto.
          </p>
          <textarea
            value={editInstructions}
            onChange={(e) => setEditInstructions(e.target.value)}
            rows={5}
            className="w-full bg-[#030812] border border-[#202938] rounded-xl px-4 py-3 text-white outline-none focus:border-green-500 transition-colors resize-y text-sm"
            placeholder="Escribe las instrucciones o contexto compartido para los chats de este proyecto..."
          />
          <button
            onClick={handleSaveInstructions}
            disabled={savingInstructions}
            className="mt-3 bg-green-500 hover:bg-green-600 disabled:opacity-50 px-4 py-2 rounded-xl flex items-center gap-2 text-sm transition-colors"
          >
            <Save size={16} />
            {savingInstructions ? "Guardando..." : "Guardar instrucciones"}
          </button>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <MessageSquare size={20} />
            Chats del proyecto
          </h2>

          {project.chats.length === 0 ? (
            <p className="text-gray-500 text-sm">
              No hay chats en este proyecto. Agrega un chat existente o crea uno nuevo.
            </p>
          ) : (
            <div className="space-y-2">
              {project.chats.map((chat) => (
                <div key={chat.id} className="group flex items-center gap-2">
                  <button
                    onClick={() => onOpenChat(chat, project.id)}
                    className="flex-1 flex items-center gap-3 bg-[#121824] border border-[#202938] hover:border-green-500/50 rounded-xl px-4 py-3 transition-colors text-left"
                  >
                    <MessageSquare size={16} className="text-gray-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate text-white">{chat.title}</p>
                    </div>
                  </button>
                  <button
                    onClick={() => setDeleteChatTarget(chat)}
                    className="opacity-0 group-hover:opacity-100 p-2 text-gray-400 hover:text-red-400 transition-all"
                    title="Quitar del proyecto"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delete project modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowDeleteModal(false)}>
          <div className="bg-[#121824] border border-[#202938] rounded-2xl p-6 w-96" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2 text-white">Eliminar proyecto</h3>
            <p className="text-sm text-gray-400 mb-4">
              ¿Estás seguro de eliminar <strong>"{project.name}"</strong>? Los chats asociados volverán a estar disponibles en la lista general.
            </p>
            <div className="space-y-2">
              <button
                onClick={handleDelete}
                className="w-full py-3 px-4 rounded-xl bg-red-500/10 border border-red-500 text-sm text-red-400 hover:bg-red-500/20 transition-colors"
              >
                Sí, eliminar proyecto
              </button>
              <button
                onClick={() => setShowDeleteModal(false)}
                className="w-full py-2 text-sm text-gray-500 hover:underline"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete chat modal */}
      {deleteChatTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setDeleteChatTarget(null)}>
          <div className="bg-[#121824] border border-[#202938] rounded-2xl p-6 w-96" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2 text-white">"{deleteChatTarget.title}"</h3>
            <p className="text-sm text-gray-400 mb-4">
              ¿Qué deseas hacer con este chat?
            </p>
            <div className="space-y-2">
              <button
                onClick={() => handleRemoveChat(deleteChatTarget.id)}
                className="w-full py-3 px-4 rounded-xl bg-[#030812] border border-[#202938] text-sm hover:bg-[#1e293b] transition-colors text-left"
              >
                Quitar del proyecto
                <span className="block text-xs text-gray-500">El chat vuelve a estar disponible</span>
              </button>
              <button
                onClick={() => handleDeleteChatPermanent(deleteChatTarget.id)}
                className="w-full py-3 px-4 rounded-xl bg-red-500/10 border border-red-500 text-sm text-red-400 hover:bg-red-500/20 transition-colors text-left"
              >
                Eliminar conversación permanentemente
                <span className="block text-xs text-red-500/70">Se borrarán todos los mensajes</span>
              </button>
              <button
                onClick={() => setDeleteChatTarget(null)}
                className="w-full py-2 text-sm text-gray-500 hover:underline"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add chat modal */}
      {showAddChatModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowAddChatModal(false)}>
          <div className="bg-[#121824] border border-[#202938] rounded-2xl p-6 w-96 max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4 text-white">Agregar chat existente</h3>
            {availableChats.length === 0 ? (
              <p className="text-sm text-gray-500">No hay chats disponibles para agregar</p>
            ) : (
              <div className="space-y-1">
                {availableChats.map((chat) => (
                  <button
                    key={chat.id}
                    onClick={() => handleAddChat(chat.id)}
                    className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-[#1e293b] transition-colors text-white"
                  >
                    {chat.title}
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setShowAddChatModal(false)} className="mt-4 text-sm text-gray-500 hover:underline">Cancelar</button>
          </div>
        </div>
      )}

      {/* New chat modal */}
      {showNewChat && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowNewChat(false)}>
          <div className="bg-[#121824] border border-[#202938] rounded-2xl p-6 w-96" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4 text-white">Nuevo chat en "{project.name}"</h3>
            <input
              type="text"
              placeholder="Título del chat (opcional)"
              value={newChatTitle}
              onChange={(e) => setNewChatTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleNewChat(); if (e.key === "Escape") setShowNewChat(false) }}
              className="w-full bg-[#030812] border border-[#202938] rounded-xl px-4 py-3 text-white outline-none focus:border-green-500 transition-colors mb-4"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowNewChat(false)} className="px-4 py-2 rounded-xl bg-gray-700 hover:bg-gray-600 text-sm">Cancelar</button>
              <button onClick={handleNewChat} className="px-4 py-2 rounded-xl bg-green-500 hover:bg-green-600 text-sm">Crear</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

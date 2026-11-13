"use client";

import { useEffect, useState, useCallback } from "react";
import { Folder, Plus, Trash2, MessageSquare, X, ArrowLeft, Save } from "lucide-react";
import type { Chat, Project } from "@/types";

type ProyectoConChats = Project & {
  chats: Chat[];
};

type Props = {
  projectId: string;
  onBack: () => void;
  onOpenChat: (chat: Chat, projectId: string) => void;
  onProjectChanged: () => void;
};

export default function ProjectDetailView({ projectId, onBack, onOpenChat, onProjectChanged }: Props) {
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

  const loadProject = useCallback(async () => {
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
  }, [projectId]);

  // Fetch inicial diferido a una macrotarea: evita setState síncrono dentro
  // del efecto (react-hooks/set-state-in-effect) sin cambiar comportamiento.
  // TODO(Fase 2): migrar a fetching dirigido por eventos/Suspense.
  useEffect(() => {
    const id = setTimeout(() => { void loadProject(); }, 0);
    return () => clearTimeout(id);
  }, [loadProject]);

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

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[var(--chat-muted)]">Cargando...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[var(--chat-muted)]">Proyecto no encontrado</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <div className="max-w-4xl mx-auto w-full px-6 pb-6 pt-16 lg:px-8 lg:pb-8 lg:pt-20">
        <button
          onClick={onBack}
          className="mb-6 inline-flex items-center gap-2 text-[var(--chat-muted)] transition-colors hover:text-[var(--chat-text)]"
        >
          <ArrowLeft size={18} strokeWidth={1.8} />
          Volver a proyectos
        </button>

        <div className="mb-8 flex items-start justify-between gap-4">
          <div className="flex-1">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={handleRename}
                  onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setEditingName(false) }}
                  className="surface-field w-full max-w-md rounded-xl px-3 py-2 text-3xl font-bold outline-none"
                  autoFocus
                />
              </div>
            ) : (
              <h1
                className="flex cursor-pointer items-center gap-3 text-3xl font-bold text-green-400 transition-colors hover:text-green-300"
                onClick={() => setEditingName(true)}
              >
                <Folder size={28} />
                {project.name}
              </h1>
            )}
            <p className="mt-1 text-sm text-[var(--chat-muted)]">
              {project.chats.length} {(project.chats.length as number) === 1 ? "chat" : "chats"}
            </p>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <button
              onClick={() => setShowNewChat(true)}
              className="accent-button flex items-center gap-2 rounded-xl px-4 py-2 text-sm transition-colors"
            >
              <Plus size={16} /> Nuevo chat
            </button>
            <button
              onClick={openAddChatModal}
              className="modal-secondary-button flex items-center gap-2 rounded-xl px-4 py-2 text-sm transition-colors"
            >
              <Plus size={16} /> Agregar chat
            </button>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="danger-soft-button flex items-center gap-2 rounded-xl px-4 py-2 text-sm transition-colors"
            >
              <Trash2 size={16} /> Eliminar
            </button>
          </div>
        </div>

        <div className="surface-card mb-8 rounded-2xl p-6">
          <label className="mb-2 block text-sm font-medium text-[var(--chat-text)]">
            Instrucciones del proyecto (contexto compartido)
          </label>
          <p className="mb-3 text-xs text-[var(--chat-muted)]">
            Este texto se inyectará como contexto del sistema en todos los chats de este proyecto.
          </p>
          <textarea
            value={editInstructions}
            onChange={(e) => setEditInstructions(e.target.value)}
            rows={5}
            className="surface-field w-full resize-y rounded-xl px-4 py-3 text-sm outline-none transition-colors"
            placeholder="Escribe las instrucciones o contexto compartido para los chats de este proyecto..."
          />
          <button
            onClick={handleSaveInstructions}
            disabled={savingInstructions}
            className="accent-button mt-3 flex items-center gap-2 rounded-xl px-4 py-2 text-sm transition-colors"
          >
            <Save size={16} />
            {savingInstructions ? "Guardando..." : "Guardar instrucciones"}
          </button>
        </div>

        <div>
          <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold">
            <MessageSquare size={20} />
            Chats del proyecto
          </h2>

          {project.chats.length === 0 ? (
            <p className="text-sm text-[var(--chat-muted)]">
              No hay chats en este proyecto. Agrega un chat existente o crea uno nuevo.
            </p>
          ) : (
            <div className="space-y-2">
              {project.chats.map((chat) => (
                <div key={chat.id} className="group flex items-center gap-2">
                  <button
                    onClick={() => onOpenChat(chat, project.id)}
                    className="surface-card flex flex-1 items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:border-[var(--chat-accent-border)]"
                  >
                    <MessageSquare size={16} className="shrink-0 text-[var(--chat-muted)]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--chat-text)]">{chat.title}</p>
                    </div>
                  </button>
                  <button
                    onClick={() => setDeleteChatTarget(chat)}
                    className="p-2 text-[var(--chat-muted)] opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowDeleteModal(false)}>
          <div className="surface-modal w-full max-w-96 rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-lg font-semibold text-[var(--chat-text)]">Eliminar proyecto</h3>
            <p className="mb-4 text-sm text-[var(--chat-muted)]">
              ¿Estás seguro de eliminar <strong>&quot;{project.name}&quot;</strong>? Los chats asociados volverán a estar disponibles en la lista general.
            </p>
            <div className="space-y-2">
              <button
                onClick={handleDelete}
                className="danger-soft-button w-full rounded-xl px-4 py-3 text-sm transition-colors"
              >
                Sí, eliminar proyecto
              </button>
              <button
                onClick={() => setShowDeleteModal(false)}
                className="w-full py-2 text-sm text-[var(--chat-muted)] hover:underline"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete chat modal */}
      {deleteChatTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setDeleteChatTarget(null)}>
          <div className="surface-modal w-full max-w-96 rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-lg font-semibold text-[var(--chat-text)]">&quot;{deleteChatTarget.title}&quot;</h3>
            <p className="mb-4 text-sm text-[var(--chat-muted)]">
              ¿Qué deseas hacer con este chat?
            </p>
            <div className="space-y-2">
              <button
                onClick={() => handleRemoveChat(deleteChatTarget.id)}
                className="surface-field w-full rounded-xl px-4 py-3 text-left text-sm transition-colors hover:bg-[var(--sidebar-hover)]"
              >
                Quitar del proyecto
                <span className="block text-xs text-[var(--chat-muted)]">El chat vuelve a estar disponible</span>
              </button>
              <button
                onClick={() => handleDeleteChatPermanent(deleteChatTarget.id)}
                className="danger-soft-button w-full rounded-xl px-4 py-3 text-left text-sm transition-colors"
              >
                Eliminar conversación permanentemente
                <span className="block text-xs text-[var(--chat-danger)] opacity-70">Se borrarán todos los mensajes</span>
              </button>
              <button
                onClick={() => setDeleteChatTarget(null)}
                className="w-full py-2 text-sm text-[var(--chat-muted)] hover:underline"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add chat modal */}
      {showAddChatModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowAddChatModal(false)}>
          <div className="surface-modal max-h-[70vh] w-full max-w-96 overflow-y-auto rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-semibold text-[var(--chat-text)]">Agregar chat existente</h3>
            {availableChats.length === 0 ? (
              <p className="text-sm text-[var(--chat-muted)]">No hay chats disponibles para agregar</p>
            ) : (
              <div className="space-y-1">
                {availableChats.map((chat) => (
                  <button
                    key={chat.id}
                    onClick={() => handleAddChat(chat.id)}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--chat-text)] transition-colors hover:bg-[var(--sidebar-hover)]"
                  >
                    {chat.title}
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setShowAddChatModal(false)} className="mt-4 text-sm text-[var(--chat-muted)] hover:underline">Cancelar</button>
          </div>
        </div>
      )}

      {/* New chat modal */}
      {showNewChat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowNewChat(false)}>
          <div className="surface-modal w-full max-w-96 rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-semibold text-[var(--chat-text)]">Nuevo chat en &quot;{project.name}&quot;</h3>
            <input
              type="text"
              placeholder="Título del chat (opcional)"
              value={newChatTitle}
              onChange={(e) => setNewChatTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleNewChat(); if (e.key === "Escape") setShowNewChat(false) }}
              className="surface-field mb-4 w-full rounded-xl px-4 py-3 outline-none transition-colors"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNewChat(false)} className="modal-secondary-button rounded-xl px-4 py-2 text-sm">Cancelar</button>
              <button onClick={handleNewChat} className="accent-button rounded-xl px-4 py-2 text-sm">Crear</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

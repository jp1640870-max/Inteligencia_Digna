"use client";

import { useCallback, useEffect, useRef } from "react";
import { PanelLeft, Search } from "lucide-react";
import Sidebar from "./components/Sidebar";
import ChatMessage from "./components/ChatMessage";
import ChatInput from "./components/ChatInput";
import ProjectDetailView from "./components/ProjectDetailView";
import ProjectsListView from "./components/ProjectsListView";
import RenameChatModal from "./components/modals/RenameChatModal";
import AddToProjectModal from "./components/modals/AddToProjectModal";
import { useChatStore } from "@/lib/stores/chat-store";
import { useProjectStore } from "@/lib/stores/project-store";
import { useUIStore } from "@/lib/stores/ui-store";
import { useAuthStore } from "@/lib/stores/auth-store";
import AnnouncementBanner from "./components/announcements/AnnouncementBanner";

export default function Home() {
  // ─── Stores ───
  const messages = useChatStore((s) => s.messages);
  const loading = useChatStore((s) => s.loading);
  const searching = useChatStore((s) => s.searching);
  const chatId = useChatStore((s) => s.chatId);
  const input = useChatStore((s) => s.input);
  const images = useChatStore((s) => s.images);
  const files = useChatStore((s) => s.files);
  const isEditMode = useChatStore((s) => s.isEditMode);
  const editInstruction = useChatStore((s) => s.editInstruction);
  const editLoading = useChatStore((s) => s.editLoading);
  const editFile = useChatStore((s) => s.editFile);
  const typeChoiceFile = useChatStore((s) => s.typeChoiceFile);
  const autoScroll = useChatStore((s) => s.autoScroll);
  const setInput = useChatStore((s) => s.setInput);
  const setImages = useChatStore((s) => s.setImages);
  const setFiles = useChatStore((s) => s.setFiles);
  const setEditInstruction = useChatStore((s) => s.setEditInstruction);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const handleStop = useChatStore((s) => s.handleStop);
  const handleRegenerate = useChatStore((s) => s.handleRegenerate);
  const handleEditMessage = useChatStore((s) => s.handleEditMessage);
  const handlePaste = useChatStore((s) => s.handlePaste);
  const handleFilesSelected = useChatStore((s) => s.handleFilesSelected);
  const handleEditFileToggle = useChatStore((s) => s.handleEditFileToggle);
  const setEditFile = useChatStore((s) => s.setEditFile);
  const setTypeChoiceFile = useChatStore((s) => s.setTypeChoiceFile);
  const handleEditFlow = useChatStore((s) => s.handleEditFlow);
  const setAutoScroll = useChatStore((s) => s.setAutoScroll);
  const loadChats = useChatStore((s) => s.loadChats);
  const handleEditFileSelected = useChatStore((s) => s.handleEditFileSelected);

  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const loadProjects = useProjectStore((s) => s.loadProjects);

  const darkMode = useUIStore((s) => s.darkMode);
  const view = useUIStore((s) => s.view);
  const setView = useUIStore((s) => s.setView);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const setShowUserMenu = useUIStore((s) => s.setShowUserMenu);
  const showUserMenu = useUIStore((s) => s.showUserMenu);
  const renameChatId = useUIStore((s) => s.renameChatId);
  const showAddToProjectChatId = useUIStore((s) => s.showAddToProjectChatId);

  const user = useAuthStore((s) => s.user);
  const loadUser = useAuthStore((s) => s.loadUser);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ─── Init ───
  useEffect(() => {
    loadChats();
    loadProjects();
    loadUser();

    const params = new URLSearchParams(window.location.search);
    const projectId = params.get("projectId");
    if (projectId) {
      useProjectStore.getState().setCurrentProjectId(projectId);
    }
  }, []);

  // ─── Close user menu on outside click ───
  useEffect(() => {
    const close = () => setShowUserMenu(false);
    if (showUserMenu) document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [showUserMenu]);

  // ─── Auto-scroll ───
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
  }, []);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, autoScroll]);

  // ─── Refs for sending ───
  const currentProjectIdRef = useRef(currentProjectId);
  currentProjectIdRef.current = currentProjectId;

  // ─── Colors ───
  const colors = {
    bg: darkMode ? "bg-[#030812]" : "bg-white",
    card: darkMode ? "bg-[#121824]" : "bg-white",
    text: darkMode ? "text-white" : "text-gray-900",
    muted: darkMode ? "text-gray-400" : "text-gray-500",
    border: darkMode ? "border-[#202938]" : "border-gray-300",
  };

  // ─── Handlers ───
  const handleSend = () => {
    if (isEditMode) {
      if (!editFile || !editInstruction.trim()) return;
      handleEditFlow(editFile, editInstruction, currentProjectId);
    } else {
      sendMessage(currentProjectId);
    }
  };

  const handleTypeChoiceAction = (file: File, action: "analyze" | "edit") => {
    setTypeChoiceFile(null);
    if (action === "edit") {
      setEditFile(file);
      handleEditFileToggle();
    } else {
      setFiles([...files, { file, name: file.name, size: file.size }]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files);
    const editable = dropped.filter((f) => /\.(xlsx|xls|docx|pdf)$/i.test(f.name));
    const others = dropped.filter((f) => !/\.(xlsx|xls|docx|pdf)$/i.test(f.name));

    others.forEach((file) => {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => setImages([...images, reader.result as string]);
        reader.readAsDataURL(file);
      } else {
        setFiles([...files, { file, name: file.name, size: file.size }]);
      }
    });

    if (editable.length > 0) setTypeChoiceFile(editable[0]);
  };

  return (
    <main
      className={`h-screen flex ${colors.bg} ${colors.text} overflow-hidden`}
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={handleDrop}
    >
      <Sidebar />

      {/* ─── Projects List View ─── */}
      {view.type === "projects" && (
        <ProjectsListView
          darkMode={darkMode}
          onOpenProject={(id) => setView({ type: "project", id })}
          onBack={() => setView({ type: "chat" })}
          onProjectChanged={() => loadProjects()}
        />
      )}

      {/* ─── Project Detail View ─── */}
      {view.type === "project" && (
        <ProjectDetailView
          projectId={view.id}
          darkMode={darkMode}
          onBack={() => setView({ type: "chat" })}
          onOpenChat={(chat, projectId) => {
            setView({ type: "chat" });
            useProjectStore.getState().setCurrentProjectId(projectId);
            useChatStore.getState().openChat(chat);
          }}
          onProjectChanged={() => loadProjects()}
        />
      )}

      {/* ─── Chat View ─── */}
      {view.type === "chat" && (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Announcements banner */}
          <AnnouncementBanner />

          {/* Header */}
          <div className="flex items-center gap-3 px-4 pt-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className={`lg:hidden p-2 rounded-xl hover:bg-[#1e293b] transition ${colors.card}`}
              title="Menú"
            >
              <PanelLeft size={20} />
            </button>
            <div className="text-center flex-1">
              {currentProjectId && (
                <span className="text-xs text-green-400 block">Proyecto activo</span>
              )}
              <h1 className="text-2xl lg:text-4xl font-bold text-green-400">
                Inteligencia Digna
              </h1>
              <p className={`text-sm ${colors.muted}`}>by Salud Digna</p>
            </div>

            {/* User menu */}
            {user ? (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowUserMenu(!showUserMenu); }}
                  className="w-9 h-9 rounded-full overflow-hidden border-2 border-green-500 hover:opacity-80 transition"
                >
                  {user.picture ? (
                    <img src={user.picture} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-green-600 flex items-center justify-center text-sm font-bold text-white">
                      {(user.name || user.email)[0].toUpperCase()}
                    </div>
                  )}
                </button>
                {showUserMenu && (
                  <div className="absolute right-0 mt-2 w-56 bg-[#121824] border border-[#202938] rounded-xl p-2 shadow-xl z-50" onClick={(e) => e.stopPropagation()}>
                    <p className="px-3 py-1 text-sm text-white font-medium truncate">{user.name || user.email}</p>
                    <p className="px-3 py-1 text-xs text-gray-400 truncate">{user.email}</p>
                    <hr className="border-[#202938] my-1" />
                    <a href="/api/auth/logout" className="block w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-[#1e293b] rounded-lg">
                      Cerrar sesión
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <div className="w-10 lg:hidden" />
            )}
          </div>

          {/* Empty state */}
          {messages.length === 0 && (
            <div className="flex-1 flex items-center justify-center">
              <div className={`p-6 rounded-2xl text-center mx-4 ${colors.card}`}>
                <h2>¡Hola! Soy Inteligencia Digna</h2>
                <p className={`mt-2 ${colors.muted}`}>¿En qué puedo ayudarte hoy?</p>
              </div>
            </div>
          )}

          {/* Messages */}
          <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">
            {messages.map((m, i) => (
              <ChatMessage
                key={m.id ?? i}
                message={m}
                index={i}
                isLastAi={m.role === "ai" && i === messages.length - 1 && messages.length >= 2}
                onEdit={m.role === "user" ? (index, text) => handleEditMessage(index, text, currentProjectId) : undefined}
                onRegenerate={
                  m.role === "ai" && i === messages.length - 1 && messages.length >= 2
                    ? () => handleRegenerate(currentProjectId)
                    : undefined
                }
                darkMode={darkMode}
              />
            ))}

            {searching && (
              <div className="flex items-center gap-2 mb-4 ml-1 text-green-400">
                <Search size={16} className="animate-pulse" />
                <span className="text-sm font-medium">Buscando en la web...</span>
                <span className="flex gap-0.5">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </span>
              </div>
            )}

            {loading && !searching && (
              <div className="flex items-center gap-1.5 mb-4 ml-1">
                <video src="/typing.mp4" autoPlay loop muted playsInline className="h-8" />
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Chat Input */}
          <ChatInput
            input={input}
            images={images}
            files={files.map((f) => ({ name: f.name, size: f.size }))}
            loading={loading || editLoading}
            onInputChange={setInput}
            onSend={handleSend}
            onStop={handleStop}
            onPaste={handlePaste}
            onRemoveImage={(i) => setImages(images.filter((_, idx) => idx !== i))}
            onRemoveFile={(i) => setFiles(files.filter((_, idx) => idx !== i))}
            onFilesSelected={handleFilesSelected}
            onEditFile={handleEditFileToggle}
            isEditMode={isEditMode}
            editInstruction={editInstruction}
            onEditInstructionChange={setEditInstruction}
            onEditFileSelected={handleEditFileSelected}
            typeChoiceFile={typeChoiceFile}
            onTypeChoiceAction={handleTypeChoiceAction}
            onDismissTypeChoice={() => setTypeChoiceFile(null)}
            onShowTypeChoice={(file) => setTypeChoiceFile(file)}
          />
        </div>
      )}

      {/* ─── Modals ─── */}
      {renameChatId && <RenameChatModal />}
      {showAddToProjectChatId && <AddToProjectModal />}

      <style jsx>{`
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: ${darkMode ? "#030812" : "#f1f5f9"}; }
        ::-webkit-scrollbar-thumb { background: ${darkMode ? "#1e293b" : "#cbd5e1"}; border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: ${darkMode ? "#334155" : "#94a3b8"}; }
        @keyframes bounce {
          0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-4px); }
        }
        .animate-bounce { animation: bounce 1.2s infinite; }
      `}</style>
    </main>
  );
}

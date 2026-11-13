"use client";

import { useCallback, useEffect, useRef } from "react";
import Image from "next/image";
import { ArrowDown, Search } from "lucide-react";
import Sidebar from "./components/Sidebar";
import ViewSwitcher from "./components/ViewSwitcher";
import ChatMessage from "./components/ChatMessage";
import ChatInput from "./components/ChatInput";
import ProjectDetailView from "./components/ProjectDetailView";
import ProjectsListView from "./components/ProjectsListView";
import RenameChatModal from "./components/modals/RenameChatModal";
import AddToProjectModal from "./components/modals/AddToProjectModal";
import { useChatStore } from "@/lib/stores/chat-store";
import { messageKey } from "@/lib/message-key";
import { useProjectStore } from "@/lib/stores/project-store";
import { useUIStore } from "@/lib/stores/ui-store";
import { useAuthStore } from "@/lib/stores/auth-store";
import AnnouncementBanner from "./components/announcements/AnnouncementBanner";

const SUGGESTIONS = [
  "Resume un documento que te comparta",
  "Compara opciones y arma una tabla",
  "Busca información actualizada en la web",
];

export default function Home() {
  // ─── Stores ───
  const messages = useChatStore((s) => s.messages);
  const loading = useChatStore((s) => s.loading);
  const searching = useChatStore((s) => s.searching);
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
  const exportMessageAsPdf = useChatStore((s) => s.exportMessageAsPdf);
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
  const renameChatId = useUIStore((s) => s.renameChatId);
  const showAddToProjectChatId = useUIStore((s) => s.showAddToProjectChatId);

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
  }, [loadChats, loadProjects, loadUser]);

  // ─── Auto-scroll ───
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
  }, [setAutoScroll]);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, autoScroll]);

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

  const handleScrollToBottom = () => {
    setAutoScroll(true);
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  return (
    <div className={`app-aurora ${darkMode ? "chat-theme-dark" : "chat-theme-light"}`}>
      <main
        className="app-window chat-app flex"
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={handleDrop}
      >
        <Sidebar />

      <div className="app-surface relative flex min-h-0 min-w-0 flex-1 flex-col">
        <ViewSwitcher />

        {/* ─── Projects List View ─── */}
      {view.type === "projects" && (
        <ProjectsListView
          onOpenProject={(id) => setView({ type: "project", id })}
          onProjectChanged={() => loadProjects()}
        />
      )}

      {/* ─── Project Detail View ─── */}
      {view.type === "project" && (
        <ProjectDetailView
          projectId={view.id}
          onBack={() => setView({ type: "projects" })}
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
        <div className="chat-view">
          <AnnouncementBanner />

          <div ref={scrollRef} onScroll={handleScroll} className="chat-scroll">
            <div className="chat-messages">
              {messages.length === 0 ? (
                <div className="chat-empty">
                  <div className="chat-empty-mark" aria-hidden="true">
                    <Image
                      src="/logo.png"
                      alt=""
                      width={52}
                      height={48}
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <h2>¿En qué puedo ayudarte hoy?</h2>
                  <p>
                    Pregunta, compara, analiza archivos o pide que genere un documento.
                  </p>
                  <div className="chat-suggestions">
                    {SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => setInput(suggestion)}
                        className="chat-suggestion"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((m, i) => {
                  const isLastMessage = i === messages.length - 1;
                  const isLastAi = m.role === "ai" && isLastMessage && messages.length >= 2;

                  return (
                    <ChatMessage
                      key={messageKey(m, i)}
                      message={m}
                      index={i}
                      isLastAi={isLastAi}
                      streaming={loading && !searching && isLastAi}
                      onEdit={
                        m.role === "user"
                          ? (index, text) => handleEditMessage(index, text, currentProjectId)
                          : undefined
                      }
                      onRegenerate={isLastAi ? () => handleRegenerate(currentProjectId) : undefined}
                      onExportPdf={
                        m.role === "ai" && !loading ? () => exportMessageAsPdf(i) : undefined
                      }
                      darkMode={darkMode}
                    />
                  );
                })
              )}

              {searching && (
                <div className="chat-searching">
                  <Search size={16} className="chat-searching-icon" aria-hidden="true" />
                  <span>Buscando en la web…</span>
                  <span className="chat-search-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </div>

          <button
            type="button"
            onClick={handleScrollToBottom}
            className={`chat-scroll-bottom ${!autoScroll && messages.length > 0 ? "is-visible" : ""}`}
            aria-label="Ir al final de la conversación"
            aria-hidden={autoScroll || messages.length === 0}
            tabIndex={autoScroll || messages.length === 0 ? -1 : 0}
            title="Ir al final"
          >
            <ArrowDown size={16} />
          </button>

          <ChatInput
            input={input}
            images={images}
            files={files.map((f) => ({ name: f.name, size: f.size }))}
            loading={loading || editLoading}
            darkMode={darkMode}
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
      </div>

        {/* ─── Modals ─── */}
        {renameChatId && <RenameChatModal />}
        {showAddToProjectChatId && <AddToProjectModal />}
      </main>
    </div>
  );
}

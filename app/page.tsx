"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowDown, Brain, LifeBuoy, Search } from "lucide-react";
import Sidebar from "./components/Sidebar";
import ViewSwitcher from "./components/ViewSwitcher";
import ChatMessage from "./components/ChatMessage";
import ChatInput from "./components/ChatInput";
import SupportEscalationModal from "./components/SupportEscalationModal";
import AgentsView from "./components/AgentsView";
import LibraryView from "./components/LibraryView";
import ProjectDetailView from "./components/ProjectDetailView";
import ProjectsListView from "./components/ProjectsListView";
import RenameChatModal from "./components/modals/RenameChatModal";
import AddToProjectModal from "./components/modals/AddToProjectModal";
import { useChatStore } from "@/lib/stores/chat-store";
import { messageKey } from "@/lib/message-key";
import { useProjectStore } from "@/lib/stores/project-store";
import { useUIStore } from "@/lib/stores/ui-store";
import { useAuthStore } from "@/lib/stores/auth-store";
import { SUPPORT_AGENT } from "@/lib/official-agents";
import AnnouncementBanner from "./components/announcements/AnnouncementBanner";

const SUGGESTIONS = [
  "Resume un documento que te comparta",
  "Compara opciones y arma una tabla",
  "Busca información actualizada en la web",
];

const SUPPORT_SUGGESTIONS = [
  "No puedo iniciar sesión en mi cuenta",
  "¿Cómo restablezco mi contraseña de Windows?",
  "La VPN no conecta desde mi laptop",
];

const HEART_SUGGESTIONS = [
  "¿Qué puedes hacer?",
  "Ayúdame con una tarea",
  "Explícame un tema",
];

export default function Home() {
  // ─── Stores ───
  const messages = useChatStore((s) => s.messages);
  const agentKey = useChatStore((s) => s.agentKey);
  const heartId = useChatStore((s) => s.heartId);
  const heartName = useChatStore((s) => s.heartName);
  const loading = useChatStore((s) => s.loading);
  const searching = useChatStore((s) => s.searching);
  const input = useChatStore((s) => s.input);
  const images = useChatStore((s) => s.images);
  const files = useChatStore((s) => s.files);
  const imageMode = useChatStore((s) => s.imageMode);
  const parentImageId = useChatStore((s) => s.parentImageId);
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
  const refreshImageJobs = useChatStore((s) => s.refreshImageJobs);
  const cancelImageJob = useChatStore((s) => s.cancelImageJob);
  const prepareImageEdit = useChatStore((s) => s.prepareImageEdit);
  const exitImageMode = useChatStore((s) => s.exitImageMode);

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
  const [escalationOpen, setEscalationOpen] = useState(false);

  const isSupportChat = agentKey === SUPPORT_AGENT.id;
  const isHeartChat = Boolean(heartId) || Boolean(agentKey);
  const emptyTitle = isSupportChat
    ? "¿Cuál es tu incidencia?"
    : isHeartChat
      ? `Conversa con ${heartName || "tu Heart"}`
      : "¿En qué puedo ayudarte hoy?";
  const emptyDescription = isSupportChat
    ? "Cuenta qué está pasando. Usaré solo la información disponible y te diré cuando no sea suficiente."
    : isHeartChat
      ? "Este Heart responde con sus instrucciones y las herramientas que tenga habilitadas."
      : "Pregunta, compara, analiza archivos o pide que genere un documento.";
  const emptySuggestions = isSupportChat
    ? SUPPORT_SUGGESTIONS
    : isHeartChat
      ? HEART_SUGGESTIONS
      : SUGGESTIONS;

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
    if (params.get("view") === "library") {
      setView({ type: "library" });
    }
  }, [loadChats, loadProjects, loadUser, setView]);

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

  // Los trabajos viven en el servidor. El cliente solo sondea mientras haya
  // alguno activo; al recargar, la hidratación de mensajes los recupera.
  const hasActiveImageJobs = messages.some(
    (message) =>
      message.imageJob &&
      !["completed", "failed", "cancelled"].includes(message.imageJob.status),
  );
  useEffect(() => {
    if (!hasActiveImageJobs) return;
    void refreshImageJobs();
    const timer = window.setInterval(() => {
      void refreshImageJobs();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [hasActiveImageJobs, refreshImageJobs]);

  // ─── Handlers ───
  const handleSend = () => {
    if (isEditMode && !isHeartChat) {
      if (!editFile || !editInstruction.trim()) return;
      handleEditFlow(editFile, editInstruction, currentProjectId);
    } else {
      sendMessage(currentProjectId);
    }
  };

  const handleTypeChoiceAction = (file: File, action: "analyze" | "edit") => {
    setTypeChoiceFile(null);
    if (action === "edit" && !isHeartChat) {
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

    if (editable.length > 0) {
      if (isHeartChat) {
        setFiles([
          ...files,
          ...editable.map((file) => ({
            file,
            name: file.name,
            size: file.size,
          })),
        ]);
      } else {
        setTypeChoiceFile(editable[0]);
      }
    }
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

        {/* ─── Agents View ─── */}
      {view.type === "agents" && <AgentsView />}

      {/* ─── Library View ─── */}
      {view.type === "library" && <LibraryView />}

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

          {isSupportChat && (
            <div
              role="status"
              className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] px-4 py-3"
            >
              <div className="flex min-w-0 items-start gap-3">
                <LifeBuoy size={18} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-[var(--chat-text)]">
                    {SUPPORT_AGENT.name} · agente oficial
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--chat-muted)]">
                    Respuestas basadas en la información disponible. Si no hay evidencia suficiente, lo indicaré.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEscalationOpen(true)}
                disabled={messages.length === 0 || loading}
                className="shrink-0 rounded-lg border border-emerald-500/30 px-3 py-1.5 text-[12px] font-medium text-emerald-300 transition-colors hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Preparar escalamiento
              </button>
            </div>
          )}

          {isHeartChat && !isSupportChat && (
            <div
              role="status"
              className="mx-4 mt-3 flex items-start gap-3 rounded-xl border border-[var(--chat-accent-border)] bg-[var(--chat-accent-soft)] px-4 py-3"
            >
              <Brain
                size={18}
                className="mt-0.5 shrink-0 text-[var(--chat-accent)]"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[var(--chat-text)]">
                  {heartName || "Heart"} · Heart
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--chat-muted)]">
                  Conversación con un Heart. Responde según sus instrucciones y
                  herramientas habilitadas.
                </p>
              </div>
            </div>
          )}

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
                  <h2>{emptyTitle}</h2>
                  <p>{emptyDescription}</p>
                  <div className="chat-suggestions">
                    {emptySuggestions.map((suggestion) => (
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
                      onCancelImageJob={cancelImageJob}
                      onImageVariant={(image) => prepareImageEdit(image, "variant")}
                      onImageEdit={(image) => prepareImageEdit(image, "edit")}
                      agentName={
                        isSupportChat
                          ? SUPPORT_AGENT.name
                          : isHeartChat
                            ? heartName || "Heart"
                            : undefined
                      }
                      agentBadge={
                        isSupportChat
                          ? "OFICIAL"
                          : isHeartChat
                            ? "HEART"
                            : undefined
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
            imageMode={imageMode}
            hasParentImage={Boolean(parentImageId)}
            onExitImageMode={exitImageMode}
            allowDocumentEdit={!isHeartChat}
          />
        </div>
      )}
      </div>

        {/* ─── Modals ─── */}
        {renameChatId && <RenameChatModal />}
        {showAddToProjectChatId && <AddToProjectModal />}
        {escalationOpen && (
          <SupportEscalationModal
            onClose={() => setEscalationOpen(false)}
          />
        )}
      </main>
    </div>
  );
}

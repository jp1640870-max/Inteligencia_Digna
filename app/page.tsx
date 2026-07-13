"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { PanelLeft, Search } from "lucide-react";
import Sidebar from "./components/Sidebar";
import ChatMessage from "./components/ChatMessage";
import ChatInput from "./components/ChatInput";
import ProjectDetailView from "./components/ProjectDetailView";
import ProjectsListView from "./components/ProjectsListView";
import type { Msg, Chat, Project, EditResult, SearchResult } from "@/types";

type FileItem = {
  file: File;
  name: string;
  size: number;
};

type UserInfo = {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
};

export default function Home() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [renameChat, setRenameChat] = useState<Chat | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [dragging, setDragging] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);

  // Edit mode state
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editInstruction, setEditInstruction] = useState("");
  const [isEditMode, setIsEditMode] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [typeChoiceFile, setTypeChoiceFile] = useState<File | null>(null);

  // Project state
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectChats, setProjectChats] = useState<Record<string, Chat[]>>({});
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [showNewProjectInput, setShowNewProjectInput] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [showAddChatProjectId, setShowAddChatProjectId] = useState<string | null>(null);
  type ViewState = { type: "chat" } | { type: "projects" } | { type: "project"; id: string };
  const [view, setView] = useState<ViewState>({ type: "chat" });

  const [chatId, setChatId] = useState(uuidv4());
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [searching, setSearching] = useState(false);

  const SEARCH_KEYWORDS = [
    "noticias", "noticia", "últimas", "ultimas", "última", "ultima",
    "clima", "temperatura", "lluvia",
    "hoy", "ahora", "actual", "reciente", "recién", "recien",
    "2026", "2025", "2027",
    "elecciones", "presidente", "gobierno", "política", "politica",
    "economía", "economia", "inflación", "inflacion", "dólar", "dolar", "peso",
    "covid", "pandemia", "vacuna",
    "facebook", "google", "twitter", "whatsapp",
    "resultados", "partido", "fútbol", "futbol",
    "precio", "cuánto", "cuanto", "cuesta", "vale",
    "terremoto", "sismo", "huracán", "huracan",
  ];

  function checkAutoSearch(text: string): boolean {
    const lower = text.toLowerCase();
    return SEARCH_KEYWORDS.some((kw) => lower.includes(kw));
  }

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
  }, []);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, autoScroll]);

  const colors = {
    bg: darkMode ? "bg-[#030812]" : "bg-white",
    sidebar: darkMode ? "bg-[#0d131d]" : "bg-gray-100",
    card: darkMode ? "bg-[#121824]" : "bg-white",
    text: darkMode ? "text-white" : "text-gray-900",
    muted: darkMode ? "text-gray-400" : "text-gray-500",
    border: darkMode ? "border-[#202938]" : "border-gray-300",
  };

  const cargarChats = async () => {
    try {
      const res = await fetch("/api/chat");
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      setChats(Array.isArray(data) ? data : []);
    } catch {
      setChats([]);
    }
  };

  const cargarProjects = async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) setProjects(await res.json());
    } catch {}
  };

  const cargarProjectChats = async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/chats`);
      if (res.ok) {
        const data = await res.json();
        setProjectChats((prev) => ({ ...prev, [projectId]: data }));
      }
    } catch {}
  };

  useEffect(() => {
    cargarChats();
    cargarProjects();
    fetch("/api/auth/me").then((r) => r.ok ? r.json() : null).then(setUser);

    const params = new URLSearchParams(window.location.search);
    const projectId = params.get("projectId");
    if (projectId) {
      setCurrentProjectId(projectId);
    }
  }, []);

  useEffect(() => {
    const close = () => setShowUserMenu(false);
    if (showUserMenu) document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [showUserMenu]);

  const nuevoChat = () => {
    setMessages([]);
    setInput("");
    setImages([]);
    setFiles([]);
    const newId = uuidv4();
    setChatId(newId);

    if (currentProjectId) {
      fetch("/api/projects/" + currentProjectId + "/chats/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Nueva conversación" }),
      }).then(() => {
        cargarProjectChats(currentProjectId);
        cargarProjects();
      });
    }
  };

  const abrirChat = (chat: Chat) => {
    setChatId(chat.id);
    setMessages(chat.messages);
  };

  const abrirChatEnProject = (chat: Chat, projectId: string) => {
    setView({ type: "chat" });
    setCurrentProjectId(projectId);
    setChatId(chat.id);
    const fullChat = chats.find((c) => c.id === chat.id);
    setMessages(fullChat ? fullChat.messages : []);
    window.history.replaceState(null, "", `/?projectId=${projectId}`);
  };

  const eliminarChat = async (id: string) => {
    const res = await fetch(`/api/chat?id=${id}`, { method: "DELETE" });
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    setChats((prev) => prev.filter((c) => c.id !== id));
    if (id === chatId) nuevoChat();
  };

  const compartirChat = async (chat: Chat) => {
    await navigator.clipboard.writeText(JSON.stringify(chat, null, 2));
    alert("Copiado ✅");
  };

  const renombrarChat = async (chat: Chat) => {
    setRenameChat(chat);
    setRenameValue(chat.title || "");
    setMenuOpen(null);
  };

  const guardarRenombreChat = async () => {
    if (!renameChat) return;

    const nuevoTitulo = renameValue.trim();
    if (!nuevoTitulo) return;

    const res = await fetch("/api/chat", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: renameChat.id,
        title: nuevoTitulo,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data.error || "No se pudo renombrar");
      return;
    }

    setChats((prev) =>
      prev.map((c) => (c.id === renameChat.id ? { ...c, title: nuevoTitulo } : c))
    );

    setRenameChat(null);
    setRenameValue("");
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    for (const item of e.clipboardData.items) {
      if (item.type.includes("image")) {
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () =>
          setImages((prev) => [...prev, reader.result as string]);
        reader.readAsDataURL(file);
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    const editable = dropped.filter((f) => /\.(xlsx|xls|docx|pdf)$/i.test(f.name));
    const others = dropped.filter((f) => !/\.(xlsx|xls|docx|pdf)$/i.test(f.name));

    others.forEach((file) => {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () =>
          setImages((prev) => [...prev, reader.result as string]);
        reader.readAsDataURL(file);
      } else {
        setFiles((prev) => [...prev, { file, name: file.name, size: file.size }]);
      }
    });

    if (editable.length > 0) {
      setTypeChoiceFile(editable[0]);
    }
  };

  const handleFilesSelected = (fileList: FileList) => {
    const newFiles = Array.from(fileList).map((file) => ({
      file,
      name: file.name,
      size: file.size,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const handleEditFileToggle = () => {
    if (isEditMode) {
      setEditInstruction("");
      setEditFile(null);
    }
    setIsEditMode((v) => !v);
  };

  const handleEditFileSelected = (file: File) => {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!["xlsx", "xls", "docx", "pdf"].includes(ext)) {
      alert("Solo se admiten archivos .xlsx, .docx y .pdf para edición");
      return;
    }
    setEditFile(file);
    setIsEditMode(true);
  };

  const handleTypeChoiceAction = (file: File, action: "analyze" | "edit") => {
    setTypeChoiceFile(null);
    if (action === "edit") {
      setEditFile(file);
      setIsEditMode(true);
    } else {
      setFiles((prev) => [...prev, { file, name: file.name, size: file.size }]);
    }
  };

  const handleEditFlow = async (file: File, instruction: string) => {
    if (editLoading) return;
    setEditLoading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("instruction", instruction);
    formData.append("chatId", chatId);

    try {
      const res = await fetch("/api/document/edit", {
        method: "POST",
        body: formData,
      });

      if (res.status === 401) {
        router.push("/login");
        return;
      }

      const editResultHeader = res.headers.get("X-Edit-Result");
      const editResult: EditResult = editResultHeader
        ? JSON.parse(editResultHeader)
        : { success: false, format: "pdf", filename: file.name, originalName: file.name, changesCount: 0, error: "Error desconocido" };

      if (res.ok && editResult.success) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        editResult.downloadUrl = url;

        setMessages((prev) => [
          ...prev,
          { role: "user", text: `✏️ Editar archivo: ${file.name}\n\n${instruction}`, files: [{ name: file.name }] },
          { role: "ai", text: "", editResult },
        ]);
      } else {
        const data = await res.json().catch(() => ({}));
        setMessages((prev) => [
          ...prev,
          { role: "user", text: `✏️ Editar archivo: ${file.name}\n\n${instruction}`, files: [{ name: file.name }] },
          { role: "ai", text: data.error || "No se pudo editar el documento" },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "user", text: `✏️ Editar archivo: ${file.name}\n\n${instruction}`, files: [{ name: file.name }] },
        { role: "ai", text: "Error de conexión al editar el documento" },
      ]);
    } finally {
      setEditLoading(false);
      setIsEditMode(false);
      setEditFile(null);
      setEditInstruction("");
    }
  };

  const handleSendEditInstruction = () => {
    if (!editFile || !editInstruction.trim()) return;
    handleEditFlow(editFile, editInstruction);
  };

  const handleSend = () => {
    if (isEditMode) {
      handleSendEditInstruction();
    } else {
      enviarMensaje();
    }
  };

  const handleStop = () => abortRef.current?.abort();

  const handleRegenerate = async () => {
    if (!chatId || messages.length < 2) return;

    setMessages((prev) => prev.slice(0, -1));
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let accumulated = "";

    try {
      const res = await fetch("/api/chat/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, projectId: currentProjectId }),
        signal: controller.signal,
      });

      if (res.status === 401) {
        router.push("/login");
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setMessages((prev) => [...prev, { role: "ai", text: errData.error || "Error al regenerar" }]);
        return;
      }

      if (!res.body) throw new Error("Sin cuerpo de respuesta");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

    setMessages((prev) => [...prev, { role: "ai", text: "", searching: false }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last?.role === "ai") {
            copy[copy.length - 1] = { role: "ai", text: accumulated };
          }
          return copy;
        });
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        if (accumulated) {
          try {
            await fetch("/api/chat/save-partial", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chatId, content: accumulated }),
            });
          } catch {}
        }
      } else {
        console.error("Error al regenerar:", err);
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
      cargarChats();
    }
  };

  const EDIT_KEYWORDS = /\b(agrega|añade|inserta|elimina|borra|modifica|cambia|edita|editar|columna|fila|celda|renombra|actualiza|pone|pon)\b/i;

  const enviarMensaje = async (
    textOverride?: string,
    editFromIndex?: number
  ) => {
    const messageText = textOverride ?? input;

    if (!messageText.trim() && images.length === 0 && files.length === 0) return;

    // Auto-detección: si hay archivo editable + keywords de edición, redirigir a edit flow
    if (messageText.trim() && files.length > 0) {
      const editableFile = files.find((f) => /\.(xlsx|xls|docx|pdf)$/i.test(f.name));
      if (editableFile && EDIT_KEYWORDS.test(messageText)) {
        setInput("");
        setImages([]);
        setFiles([]);
        await handleEditFlow(editableFile.file, messageText);
        return;
      }
    }

    setLoading(true);

    const extraImages = [...images];
    let filesContent = "";
    let fileNames: { name: string }[] = [];

    if (files.length > 0) {
      const uploadForm = new FormData();
      files.forEach((f) => uploadForm.append("files", f.file));
      uploadForm.append("chatId", chatId);
      if (currentProjectId) uploadForm.append("projectId", currentProjectId);

      try {
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: uploadForm,
        });

        if (uploadRes.ok) {
          const uploadData: { files: { name: string; content: string }[] } = await uploadRes.json();
          filesContent = uploadData.files.map((f) => f.content).join("\n\n");
          fileNames = uploadData.files.map((f) => ({ name: f.name }));
        }
      } catch {
        // fallback: envía solo el texto
      }
    }

    const visibleText = messageText || "Analiza este archivo";

    const formData = new FormData();
    formData.append("chatId", chatId);
    formData.append("message", visibleText);
    if (currentProjectId) formData.append("projectId", currentProjectId);
    if (filesContent) formData.append("filesContent", filesContent);

    extraImages.forEach((img, i) => {
      formData.append(`image_${i}`, img);
    });

    if (editFromIndex !== undefined) {
      formData.append("editFromIndex", String(editFromIndex));
      setMessages((prev) => prev.slice(0, editFromIndex));
    }

    const willSearch = checkAutoSearch(visibleText);
    if (willSearch) setSearching(true);

    setInput("");
    setImages([]);
    setFiles([]);

    setMessages((prev) => [
      ...prev,
      { role: "user", text: visibleText, images: extraImages, files: fileNames },
    ]);

    setMessages((prev) => [...prev, { role: "ai", text: "" }]);

    const controller = new AbortController();
    abortRef.current = controller;
    let accumulated = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (res.status === 401) {
        router.push("/login");
        return;
      }

      const contentType = res.headers.get("Content-Type") || "";

      if (contentType.includes("application/json")) {
        const data = await res.json();
        setLoading(false);
        setSearching(false);
        if (data.type === "document" && data.editResult) {
          let editResult = data.editResult;
          if (editResult.dataUri) {
            try {
              const dataResp = await fetch(editResult.dataUri);
              const blob = await dataResp.blob();
              editResult = { ...editResult, downloadUrl: URL.createObjectURL(blob) };
            } catch {}
          }
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last?.role === "ai") {
              copy[copy.length - 1] = { role: "ai", text: data.text, editResult };
            }
            return copy;
          });
        } else {
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last?.role === "ai") {
              copy[copy.length - 1] = { role: "ai", text: data.text || "" };
            }
            return copy;
          });
        }
        cargarChats();
        return;
      }

      if (!res.body) throw new Error("Sin cuerpo de respuesta");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let firstChunk = true;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (firstChunk) {
          firstChunk = false;
          setSearching(false);
        }
        accumulated += decoder.decode(value, { stream: true });
        // Parse sources from the end of the stream
        let displayText = accumulated;
        let sources: SearchResult[] = [];
        const sourcesMatch = accumulated.match(/__SOURCES__:(.+)$/);
        if (sourcesMatch) {
          try {
            sources = JSON.parse(sourcesMatch[1]);
            displayText = accumulated.slice(0, accumulated.lastIndexOf("__SOURCES__:")).trim();
          } catch {}
        }
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last?.role === "ai") {
            copy[copy.length - 1] = {
              ...last,
              text: displayText,
              sources: sources.length > 0 ? sources : undefined,
            };
          }
          return copy;
        });
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        if (accumulated) {
          try {
            await fetch("/api/chat/save-partial", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chatId, content: accumulated }),
            });
          } catch {}
        }
      } else {
        console.error("Error al enviar mensaje:", err);
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
      setSearching(false);
      cargarChats();
    }
  };

  const handleEditMessage = (index: number, newText: string) => {
    enviarMensaje(newText, index);
  };

  // Project handlers
  const handleToggleProject = (projectId: string) => {
    if (projectId === "__toggle") {
      setView({ type: "projects" });
      return;
    }
    if (expandedProjectId === projectId) {
      setExpandedProjectId(null);
    } else {
      setExpandedProjectId(projectId);
      if (!projectChats[projectId]) {
        cargarProjectChats(projectId);
      }
    }
  };

  const handleDoubleClickProject = (projectId: string) => {
    setExpandedProjectId(null);
    setView({ type: "project", id: projectId });
  };

  const handleRemoveChatFromProject = async (projectId: string, chatId: string) => {
    try {
      await fetch(`/api/projects/${projectId}/chats`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId }),
      });
      setProjectChats((prev) => ({
        ...prev,
        [projectId]: (prev[projectId] || []).filter((c) => c.id !== chatId),
      }));
      cargarProjects();
      cargarChats();
    } catch {}
  };

  const handleAddChatToProject = (projectId: string) => {
    setShowAddChatProjectId(projectId);
  };

  const handleAddChatToProjectSubmit = async (projectId: string, chatId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/chats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId }),
      });
      if (res.ok) {
        const data = await res.json();
        setProjectChats((prev) => ({ ...prev, [projectId]: data }));
        cargarProjects();
      }
    } catch {}
    setShowAddChatProjectId(null);
  };

  const handleAddChatToProjectById = async (projectId: string, chatId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/chats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId }),
      });
      if (res.ok) {
        const data = await res.json();
        setProjectChats((prev) => ({ ...prev, [projectId]: data }));
        cargarProjects();
      }
    } catch {}
  };

  const handleCreateProjectAndAddChat = async (name: string, chatId: string) => {
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, instructions: "" }),
      });
      if (res.ok) {
        const project = await res.json();
        await handleAddChatToProjectById(project.id, chatId);
      }
    } catch {}
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProjectName.trim(), instructions: "" }),
      });
      if (res.ok) {
        setNewProjectName("");
        setShowNewProjectInput(false);
        cargarProjects();
      }
    } catch {}
  };

  const handleOpenChatInProjectView = (chat: Chat, projectId: string) => {
    setView({ type: "chat" });
    setCurrentProjectId(projectId);
    setChatId(chat.id);
    const fullChat = chats.find((c) => c.id === chat.id);
    setMessages(fullChat ? fullChat.messages : []);
    window.history.replaceState(null, "", `/?projectId=${projectId}`);
  };

  const handleOpenProjectFromList = (projectId: string) => {
    setView({ type: "project", id: projectId });
  };

  return (
    <main
      className={`h-screen flex ${colors.bg} ${colors.text} overflow-hidden`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <Sidebar
        chats={chats}
        search={search}
        menuOpen={menuOpen}
        sidebarOpen={sidebarOpen}
        collapsed={sidebarCollapsed}
        darkMode={darkMode}
        currentChatId={chatId}
        projects={projects}
        projectChats={projectChats}
        expandedProjectId={expandedProjectId}
        projectSearch={projectSearch}
        newProjectName={newProjectName}
        showNewProjectInput={showNewProjectInput}
        onToggleDarkMode={() => setDarkMode((v) => !v)}
        onNewChat={nuevoChat}
        onOpenChat={abrirChat}
        onDeleteChat={eliminarChat}
        onShareChat={compartirChat}
        onRenameChat={renombrarChat}
        onSearch={setSearch}
        onMenuToggle={setMenuOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        onFilesSelected={handleFilesSelected}
        onToggleProject={handleToggleProject}
        onDoubleClickProject={handleDoubleClickProject}
        onOpenChatInProject={abrirChatEnProject}
        onAddChatToProject={handleAddChatToProject}
        onRemoveChatFromProject={handleRemoveChatFromProject}
        onProjectSearch={setProjectSearch}
        onNewProjectNameChange={setNewProjectName}
        onShowNewProjectInput={setShowNewProjectInput}
        onCreateProject={handleCreateProject}
        onAddChatToProjectById={handleAddChatToProjectById}
        onCreateProjectAndAddChat={handleCreateProjectAndAddChat}
      />

      {view.type === "projects" && (
        <ProjectsListView
          darkMode={darkMode}
          onOpenProject={handleOpenProjectFromList}
          onBack={() => setView({ type: "chat" })}
          onProjectChanged={() => cargarProjects()}
        />
      )}

      {view.type === "project" && (
        <ProjectDetailView
          projectId={view.id}
          darkMode={darkMode}
          onBack={() => setView({ type: "chat" })}
          onOpenChat={handleOpenChatInProjectView}
          onProjectChanged={() => cargarProjects()}
        />
      )}

      {view.type === "chat" && (
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center gap-3 px-4 pt-3">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className={`lg:hidden p-2 rounded-xl hover:bg-[#1e293b] transition ${colors.card}`}
              title="Menú"
            >
              <PanelLeft size={20} />
            </button>
            <div className="text-center flex-1">
              {currentProjectId && (
                <span className="text-xs text-green-400 block">
                  Proyecto activo
                </span>
              )}
              <h1 className="text-2xl lg:text-4xl font-bold text-green-400">
                Inteligencia Digna
              </h1>
              <p className={`text-sm ${colors.muted}`}>by Salud Digna</p>
            </div>
            {user ? (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowUserMenu((v) => !v); }}
                  className="w-9 h-9 rounded-full overflow-hidden border-2 border-green-500 hover:opacity-80 transition"
                >
                  {user.picture ? (
                    <img src={user.picture} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-green-600 flex items-center justify-center text-sm font-bold">
                      {(user.name || user.email)[0].toUpperCase()}
                    </div>
                  )}
                </button>
                {showUserMenu && (
                  <div className="absolute right-0 mt-2 w-56 bg-[#121824] border border-[#202938] rounded-xl p-2 shadow-xl z-50" onClick={(e) => e.stopPropagation()}>
                    <p className="px-3 py-1 text-sm text-white font-medium truncate">{user.name || user.email}</p>
                    <p className="px-3 py-1 text-xs text-gray-400 truncate">{user.email}</p>
                    <hr className="border-[#202938] my-1" />
                    <a
                      href="/api/auth/logout"
                      className="block w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-[#1e293b] rounded-lg"
                    >
                      Cerrar sesión
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <div className="w-10 lg:hidden" />
            )}
          </div>

          {messages.length === 0 && (
            <div className="flex-1 flex items-center justify-center">
              <div className={`p-6 rounded-2xl text-center mx-4 ${colors.card}`}>
                <h2>¡Hola! Soy Inteligencia Digna</h2>
                <p className={`mt-2 ${colors.muted}`}>
                  ¿En qué puedo ayudarte hoy?
                </p>
              </div>
            </div>
          )}

          <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">
            {messages.map((m, i) => (
              <ChatMessage
                key={m.id ?? i}
                message={m}
                index={i}
                isLastAi={m.role === "ai" && i === messages.length - 1 && messages.length >= 2}
                onEdit={m.role === "user" ? handleEditMessage : undefined}
                onRegenerate={
                  m.role === "ai" && i === messages.length - 1 && messages.length >= 2
                    ? handleRegenerate
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
                <video
                  src="/typing.mp4"
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="h-8"
                />
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <ChatInput
            input={input}
            images={images}
            files={files.map((f) => ({ name: f.name, size: f.size }))}
            loading={loading || editLoading}
            onInputChange={setInput}
            onSend={handleSend}
            onStop={handleStop}
            onPaste={handlePaste}
            onRemoveImage={(i) =>
              setImages((prev) => prev.filter((_, idx) => idx !== i))
            }
            onRemoveFile={(i) =>
              setFiles((prev) => prev.filter((_, idx) => idx !== i))
            }
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

      {renameChat && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#121824] border border-[#202938] rounded-2xl p-6 w-[360px] shadow-xl">
            <h2 className="text-lg font-bold text-white mb-4">
              Renombrar conversación
            </h2>

            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
              className="w-full bg-[#030812] border border-[#202938] rounded-xl px-4 py-3 text-white outline-none mb-4"
              placeholder="Nuevo nombre"
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setRenameChat(null);
                  setRenameValue("");
                }}
                className="px-4 py-2 rounded-xl bg-gray-700 hover:bg-gray-600"
              >
                Cancelar
              </button>

              <button
                onClick={guardarRenombreChat}
                className="px-4 py-2 rounded-xl bg-green-500 hover:bg-green-600 text-white"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add chat to project modal */}
      {showAddChatProjectId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowAddChatProjectId(null)}>
          <div className="bg-[#121824] border border-[#202938] rounded-2xl p-6 w-96 max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Agregar chat al proyecto</h3>
            {(() => {
              const projectChatIds = new Set((projectChats[showAddChatProjectId] || []).map((c) => c.id));
              const available = chats.filter((c) => !projectChatIds.has(c.id));
              return available.length === 0 ? (
                <p className="text-sm text-gray-500">No hay chats disponibles para agregar</p>
              ) : (
                <div className="space-y-1">
                  {available.map((chat) => (
                    <button
                      key={chat.id}
                      onClick={() => handleAddChatToProjectSubmit(showAddChatProjectId, chat.id)}
                      className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-[#1e293b] transition-colors"
                    >
                      {chat.title}
                    </button>
                  ))}
                </div>
              );
            })()}
            <button onClick={() => setShowAddChatProjectId(null)} className="mt-4 text-sm text-gray-500 hover:underline">Cancelar</button>
          </div>
        </div>
      )}

      <style jsx>{`
        ::-webkit-scrollbar {
          width: 8px;
        }
        ::-webkit-scrollbar-track {
          background: ${darkMode ? "#030812" : "#f1f5f9"};
        }
        ::-webkit-scrollbar-thumb {
          background: ${darkMode ? "#1e293b" : "#cbd5e1"};
          border-radius: 10px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: ${darkMode ? "#334155" : "#94a3b8"};
        }
        @keyframes bounce {
          0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-4px); }
        }
        .animate-bounce {
          animation: bounce 1.2s infinite;
        }
      `}</style>
    </main>
  );
}

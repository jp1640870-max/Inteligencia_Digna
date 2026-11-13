"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import NextImage from "next/image";
import {
  PanelLeft,
  PanelLeftClose,
  MessageSquarePlus,
  Image,
  FileText,
  Folder,
  Brain,
  Search,
  Moon,
  Sun,
  EllipsisVertical,
  Share2,
  Pencil,
  Trash2,
  Plus,
  X,
  Settings,
  LogOut,
} from "lucide-react";
import Link from "next/link";
import { useChatStore } from "@/lib/stores/chat-store";
import { useProjectStore } from "@/lib/stores/project-store";
import { useUIStore } from "@/lib/stores/ui-store";
import { useAuthStore, ADMIN_VISIBLE_ROLES } from "@/lib/stores/auth-store";
import type { Chat, Msg } from "@/types";

const SIDEBAR_DEFAULT_WIDTH = 202;
const SIDEBAR_MIN_WIDTH = 184;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_HIDE_THRESHOLD = 50;
const SIDEBAR_RESPONSIVE_MIN = 196;
const SIDEBAR_RESPONSIVE_MAX = 216;
const SIDEBAR_RESPONSIVE_RATIO = 0.14;

function getResponsiveSidebarWidth() {
  if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;

  return Math.min(
    SIDEBAR_RESPONSIVE_MAX,
    Math.max(
      SIDEBAR_RESPONSIVE_MIN,
      Math.round(window.innerWidth * SIDEBAR_RESPONSIVE_RATIO)
    )
  );
}

export default function Sidebar() {
  // ─── Stores ───
  const chats = useChatStore((s) => s.chats);
  const currentChatId = useChatStore((s) => s.chatId);
  const openChat = useChatStore((s) => s.openChat);
  const newChat = useChatStore((s) => s.newChat);
  const deleteChat = useChatStore((s) => s.deleteChat);
  const shareChat = useChatStore((s) => s.shareChat);
  const handleFilesSelected = useChatStore((s) => s.handleFilesSelected);

  const projects = useProjectStore((s) => s.projects);
  const projectChats = useProjectStore((s) => s.projectChats);
  const expandedProjectId = useProjectStore((s) => s.expandedProjectId);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const projectSearch = useUIStore((s) => s.projectSearch);
  const loadProjectChats = useProjectStore((s) => s.loadProjectChats);
  const setExpandedProjectId = useProjectStore((s) => s.setExpandedProjectId);
  const removeChatFromProject = useProjectStore((s) => s.removeChatFromProject);
  const setCurrentProjectId = useProjectStore((s) => s.setCurrentProjectId);

  const user = useAuthStore((s) => s.user);

  const showAdminButton = user && ADMIN_VISIBLE_ROLES.includes(user.role);



  const darkMode = useUIStore((s) => s.darkMode);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const view = useUIStore((s) => s.view);
  const search = useUIStore((s) => s.search);
  const setSearch = useUIStore((s) => s.setSearch);
  const toggleDarkMode = useUIStore((s) => s.toggleDarkMode);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  const toggleCollapse = useUIStore((s) => s.toggleCollapse);
  const openRenameModal = useUIStore((s) => s.openRenameModal);
  const openAddToProjectModal = useUIStore((s) => s.openAddToProjectModal);
  const showNewProjectInput = useUIStore((s) => s.showNewProjectInput);
  const newProjectName = useUIStore((s) => s.newProjectName);
  const setNewProjectName = useUIStore((s) => s.setNewProjectName);
  const setShowNewProjectInput = useUIStore((s) => s.setShowNewProjectInput);
  const setProjectSearch = useUIStore((s) => s.setProjectSearch);
  const setView = useUIStore((s) => s.setView);

  const createProject = useProjectStore((s) => s.createProject);

  // ─── Local UI state (menu) ───
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const analyzeInputRef = useRef<HTMLInputElement>(null);
  const [searchPopoverOpen, setSearchPopoverOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [popoverSearch, setPopoverSearch] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchBtnRef = useRef<HTMLButtonElement>(null);

  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const hasCustomWidth = useRef(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Click outside ───
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        searchBtnRef.current &&
        !searchBtnRef.current.contains(e.target as Node)
      ) {
        setSearchPopoverOpen(false);
        setPopoverSearch("");
      }
    };
    if (searchPopoverOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [searchPopoverOpen]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSearchPopoverOpen(false);
        setPopoverSearch("");
      }
    };
    if (searchPopoverOpen) {
      document.addEventListener("keydown", handleEsc);
    }
    return () => document.removeEventListener("keydown", handleEsc);
  }, [searchPopoverOpen]);

  // ─── Resize ───
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    hasCustomWidth.current = true;
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const syncDefaultWidth = () => {
      if (hasCustomWidth.current) return;
      setSidebarWidth(getResponsiveSidebarWidth());
    };

    syncDefaultWidth();
    window.addEventListener("resize", syncDefaultWidth);
    return () => window.removeEventListener("resize", syncDefaultWidth);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const left = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - left;
      if (newWidth < SIDEBAR_HIDE_THRESHOLD) {
        setSidebarHidden(true);
        setIsResizing(false);
        return;
      }
      setSidebarWidth(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, newWidth)));
    };
    const handleMouseUp = () => setIsResizing(false);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  // ─── Colors ───
  const colors = {
    sidebar: "bg-[var(--sidebar-bg)] backdrop-blur-[24px]",
    border: "border-[var(--sidebar-border)]",
    hover: "hover:bg-[var(--sidebar-hover)]",
    text: "text-[var(--sidebar-text)]",
    textMuted: "text-[var(--sidebar-muted)]",
    textHover: "hover:text-[var(--sidebar-text)]",
    textRed: "text-red-400",
    inputBg: "bg-[var(--sidebar-card)]",
    inputFocus: "focus:bg-[var(--sidebar-hover)]",
    placeholder: "placeholder:text-[var(--sidebar-faint)]",
    overlay: "bg-black/50",
    popoverBg: "bg-[var(--sidebar-popover)] backdrop-blur-[24px]",
    popoverBorder: "border-[var(--sidebar-border)]",
    iconColor: "text-[var(--sidebar-muted)]",
    iconHover: "hover:text-[var(--sidebar-text)]",
  };

  // ─── Handlers ───
  const handleToggleProject = (projectId: string) => {
    if (projectId === "__toggle") {
      setView({ type: "projects" });
      setSidebarOpen(false);
      return;
    }
    if (expandedProjectId === projectId) {
      setExpandedProjectId(null);
    } else {
      setExpandedProjectId(projectId);
      if (!projectChats[projectId]) {
        loadProjectChats(projectId);
      }
    }
  };

  const handleDoubleClickProject = (projectId: string) => {
    setExpandedProjectId(null);
    setView({ type: "project", id: projectId });
    setSidebarOpen(false);
  };

  const handleOpenChat = (chat: { id: string; title: string; messages: Msg[] }) => {
    openChat(chat);
    setSidebarOpen(false);
  };

  const handleOpenChatInProject = (chat: Chat, projectId: string) => {
    setView({ type: "chat" });
    setCurrentProjectId(projectId);
    openChat(chat);
    setSidebarOpen(false);
    window.history.replaceState(null, "", `/?projectId=${projectId}`);
  };

  const handleProjectClick = (projectId: string) => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      handleDoubleClickProject(projectId);
    } else {
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        handleToggleProject(projectId);
      }, 300);
    }
  };

  const filteredChats = chats.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(projectSearch.toLowerCase())
  );

  const activeProjectId =
    currentProjectId || (view.type === "project" ? view.id : null);
  const activeProject = activeProjectId
    ? projects.find((p) => p.id === activeProjectId)
    : undefined;
  const userInitial = (user?.name || user?.email || "U").charAt(0).toUpperCase();

  const filteredPopoverChats = chats.filter((c) =>
    c.title.toLowerCase().includes(popoverSearch.toLowerCase())
  );

  const handlePopoverChatClick = (chat: Chat) => {
    handleOpenChat(chat);
    setSearchPopoverOpen(false);
    setPopoverSearch("");
  };

  const handleRestoreSidebar = () => {
    hasCustomWidth.current = false;
    setSidebarHidden(false);
    setSidebarWidth(getResponsiveSidebarWidth());
  };

  const handleOpenSidebar = () => {
    setSidebarCollapsed(false);
    setSidebarHidden(false);
    setAccountMenuOpen(false);
    setSearchPopoverOpen(false);
    setPopoverSearch("");
  };

  // ─── Expanded sidebar view ───
  const renderExpanded = () => (
    <div
      ref={sidebarRef}
      style={{ width: sidebarWidth }}
      className={`fixed lg:relative z-40 h-full ${colors.sidebar} max-lg:bg-[var(--sidebar-popover)] ${colors.border} border-r flex flex-col transition-all duration-300 ease-in-out ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      } ${sidebarHidden ? "lg:-translate-x-full" : "lg:translate-x-0"} overflow-hidden shrink-0`}
    >
      <div className="px-2.5 pt-3">
        <div className="flex items-center gap-2">
          <div className="sidebar-brand-mark">
            <NextImage
              src="/logo.png"
              alt="Inteligencia Digna"
              width={32}
              height={30}
              className="h-full w-full object-contain"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="chat-brand-title">Inteligencia Digna</div>
            <div className="chat-brand-kicker">by Salud Digna</div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className={`lg:hidden flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${colors.hover} ${colors.iconColor} ${colors.iconHover} transition`}
            title="Cerrar menú"
            aria-label="Cerrar menú"
          >
            <X size={15} strokeWidth={1.7} />
          </button>
          <button
            onClick={toggleCollapse}
            className={`hidden lg:flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${colors.hover} ${colors.iconColor} ${colors.iconHover} transition`}
            title="Colapsar sidebar"
            aria-label="Colapsar sidebar"
          >
            <PanelLeftClose size={15} strokeWidth={1.7} />
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="chat-status-pill">
            <span className="chat-status-dot" />
            Asistente en línea
          </span>
          {activeProject && (
            <span className="chat-project-pill max-w-full overflow-hidden" title={activeProject.name}>
              <span className="min-w-0 truncate">Proyecto: {activeProject.name}</span>
            </span>
          )}
        </div>
      </div>

      <div className="px-3 pt-3 space-y-1">
        <button
          onClick={() => {
            newChat();
            setView({ type: "chat" });
            setSidebarOpen(false);
          }}
          className="sidebar-new-chat"
        >
          <MessageSquarePlus size={17} strokeWidth={1.7} /> Nuevo chat
        </button>
        <button aria-label="Crear imagen" className="sidebar-side-item">
          {/* eslint-disable-next-line jsx-a11y/alt-text -- falso positivo: icono lucide <Image>, no <img> */}
          <Image size={17} strokeWidth={1.7} /> Crear imagen
        </button>
        <button onClick={() => analyzeInputRef.current?.click()} className="sidebar-side-item">
          <FileText size={17} strokeWidth={1.7} /> Analizar archivo
        </button>
        <button
          onClick={() => {
            setView({ type: "projects" });
            setSidebarOpen(false);
          }}
          className={`sidebar-side-item ${
            view.type === "projects" || view.type === "project" ? "is-active" : ""
          }`}
          aria-current={
            view.type === "projects" || view.type === "project" ? "page" : undefined
          }
        >
          <Folder size={17} strokeWidth={1.7} /> Proyectos
        </button>
      </div>

      <div className="px-3 pt-3 pb-1">
        <div className="mb-2 flex items-center justify-between">
          <button onClick={() => handleToggleProject("__toggle")} className="sidebar-section-label flex items-center gap-1.5 transition-colors hover:text-[var(--sidebar-text)]">
            <Folder size={13} strokeWidth={1.8} /> Proyectos <span className="text-[10px] tracking-normal text-[var(--sidebar-faint)]">{projects.length}</span>
          </button>
          <button onClick={() => setShowNewProjectInput(true)} className={`flex h-7 w-7 items-center justify-center rounded-lg ${colors.hover} ${colors.iconColor} ${colors.iconHover} transition`} title="Nuevo proyecto">
            <Plus size={14} strokeWidth={1.8} />
          </button>
        </div>

        {showNewProjectInput && (
          <div className="mb-2">
            <input
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createProject(newProjectName);
                if (e.key === "Escape") setShowNewProjectInput(false);
              }}
              placeholder="Nombre del proyecto"
              autoFocus
              className="sidebar-input"
            />
            <div className="mt-1.5 flex gap-2">
              <button onClick={() => createProject(newProjectName)} className="text-[11px] text-green-400 hover:underline">Crear</button>
              <button onClick={() => setShowNewProjectInput(false)} className={`text-[11px] ${colors.textMuted} hover:underline`}>Cancelar</button>
            </div>
          </div>
        )}

        <div className="relative mt-1">
          <Search size={13} strokeWidth={1.8} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${colors.textMuted}`} />
          <input value={projectSearch} onChange={(e) => setProjectSearch(e.target.value)} placeholder="Buscar proyectos..." className="sidebar-search" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 mt-1">
        {filteredProjects.length === 0 && (
          <p className={`px-3 py-2 text-xs text-center ${colors.textMuted}`}>{projectSearch ? "Sin resultados" : "Sin proyectos"}</p>
        )}
        {filteredProjects.map((project) => {
          const isExpanded = expandedProjectId === project.id;
          const projectChatList = projectChats[project.id] || [];
          return (
            <div key={project.id} className="mb-0.5">
              <div className={`flex items-center rounded-[10px] ${colors.hover} transition-colors`}>
                <button onClick={() => handleProjectClick(project.id)} className={`flex flex-1 items-center gap-1.5 truncate px-2.5 py-[7px] text-left text-[12.5px] ${colors.text}`} title="Click: expandir · Doble click: abrir">
                  <span className="shrink-0 text-[9px] text-[var(--sidebar-faint)]">{isExpanded ? "▾" : "▸"}</span>
                  <Folder size={13} strokeWidth={1.8} className="shrink-0" />
                  <span className="truncate">{project.name}</span>
                  <span className={`shrink-0 text-[10px] ${colors.textMuted}`}>({project.chat_count || projectChatList.length})</span>
                </button>
                <button onClick={() => openAddToProjectModal(project.id)} className={`px-2 py-[7px] ${colors.textMuted} ${colors.textHover} transition-colors`} title="Agregar chat">
                  <Plus size={13} strokeWidth={1.8} />
                </button>
              </div>

              {isExpanded && (
                <div className="ml-4 mt-0.5 space-y-0.5 border-l border-[var(--sidebar-border)] pl-2">
                  {projectChatList.length === 0 ? (
                    <p className={`px-2 py-1 text-[11px] ${colors.textMuted}`}>Sin chats</p>
                  ) : (
                    projectChatList.map((chat) => (
                      <div key={chat.id} className={`flex items-center rounded-[10px] transition-colors ${chat.id === currentChatId ? "sidebar-item-active" : colors.hover}`}>
                        <button onClick={() => handleOpenChatInProject(chat, project.id)} className={`flex-1 truncate px-2 py-1.5 text-left text-[11.5px] ${chat.id === currentChatId ? "" : colors.textMuted}`}>
                          {chat.title}
                        </button>
                        <button onClick={() => removeChatFromProject(project.id, chat.id)} className={`px-1 py-1 ${colors.textMuted} hover:text-red-400 transition-colors`} title="Quitar del proyecto">
                          <X size={12} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}

        <div className={`my-2 border-t ${colors.border}`} />

        <div className="px-3 py-1">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="sidebar-section-label">Chats</span>
            <span className="text-[10px] text-[var(--sidebar-faint)]">{filteredChats.length}</span>
          </div>
          <div className="relative">
            <Search size={13} strokeWidth={1.8} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${colors.textMuted}`} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar chats..." className="sidebar-search" />
          </div>
        </div>

        {filteredChats.length === 0 && (
          <p className={`px-3 py-4 text-center text-[11px] ${colors.textMuted}`}>{search ? "Sin resultados" : "No hay chats aún"}</p>
        )}
        {filteredChats.map((chat) => (
          <div key={chat.id} className="relative mb-0.5">
            <div className={`flex items-center rounded-[10px] transition-colors ${chat.id === currentChatId ? "sidebar-item-active" : colors.hover}`}>
              <button onClick={() => handleOpenChat(chat)} className={`flex-1 truncate px-2.5 py-[7px] text-left text-[12.5px] ${chat.id === currentChatId ? "" : colors.textMuted}`}>
                {chat.title}
              </button>
              <button onClick={() => setMenuOpen(menuOpen === chat.id ? null : chat.id)} className={`px-2 py-[7px] ${chat.id === currentChatId ? "" : colors.textMuted} ${colors.textHover} transition-colors`}>
                <EllipsisVertical size={15} strokeWidth={1.8} />
              </button>
            </div>

            {menuOpen === chat.id && (
              <div className={`absolute right-2 top-10 ${colors.sidebar} ${colors.border} border rounded-xl w-48 z-50 shadow-lg`}>
                <button onClick={() => { shareChat(chat); setMenuOpen(null); }} className={`w-full flex items-center gap-2 px-3 py-2 text-sm ${colors.text} ${colors.hover} rounded-t-xl transition-colors`}>
                  <Share2 size={16} /> Compartir
                </button>
                <button onClick={() => { openRenameModal(chat.id, chat.title); setMenuOpen(null); }} className={`w-full flex items-center gap-2 px-3 py-2 text-sm ${colors.text} ${colors.hover} transition-colors`}>
                  <Pencil size={16} /> Renombrar
                </button>
                <button onClick={() => { openAddToProjectModal(chat.id); setMenuOpen(null); }} className={`w-full flex items-center gap-2 px-3 py-2 text-sm ${colors.text} ${colors.hover} transition-colors`}>
                  <Folder size={16} /> Agregar a proyecto
                </button>
                <button onClick={() => { deleteChat(chat.id); setMenuOpen(null); }} className={`w-full flex items-center gap-2 px-3 py-2 text-sm ${colors.textRed} ${colors.hover} rounded-b-xl transition-colors`}>
                  <Trash2 size={16} /> Eliminar
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className={`space-y-1 border-t ${colors.border} p-2.5`}>
        {showAdminButton && (
          <Link href="/admin/dashboard" className="sidebar-admin-link">
            <Settings size={15} strokeWidth={1.8} />
            <span>Panel de Administración</span>
          </Link>
        )}

        <button onClick={toggleDarkMode} className="sidebar-side-item">
          {darkMode ? <Sun size={17} strokeWidth={1.7} /> : <Moon size={17} strokeWidth={1.7} />}
          <span>{darkMode ? "Modo claro" : "Modo oscuro"}</span>
        </button>

        {user && (
          <div className="sidebar-user-card">
            <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full border border-[var(--sidebar-border)] bg-green-600 text-xs font-bold text-white">
              {user.picture ? (
                <NextImage
                  src={user.picture}
                  alt=""
                  width={32}
                  height={32}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center">{userInitial}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11.5px] font-medium text-[var(--sidebar-text)]">
                {user.name || user.email}
              </p>
              <p className={`truncate text-[10px] ${colors.textMuted}`}>{user.email}</p>
            </div>
            <a
              href="/api/auth/logout"
              className={`rounded-lg p-1.5 ${colors.iconColor} ${colors.iconHover} transition-colors hover:bg-red-500/10 hover:text-red-400`}
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
            >
              <LogOut size={14} strokeWidth={1.8} />
            </a>
          </div>
        )}
      </div>

      <input ref={analyzeInputRef} type="file" accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.csv,.png,.jpg,.jpeg,.gif" multiple className="hidden" onChange={(e) => { if (e.target.files) handleFilesSelected(e.target.files); e.target.value = ""; }} />

      <div className={`hidden lg:block absolute right-0 top-0 h-full w-1 cursor-col-resize z-50 transition-colors ${isResizing ? "bg-green-500" : "bg-transparent hover:bg-green-500/40"}`} onMouseDown={handleResizeStart} />
    </div>
  );

  // ─── Collapsed sidebar view ───
  const renderCollapsed = () => {
    const railButton =
      "relative flex h-9 w-9 items-center justify-center rounded-[11px] text-[var(--rail-icon)] transition-colors hover:bg-white/[0.08] hover:text-white";
    const projectsActive = view.type === "projects" || view.type === "project";
    const agentsActive = view.type === "agents";

    return (
      <>
        <div className={`sidebar-rail fixed lg:relative z-40 flex h-full w-[62.72px] shrink-0 flex-col items-center gap-1.5 py-3 transition-all duration-300 ease-in-out ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}>
          <div className="rail-logo-wrap relative mb-1">
            <button
              type="button"
              onClick={handleOpenSidebar}
              className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-[12px] border border-white/10 bg-[#0a0c10] text-white transition-colors hover:border-white/25 hover:bg-[#141720] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--chat-accent)]/60"
              aria-label="Abrir panel"
              aria-describedby="rail-logo-tooltip"
            >
              <NextImage src="/logo.png" alt="" width={40} height={36} className="h-full w-full object-contain" />
            </button>
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#07080b] bg-green-400" title="Asistente en línea" />
            <span id="rail-logo-tooltip" role="tooltip" className="rail-tooltip">
              Abrir panel
            </span>
          </div>

          <div className="rail-divider" />

          <button
            ref={searchBtnRef}
            type="button"
            onClick={() => {
              setAccountMenuOpen(false);
              setSearchPopoverOpen((open) => !open);
            }}
            className={railButton}
            title="Buscar chats"
            aria-label="Buscar chats"
          >
            <Search size={18} strokeWidth={1.7} />
          </button>

          <button
            type="button"
            onClick={() => {
              newChat();
              setView({ type: "chat" });
              setSidebarOpen(false);
            }}
            className={railButton}
            title="Nuevo chat"
            aria-label="Nuevo chat"
          >
            <MessageSquarePlus size={18} strokeWidth={1.7} />
          </button>

          <button
            type="button"
            onClick={() => {
              setView({ type: "agents" });
              setSidebarOpen(false);
            }}
            className={`${railButton} ${agentsActive ? "bg-white/[0.1] text-white" : ""}`}
            title="Hearts"
            aria-label="Hearts"
            aria-current={agentsActive ? "page" : undefined}
          >
            <Brain size={18} strokeWidth={1.7} />
          </button>

          <button
            type="button"
            onClick={() => handleToggleProject("__toggle")}
            className={`${railButton} ${projectsActive ? "bg-white/[0.1] text-white" : ""}`}
            title="Proyectos"
            aria-label="Proyectos"
            aria-current={projectsActive ? "page" : undefined}
          >
            <Folder size={18} strokeWidth={1.7} />
            {activeProject && (
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-green-400" />
            )}
          </button>

          <div className="flex-1" />

          <button
            type="button"
            onClick={() => {
              setSearchPopoverOpen(false);
              setPopoverSearch("");
              setAccountMenuOpen((open) => !open);
            }}
            className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-[#16181f] text-[11px] font-bold text-white transition-colors hover:border-white/25 hover:bg-[#20232c]"
            title={user?.name || user?.email || "Cuenta"}
            aria-label="Cuenta"
            aria-expanded={accountMenuOpen}
            aria-controls="sidebar-account-menu"
          >
            {user?.picture ? (
              <NextImage src={user.picture} alt="" width={36} height={36} className="h-full w-full object-cover" />
            ) : (
              <span>{userInitial}</span>
            )}
          </button>
        </div>

        {accountMenuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setAccountMenuOpen(false)} />
            <div
              id="sidebar-account-menu"
              className={`fixed lg:absolute z-40 left-[66.72px] bottom-[56px] w-64 ${colors.popoverBg} ${colors.popoverBorder} border rounded-xl shadow-xl p-2`}
            >
              <div className="px-2 py-1.5">
                <p className={`truncate text-xs font-medium ${colors.text}`}>
                  {user?.name || user?.email || "Cuenta"}
                </p>
                {user?.email && (
                  <p className={`truncate text-[10px] ${colors.textMuted}`}>{user.email}</p>
                )}
              </div>
              <div className={`my-1 border-t ${colors.border}`} />
              <a
                href="/api/auth/logout"
                className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-red-400 transition-colors hover:bg-red-500/10"
              >
                <LogOut size={14} />
                Cerrar sesión
              </a>
            </div>
          </>
        )}

        {searchPopoverOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => { setSearchPopoverOpen(false); setPopoverSearch(""); }} />
            <div ref={popoverRef} className={`fixed lg:absolute z-40 left-[66.72px] top-[100px] w-72 ${colors.popoverBg} ${colors.popoverBorder} border rounded-xl shadow-xl p-2`}>
              <div className="relative mb-1">
                <Search size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 ${colors.textMuted}`} />
                <input value={popoverSearch} onChange={(e) => setPopoverSearch(e.target.value)} placeholder="Buscar chats..." autoFocus className={`w-full pl-9 pr-3 py-2 text-sm ${colors.inputBg} ${colors.text} ${colors.placeholder} rounded-lg outline-none ${colors.inputFocus} transition-colors`} />
              </div>
              <div className="max-h-60 overflow-y-auto">
                {filteredPopoverChats.length === 0 && (
                  <p className={`px-3 py-4 text-xs text-center ${colors.textMuted}`}>{popoverSearch ? "Sin resultados" : "No hay chats aún"}</p>
                )}
                {filteredPopoverChats.map((chat) => (
                  <button key={chat.id} onClick={() => handlePopoverChatClick(chat)} className={`w-full text-left px-3 py-2 text-sm ${colors.textMuted} ${colors.hover} rounded-lg transition-colors truncate`}>
                    {chat.title}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </>
    );
  };

  return (
    <>
      {sidebarOpen && !sidebarHidden && (
        <div className={`fixed inset-0 ${colors.overlay} z-30 lg:hidden`} onClick={() => setSidebarOpen(false)} />
      )}

      {collapsed ? renderCollapsed() : (
        <>
          {renderExpanded()}
          {sidebarHidden && (
            <button onClick={handleRestoreSidebar} className="hidden lg:flex fixed left-2 top-1/2 -translate-y-1/2 z-50 p-2 rounded-lg bg-[#121824] border border-[#202938] shadow-xl text-gray-400 hover:text-white hover:bg-[#1e293b] transition" title="Mostrar sidebar">
              <PanelLeft size={20} />
            </button>
          )}
        </>
      )}

    </>
  );
}

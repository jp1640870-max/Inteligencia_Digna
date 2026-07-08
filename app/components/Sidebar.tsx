"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import {
  PanelLeft,
  PanelLeftClose,
  MessageSquarePlus,
  Image,
  FileText,
  Folder,
  Search,
  Moon,
  Sun,
  EllipsisVertical,
  Share2,
  Pencil,
  Trash2,
  Plus,
  X,
} from "lucide-react";
import type { Chat, Project } from "@/types";

type Props = {
  chats: Chat[];
  search: string;
  menuOpen: string | null;
  sidebarOpen: boolean;
  collapsed: boolean;
  darkMode: boolean;
  projects: Project[];
  projectChats: Record<string, Chat[]>;
  expandedProjectId: string | null;
  projectSearch: string;
  newProjectName: string;
  showNewProjectInput: boolean;
  onToggleDarkMode: () => void;
  onNewChat: () => void;
  onOpenChat: (chat: Chat) => void;
  onDeleteChat: (id: string) => void;
  onShareChat: (chat: Chat) => void;
  onRenameChat: (chat: Chat) => void;
  onSearch: (val: string) => void;
  onMenuToggle: (id: string | null) => void;
  onToggleSidebar: () => void;
  onToggleCollapse: () => void;
  onFilesSelected: (files: FileList) => void;
  onToggleProject: (projectId: string) => void;
  onDoubleClickProject: (projectId: string) => void;
  onOpenChatInProject: (chat: Chat, projectId: string) => void;
  onAddChatToProject: (projectId: string) => void;
  onRemoveChatFromProject: (projectId: string, chatId: string) => void;
  onProjectSearch: (val: string) => void;
  onNewProjectNameChange: (val: string) => void;
  onShowNewProjectInput: (val: boolean) => void;
  onCreateProject: () => void;
  onAddChatToProjectById: (projectId: string, chatId: string) => void;
  onCreateProjectAndAddChat: (name: string, chatId: string) => void;
};

const SIDEBAR_DEFAULT_WIDTH = 280;
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 500;
const SIDEBAR_HIDE_THRESHOLD = 50;

const Sidebar = ({
  chats,
  search,
  menuOpen,
  sidebarOpen,
  collapsed,
  darkMode,
  projects,
  projectChats,
  expandedProjectId,
  projectSearch,
  newProjectName,
  showNewProjectInput,
  onToggleDarkMode,
  onNewChat,
  onOpenChat,
  onDeleteChat,
  onShareChat,
  onRenameChat,
  onSearch,
  onMenuToggle,
  onToggleSidebar,
  onToggleCollapse,
  onFilesSelected,
  onToggleProject,
  onDoubleClickProject,
  onOpenChatInProject,
  onAddChatToProject,
  onRemoveChatFromProject,
  onProjectSearch,
  onNewProjectNameChange,
  onShowNewProjectInput,
  onCreateProject,
  onAddChatToProjectById,
  onCreateProjectAndAddChat,
}: Props) => {
  const analyzeInputRef = useRef<HTMLInputElement>(null);
  const [searchPopoverOpen, setSearchPopoverOpen] = useState(false);
  const [popoverSearch, setPopoverSearch] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchBtnRef = useRef<HTMLButtonElement>(null);

  const [showAddToProjectModal, setShowAddToProjectModal] = useState<string | null>(null);
  const [newProjectNameInModal, setNewProjectNameInModal] = useState("");

  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
    },
    []
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX;
      if (newWidth < SIDEBAR_HIDE_THRESHOLD) {
        setSidebarHidden(true);
        setIsResizing(false);
        return;
      }
      setSidebarWidth(
        Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, newWidth))
      );
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  const handleProjectClick = (projectId: string) => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      onDoubleClickProject(projectId);
    } else {
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        onToggleProject(projectId);
      }, 300);
    }
  };

  const colors = {
    sidebar: darkMode ? "bg-[#0d131d]" : "bg-gray-100",
    border: darkMode ? "border-[#202938]" : "border-gray-300",
    card: darkMode ? "bg-[#121824]" : "bg-white",
    hover: darkMode ? "hover:bg-[#1e293b]" : "hover:bg-gray-200",
    text: darkMode ? "text-gray-300" : "text-gray-700",
    textMuted: darkMode ? "text-gray-400" : "text-gray-500",
    textHover: darkMode ? "hover:text-gray-300" : "hover:text-gray-900",
    textRed: darkMode ? "text-red-400" : "text-red-500",
    inputBg: darkMode ? "bg-transparent" : "bg-white",
    inputFocus: darkMode ? "focus:bg-[#1e293b]" : "focus:bg-gray-100",
    placeholder: darkMode ? "placeholder-gray-500" : "placeholder-gray-400",
    overlay: darkMode ? "bg-black/50" : "bg-black/30",
    popoverBg: darkMode ? "bg-[#121824]" : "bg-white",
    popoverBorder: darkMode ? "border-[#202938]" : "border-gray-300",
    iconColor: darkMode ? "text-gray-400" : "text-gray-500",
    iconHover: darkMode ? "hover:text-white" : "hover:text-gray-900",
  };

  const handleOpenChat = (chat: Chat) => {
    onOpenChat(chat);
    onToggleSidebar();
  };

  const handleCollapsedSearchClick = () => {
    if (collapsed) {
      setSearchPopoverOpen((v) => !v);
      setPopoverSearch("");
    }
  };

  const filteredChats = chats.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  const filteredPopoverChats = chats.filter((c) =>
    c.title.toLowerCase().includes(popoverSearch.toLowerCase())
  );

  const handlePopoverChatClick = (chat: Chat) => {
    onOpenChat(chat);
    setSearchPopoverOpen(false);
    setPopoverSearch("");
    if (sidebarOpen) onToggleSidebar();
  };

  const handleRestoreSidebar = () => {
    setSidebarHidden(false);
    setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
  };

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(projectSearch.toLowerCase())
  );

  const renderExpanded = () => (
    <div
      ref={sidebarRef}
      style={{ width: sidebarWidth }}
      className={`fixed lg:relative z-40 h-full ${colors.sidebar} ${colors.border} border-r flex flex-col transition-all duration-300 ease-in-out ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      } lg:translate-x-0 ${
        sidebarHidden ? "lg:-translate-x-full" : ""
      } overflow-hidden shrink-0`}
    >
      <div className="flex items-center justify-between pt-5 pb-4 px-3">
        <div className="flex-1 flex justify-center">
          <img src="/LogoSaludDigna.svg" className="w-24 h-24" alt="Logo" />
        </div>
        <button
          onClick={onToggleCollapse}
          className={`p-1.5 rounded-lg ${colors.hover} ${colors.iconColor} ${colors.iconHover} transition shrink-0`}
          title="Colapsar sidebar"
        >
          <PanelLeftClose size={18} />
        </button>
      </div>

      <div className="px-3 space-y-0.5">
        <button
          onClick={() => { onNewChat(); onToggleSidebar(); }}
          className={`w-full flex items-center gap-3 px-3 py-2 text-sm ${colors.text} ${colors.hover} rounded-lg transition-colors`}
        >
          <MessageSquarePlus size={18} />
          Nuevo chat
        </button>
        <button className={`w-full flex items-center gap-3 px-3 py-2 text-sm ${colors.text} ${colors.hover} rounded-lg transition-colors`}>
          <Image size={18} />
          Crear imagen
        </button>
        <button
          onClick={() => analyzeInputRef.current?.click()}
          className={`w-full flex items-center gap-3 px-3 py-2 text-sm ${colors.text} ${colors.hover} rounded-lg transition-colors`}
        >
          <FileText size={18} />
          Analizar archivo
        </button>
      </div>

      <div className="px-3 pt-3 pb-1">
        <div className="flex items-center justify-between mb-1">
          <button
            onClick={() => onToggleProject("__toggle")}
            className={`flex items-center gap-1.5 text-xs font-semibold ${colors.textMuted} uppercase tracking-wider hover:${colors.text} transition-colors`}
          >
            <Folder size={14} />
            Proyectos
            <span className={`text-[11px] ${colors.textMuted}`}>{projects.length}</span>
          </button>
          <button
            onClick={() => onShowNewProjectInput(true)}
            className={`p-1 rounded ${colors.hover} ${colors.iconColor} ${colors.iconHover} transition`}
            title="Nuevo proyecto"
          >
            <Plus size={14} />
          </button>
        </div>

        {showNewProjectInput && (
          <div className="mb-2">
            <input
              value={newProjectName}
              onChange={(e) => onNewProjectNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onCreateProject();
                if (e.key === "Escape") onShowNewProjectInput(false);
              }}
              placeholder="Nombre del proyecto"
              autoFocus
              className={`w-full px-2.5 py-1.5 text-xs rounded-lg ${colors.inputBg} ${colors.border} border ${colors.text} ${colors.placeholder} outline-none ${colors.inputFocus} transition-colors`}
            />
            <div className="flex gap-2 mt-1">
              <button onClick={onCreateProject} className="text-xs text-green-400 hover:underline">Crear</button>
              <button onClick={() => onShowNewProjectInput(false)} className={`text-xs ${colors.textMuted} hover:underline`}>Cancelar</button>
            </div>
          </div>
        )}

        <div className="relative mt-1">
          <Search size={14} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${colors.textMuted}`} />
          <input
            value={projectSearch}
            onChange={(e) => onProjectSearch(e.target.value)}
            placeholder="Buscar proyectos..."
            className={`w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg ${colors.inputBg} ${colors.border} border ${colors.text} ${colors.placeholder} outline-none ${colors.inputFocus} transition-colors`}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 mt-1">
        {filteredProjects.length === 0 && (
          <p className={`px-3 py-2 text-xs text-center ${colors.textMuted}`}>
            {projectSearch ? "Sin resultados" : "Sin proyectos"}
          </p>
        )}
        {filteredProjects.map((project) => {
          const isExpanded = expandedProjectId === project.id;
          const projectChatList = projectChats[project.id] || [];
          return (
            <div key={project.id} className="mb-0.5">
              <div className={`flex items-center rounded-lg ${colors.hover} transition-colors`}>
                <button
                  onClick={() => handleProjectClick(project.id)}
                  className={`flex-1 text-left px-3 py-2 text-sm ${colors.text} truncate flex items-center gap-1.5`}
                  title="Click: expandir · Doble click: abrir"
                >
                  <span className="shrink-0 text-[10px]">{isExpanded ? "▾" : "▸"}</span>
                  <Folder size={14} className="shrink-0" />
                  <span className="truncate">{project.name}</span>
                  <span className={`text-[10px] ${colors.textMuted} shrink-0`}>({project.chat_count || projectChatList.length})</span>
                </button>
                <button
                  onClick={() => onAddChatToProject(project.id)}
                  className={`px-2 py-2 ${colors.textMuted} ${colors.textHover} transition-colors`}
                  title="Agregar chat"
                >
                  <Plus size={14} />
                </button>
              </div>

              {isExpanded && (
                <div className={`ml-4 border-l ${darkMode ? "border-[#202938]" : "border-gray-300"} pl-2 mt-0.5 space-y-0.5`}>
                  {projectChatList.length === 0 ? (
                    <p className={`px-2 py-1 text-xs ${colors.textMuted}`}>Sin chats</p>
                  ) : (
                    projectChatList.map((chat) => (
                      <div key={chat.id} className={`flex items-center rounded-lg ${colors.hover} transition-colors`}>
                        <button
                          onClick={() => onOpenChatInProject(chat, project.id)}
                          className={`flex-1 text-left px-2 py-1 text-xs ${colors.textMuted} truncate`}
                        >
                          {chat.title}
                        </button>
                        <button
                          onClick={() => onRemoveChatFromProject(project.id, chat.id)}
                          className={`px-1 py-1 ${colors.textMuted} hover:text-red-400 transition-colors`}
                          title="Quitar del proyecto"
                        >
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

        <div className={`border-t ${colors.border} my-2`} />

        <div className="px-3 py-1">
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`text-xs font-semibold ${colors.textMuted} uppercase tracking-wider`}>Chats</span>
            <span className={`text-[11px] ${colors.textMuted}`}>{filteredChats.length}</span>
          </div>
          <div className="relative">
            <Search size={14} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${colors.textMuted}`} />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Buscar chats..."
              className={`w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg ${colors.inputBg} ${colors.border} border ${colors.text} ${colors.placeholder} outline-none ${colors.inputFocus} transition-colors`}
            />
          </div>
        </div>

        {filteredChats.length === 0 && (
          <p className={`px-3 py-4 text-xs text-center ${colors.textMuted}`}>
            {search ? "Sin resultados" : "No hay chats aún"}
          </p>
        )}
        {filteredChats.map((chat) => (
          <div key={chat.id} className="relative mb-0.5">
            <div className={`flex items-center rounded-lg ${colors.hover} transition-colors`}>
              <button
                onClick={() => handleOpenChat(chat)}
                className={`flex-1 text-left px-3 py-2 text-sm ${colors.textMuted} truncate`}
              >
                {chat.title}
              </button>
              <button
                onClick={() => onMenuToggle(menuOpen === chat.id ? null : chat.id)}
                className={`px-2 py-2 ${colors.textMuted} ${colors.textHover} transition-colors`}
              >
                <EllipsisVertical size={16} />
              </button>
            </div>

            {menuOpen === chat.id && (
              <div className={`absolute right-2 top-10 ${colors.sidebar} ${colors.border} border rounded-xl w-48 z-50 shadow-lg`}>
                <button onClick={() => onShareChat(chat)} className={`w-full flex items-center gap-2 px-3 py-2 text-sm ${colors.text} ${colors.hover} rounded-t-xl transition-colors`}>
                  <Share2 size={16} />
                  Compartir
                </button>
                <button
                  onClick={() => onRenameChat(chat)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm ${colors.text} ${colors.hover} transition-colors`}
                >
                  <Pencil size={16} />
                  Renombrar
                </button>
                <button
                  onClick={() => { onMenuToggle(null); setShowAddToProjectModal(chat.id); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm ${colors.text} ${colors.hover} transition-colors`}
                >
                  <Folder size={16} />
                  Agregar a proyecto
                </button>
                <button
                  onClick={() => onDeleteChat(chat.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm ${colors.textRed} ${colors.hover} rounded-b-xl transition-colors`}
                >
                  <Trash2 size={16} />
                  Eliminar
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className={`p-3 border-t ${colors.border}`}>
        <button
          onClick={onToggleDarkMode}
          className={`w-full flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors ${colors.text} ${colors.hover}`}
          title={darkMode ? "Modo claro" : "Modo oscuro"}
        >
          {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          <span>{darkMode ? "Modo claro" : "Modo oscuro"}</span>
        </button>
      </div>

      <input
        ref={analyzeInputRef}
        type="file"
        accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.csv,.png,.jpg,.jpeg,.gif"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) onFilesSelected(e.target.files);
          e.target.value = "";
        }}
      />

      <div
        className={`hidden lg:block absolute right-0 top-0 h-full w-1 cursor-col-resize z-50 transition-colors ${
          isResizing
            ? "bg-green-500"
            : "bg-transparent hover:bg-green-500/40"
        }`}
        onMouseDown={handleResizeStart}
      />
    </div>
  );

  const renderCollapsed = () => (
    <>
      <div
        className={`fixed lg:relative z-40 h-full w-[64px] ${colors.sidebar} ${colors.border} border-r flex flex-col items-center py-3 gap-1 transition-all duration-300 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0 shrink-0`}
      >
        <button
          onClick={onToggleCollapse}
          className={`p-2 rounded-lg ${colors.hover} ${colors.iconColor} ${colors.iconHover} transition mb-2`}
          title="Expandir sidebar"
        >
          <PanelLeft size={20} />
        </button>

        <button
          onClick={() => { onNewChat(); onToggleSidebar(); }}
          className={`p-2 rounded-lg ${colors.hover} ${colors.iconColor} ${colors.iconHover} transition`}
          title="Nuevo chat"
        >
          <MessageSquarePlus size={20} />
        </button>

        <button
          onClick={() => onToggleProject("__toggle")}
          className={`p-2 rounded-lg ${colors.hover} ${colors.iconColor} ${colors.iconHover} transition`}
          title="Proyectos"
        >
          <Folder size={20} />
        </button>

        <button
          ref={searchBtnRef}
          onClick={handleCollapsedSearchClick}
          className={`p-2 rounded-lg ${colors.hover} ${colors.iconColor} ${colors.iconHover} transition`}
          title="Buscar chats"
        >
          <Search size={20} />
        </button>

        <div className="flex-1" />

        <button
          onClick={onToggleDarkMode}
          className={`p-2 rounded-lg ${colors.hover} ${colors.iconColor} ${colors.iconHover} transition`}
          title={darkMode ? "Modo claro" : "Modo oscuro"}
        >
          {darkMode ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </div>

      {searchPopoverOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => { setSearchPopoverOpen(false); setPopoverSearch(""); }} />
          <div
            ref={popoverRef}
            className={`fixed lg:absolute z-40 left-[68px] top-1 w-72 ${colors.popoverBg} ${colors.popoverBorder} border rounded-xl shadow-xl p-2`}
          >
            <div className="relative mb-1">
              <Search size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 ${colors.textMuted}`} />
              <input
                value={popoverSearch}
                onChange={(e) => setPopoverSearch(e.target.value)}
                placeholder="Buscar chats..."
                autoFocus
                className={`w-full pl-9 pr-3 py-2 text-sm ${colors.inputBg} ${colors.text} ${colors.placeholder} rounded-lg outline-none ${colors.inputFocus} transition-colors`}
              />
            </div>
            <div className="max-h-60 overflow-y-auto">
              {filteredPopoverChats.length === 0 && (
                <p className={`px-3 py-4 text-xs text-center ${colors.textMuted}`}>
                  {popoverSearch ? "Sin resultados" : "No hay chats aún"}
                </p>
              )}
              {filteredPopoverChats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => handlePopoverChatClick(chat)}
                  className={`w-full text-left px-3 py-2 text-sm ${colors.textMuted} ${colors.hover} rounded-lg transition-colors truncate`}
                >
                  {chat.title}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );

  return (
    <>
      {sidebarOpen && !collapsed && !sidebarHidden && (
        <div
          className={`fixed inset-0 ${colors.overlay} z-30 lg:hidden`}
          onClick={onToggleSidebar}
        />
      )}

      {collapsed ? renderCollapsed() : (
        <>
          {renderExpanded()}

          {sidebarHidden && (
            <button
              onClick={handleRestoreSidebar}
              className="hidden lg:flex fixed left-2 top-1/2 -translate-y-1/2 z-50 p-2 rounded-lg bg-[#121824] border border-[#202938] shadow-xl text-gray-400 hover:text-white hover:bg-[#1e293b] transition"
              title="Mostrar sidebar"
            >
              <PanelLeft size={20} />
            </button>
          )}
        </>
      )}

      {/* Add to project modal */}
      {showAddToProjectModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => { setShowAddToProjectModal(null); setNewProjectNameInModal(""); }}>
          <div className="bg-[#121824] border border-[#202938] rounded-2xl p-6 w-96 max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Agregar a proyecto</h3>

            {projects.length > 0 && (
              <>
                <p className="text-xs text-gray-500 mb-2">Proyectos existentes</p>
                <div className="space-y-1 mb-4">
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        onAddChatToProjectById(p.id, showAddToProjectModal);
                        setShowAddToProjectModal(null);
                      }}
                      className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-[#1e293b] transition-colors flex items-center gap-2"
                    >
                      <Folder size={14} className="shrink-0 text-gray-400" />
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
                <div className={`border-t ${colors.border} my-3`} />
              </>
            )}

            <p className="text-xs text-gray-500 mb-2">Crear nuevo proyecto</p>
            <input
              value={newProjectNameInModal}
              onChange={(e) => setNewProjectNameInModal(e.target.value)}
              placeholder="Nombre del proyecto"
              className={`w-full px-3 py-2 text-sm rounded-lg ${colors.inputBg} ${colors.border} border ${colors.text} ${colors.placeholder} outline-none ${colors.inputFocus} transition-colors mb-2`}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newProjectNameInModal.trim()) {
                  onCreateProjectAndAddChat(newProjectNameInModal.trim(), showAddToProjectModal);
                  setShowAddToProjectModal(null);
                  setNewProjectNameInModal("");
                }
              }}
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (!newProjectNameInModal.trim()) return;
                  onCreateProjectAndAddChat(newProjectNameInModal.trim(), showAddToProjectModal);
                  setShowAddToProjectModal(null);
                  setNewProjectNameInModal("");
                }}
                disabled={!newProjectNameInModal.trim()}
                className="flex-1 py-2 rounded-xl bg-green-500 hover:bg-green-600 disabled:opacity-50 text-sm font-medium transition-colors"
              >
                Crear y agregar
              </button>
              <button
                onClick={() => { setShowAddToProjectModal(null); setNewProjectNameInModal(""); }}
                className="px-4 py-2 text-sm text-gray-500 hover:underline"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Sidebar;

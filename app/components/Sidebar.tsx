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
} from "lucide-react";
import type { Chat } from "@/types";

type Props = {
  chats: Chat[];
  search: string;
  menuOpen: string | null;
  sidebarOpen: boolean;
  collapsed: boolean;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onNewChat: () => void;
  onOpenChat: (chat: Chat) => void;
  onDeleteChat: (id: string) => void;
  onShareChat: (chat: Chat) => void;
  onSearch: (val: string) => void;
  onMenuToggle: (id: string | null) => void;
  onToggleSidebar: () => void;
  onToggleCollapse: () => void;
  onFilesSelected: (files: FileList) => void;
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
  onToggleDarkMode,
  onNewChat,
  onOpenChat,
  onDeleteChat,
  onShareChat,
  onSearch,
  onMenuToggle,
  onToggleSidebar,
  onToggleCollapse,
  onFilesSelected,
}: Props) => {
  const analyzeInputRef = useRef<HTMLInputElement>(null);
  const [searchPopoverOpen, setSearchPopoverOpen] = useState(false);
  const [popoverSearch, setPopoverSearch] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchBtnRef = useRef<HTMLButtonElement>(null);

  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

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
        <button className={`w-full flex items-center gap-3 px-3 py-2 text-sm ${colors.text} ${colors.hover} rounded-lg transition-colors`}>
          <Folder size={18} />
          Proyectos
        </button>

        <div className="pt-3 pb-1">
          <div className="relative">
            <Search size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 ${colors.textMuted}`} />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Buscar chats..."
              className={`w-full pl-9 pr-3 py-2 text-sm ${colors.inputBg} ${colors.text} ${colors.placeholder} rounded-lg outline-none ${colors.inputFocus} transition-colors`}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 mt-1">
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
                <button className={`w-full flex items-center gap-2 px-3 py-2 text-sm ${colors.text} ${colors.hover} transition-colors`}>
                  <Pencil size={16} />
                  Renombrar
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

        <button className={`p-2 rounded-lg ${colors.hover} ${colors.iconColor} ${colors.iconHover} transition`} title="Proyectos">
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
    </>
  );
};

export default Sidebar;

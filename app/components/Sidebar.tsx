"use client";

import { useRef } from "react";
import type { Chat } from "@/types";

type Props = {
  chats: Chat[];
  search: string;
  menuOpen: string | null;
  sidebarOpen: boolean;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onNewChat: () => void;
  onOpenChat: (chat: Chat) => void;
  onDeleteChat: (id: string) => void;
  onShareChat: (chat: Chat) => void;
  onSearch: (val: string) => void;
  onMenuToggle: (id: string | null) => void;
  onToggleSidebar: () => void;
  onFilesSelected: (files: FileList) => void;
};

const Sidebar = ({
  chats,
  search,
  menuOpen,
  sidebarOpen,
  darkMode,
  onToggleDarkMode,
  onNewChat,
  onOpenChat,
  onDeleteChat,
  onShareChat,
  onSearch,
  onMenuToggle,
  onToggleSidebar,
  onFilesSelected,
}: Props) => {
  const analyzeInputRef = useRef<HTMLInputElement>(null);

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
  };

  const handleOpenChat = (chat: Chat) => {
    onOpenChat(chat);
    onToggleSidebar();
  };

  return (
    <>
      {sidebarOpen && (
        <div
          className={`fixed inset-0 ${colors.overlay} z-30 lg:hidden`}
          onClick={onToggleSidebar}
        />
      )}

      <div
        className={`fixed lg:relative z-40 h-full w-[280px] ${colors.sidebar} ${colors.border} border-r flex flex-col transition-transform duration-300 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0`}
      >
        <div className="flex flex-col items-center pt-5 pb-4">
          <img src="/logo.png" className="w-12 h-12" />
        </div>

        <div className="px-3 space-y-0.5">
          <button
            onClick={() => { onNewChat(); onToggleSidebar(); }}
            className={`w-full flex items-center gap-3 px-3 py-2 text-sm ${colors.text} ${colors.hover} rounded-lg transition-colors`}
          >
            <span className="text-base">➕</span>
            Nuevo chat
          </button>
          <button className={`w-full flex items-center gap-3 px-3 py-2 text-sm ${colors.text} ${colors.hover} rounded-lg transition-colors`}>
            <span className="text-base">🎨</span>
            Crear imagen
          </button>
          <button
            onClick={() => analyzeInputRef.current?.click()}
            className={`w-full flex items-center gap-3 px-3 py-2 text-sm ${colors.text} ${colors.hover} rounded-lg transition-colors`}
          >
            <span className="text-base">📄</span>
            Analizar archivo
          </button>
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
          <button className={`w-full flex items-center gap-3 px-3 py-2 text-sm ${colors.text} ${colors.hover} rounded-lg transition-colors`}>
            <span className="text-base">📁</span>
            Proyectos
          </button>

          <div className="pt-3 pb-1">
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Buscar chats..."
              className={`w-full px-3 py-2 text-sm ${colors.inputBg} ${colors.text} ${colors.placeholder} rounded-lg outline-none ${colors.inputFocus} transition-colors`}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 mt-1">
          {chats
            .filter((c) =>
              c.title.toLowerCase().includes(search.toLowerCase())
            )
            .map((chat) => (
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
                    ⋮
                  </button>
                </div>

                {menuOpen === chat.id && (
                  <div className={`absolute right-2 top-10 ${colors.sidebar} ${colors.border} border rounded-xl w-48 z-50 shadow-lg`}>
                    <button onClick={() => onShareChat(chat)} className={`w-full flex items-center gap-2 px-3 py-2 text-sm ${colors.text} ${colors.hover} rounded-t-xl transition-colors`}>
                      📋 Compartir
                    </button>
                    <button className={`w-full flex items-center gap-2 px-3 py-2 text-sm ${colors.text} ${colors.hover} transition-colors`}>
                      ✏️ Renombrar
                    </button>
                    <button className={`w-full flex items-center gap-2 px-3 py-2 text-sm ${colors.text} ${colors.hover} transition-colors`}>
                      📌 Anclar
                    </button>
                    <button className={`w-full flex items-center gap-2 px-3 py-2 text-sm ${colors.text} ${colors.hover} transition-colors`}>
                      📦 Archivar
                    </button>
                    <button
                      onClick={() => onDeleteChat(chat.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm ${colors.textRed} ${colors.hover} rounded-b-xl transition-colors`}
                    >
                      🗑 Eliminar
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
            {darkMode ? "☀️" : "🌙"}
            <span>{darkMode ? "Modo claro" : "Modo oscuro"}</span>
          </button>
        </div>
      </div>
    </>
  );
};

export default Sidebar;

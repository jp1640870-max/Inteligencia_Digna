"use client";

import { create } from "zustand";

type ViewState =
  | { type: "chat" }
  | { type: "projects" }
  | { type: "project"; id: string };

export type FileItem = {
  file: File;
  name: string;
  size: number;
};

interface UIState {
  // UI
  darkMode: boolean;
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  view: ViewState;
  search: string;

  // Modals
  renameChatId: string | null;
  renameValue: string;
  showAddToProjectChatId: string | null;
  showNewProjectInput: boolean;
  newProjectName: string;
  projectSearch: string;

  // Drag
  dragging: boolean;

  // Actions — UI
  setDarkMode: (v: boolean) => void;
  toggleDarkMode: () => void;
  setSidebarOpen: (v: boolean) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  toggleCollapse: () => void;
  setView: (v: ViewState) => void;
  setSearch: (v: string) => void;
  setDragging: (v: boolean) => void;

  // Actions — Modals
  openRenameModal: (chatId: string, currentTitle: string) => void;
  closeRenameModal: () => void;
  setRenameValue: (v: string) => void;
  openAddToProjectModal: (chatId: string) => void;
  closeAddToProjectModal: () => void;
  setShowNewProjectInput: (v: boolean) => void;
  setNewProjectName: (v: string) => void;
  setProjectSearch: (v: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  // ─── Init ───
  darkMode: true,
  sidebarOpen: false,
  sidebarCollapsed: false,
  view: { type: "chat" },
  search: "",
  renameChatId: null,
  renameValue: "",
  showAddToProjectChatId: null,
  showNewProjectInput: false,
  newProjectName: "",
  projectSearch: "",
  dragging: false,

  // ─── Actions UI ───
  setDarkMode: (v) => set({ darkMode: v }),
  toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  toggleCollapse: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setView: (v) => set({ view: v }),
  setSearch: (v) => set({ search: v }),
  setDragging: (v) => set({ dragging: v }),

  // ─── Actions Modals ───
  openRenameModal: (chatId, currentTitle) =>
    set({ renameChatId: chatId, renameValue: currentTitle }),
  closeRenameModal: () =>
    set({ renameChatId: null, renameValue: "" }),
  setRenameValue: (v) => set({ renameValue: v }),
  openAddToProjectModal: (chatId) =>
    set({ showAddToProjectChatId: chatId }),
  closeAddToProjectModal: () =>
    set({ showAddToProjectChatId: null }),
  setShowNewProjectInput: (v) => set({ showNewProjectInput: v }),
  setNewProjectName: (v) => set({ newProjectName: v }),
  setProjectSearch: (v) => set({ projectSearch: v }),
}));

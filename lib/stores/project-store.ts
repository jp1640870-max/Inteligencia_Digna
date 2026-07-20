"use client";

import { create } from "zustand";
import type { Chat, Project } from "@/types";

interface ProjectState {
  projects: Project[];
  projectChats: Record<string, Chat[]>;
  currentProjectId: string | null;
  expandedProjectId: string | null;

  // Actions
  loadProjects: () => Promise<void>;
  loadProjectChats: (projectId: string) => Promise<void>;
  setCurrentProjectId: (id: string | null) => void;
  setExpandedProjectId: (id: string | null) => void;
  createProject: (name: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  addChatToProject: (projectId: string, chatId: string) => Promise<void>;
  removeChatFromProject: (projectId: string, chatId: string) => Promise<void>;
  createProjectAndAddChat: (name: string, chatId: string) => Promise<Project | null>;
  openChatInProject: (chat: Chat, projectId: string) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  projectChats: {},
  currentProjectId: null,
  expandedProjectId: null,

  loadProjects: async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = await res.json();
        set({ projects: Array.isArray(data) ? data : [] });
      }
    } catch {
      // ignore
    }
  },

  loadProjectChats: async (projectId) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/chats`);
      if (res.ok) {
        const data = await res.json();
        set((s) => ({
          projectChats: { ...s.projectChats, [projectId]: data },
        }));
      }
    } catch {
      // ignore
    }
  },

  setCurrentProjectId: (id) => set({ currentProjectId: id }),
  setExpandedProjectId: (id) => set({ expandedProjectId: id }),

  createProject: async (name) => {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, instructions: "" }),
    });
    if (res.ok) {
      get().loadProjects();
    }
  },

  deleteProject: async (id) => {
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
    }));
  },

  addChatToProject: async (projectId, chatId) => {
    const res = await fetch(`/api/projects/${projectId}/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId }),
    });
    if (res.ok) {
      const data = await res.json();
      set((s) => ({
        projectChats: { ...s.projectChats, [projectId]: data },
      }));
      get().loadProjects();
    }
  },

  removeChatFromProject: async (projectId, chatId) => {
    await fetch(`/api/projects/${projectId}/chats`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId }),
    });
    set((s) => ({
      projectChats: {
        ...s.projectChats,
        [projectId]: (s.projectChats[projectId] || []).filter(
          (c) => c.id !== chatId
        ),
      },
    }));
    get().loadProjects();
  },

  createProjectAndAddChat: async (name, chatId) => {
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, instructions: "" }),
      });
      if (res.ok) {
        const project = await res.json();
        await get().addChatToProject(project.id, chatId);
        get().loadProjects();
        return project;
      }
    } catch {
      // ignore
    }
    return null;
  },

  openChatInProject: (chat, projectId) => {
    // This is a cross-store action; we handle it via the subscriber pattern
    // in the page component which listens to external changes
    set({ currentProjectId: projectId });
  },
}));

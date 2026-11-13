"use client";

import { create } from "zustand";
import type { Agent } from "@/types";
import type { HeartDraft } from "@/lib/heart-config";

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

interface AgentsState {
  agents: Agent[];
  loading: boolean;
  loaded: boolean;
  error: string | null;

  loadAgents: (force?: boolean) => Promise<void>;
  createAgent: (draft: HeartDraft) => Promise<Agent | null>;
  updateAgent: (id: string, draft: HeartDraft) => Promise<Agent | null>;
  duplicateAgent: (id: string) => Promise<Agent | null>;
  deleteAgent: (id: string) => Promise<boolean>;
  clearError: () => void;
}

export const useAgentsStore = create<AgentsState>((set, get) => ({
  agents: [],
  loading: false,
  loaded: false,
  error: null,

  loadAgents: async (force = false) => {
    if (get().loading) return;
    if (get().loaded && !force) return;

    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/hearts");
      if (!res.ok) {
        set({
          loading: false,
          error: await readError(res, "No se pudieron cargar los Hearts."),
        });
        return;
      }

      const data = (await res.json()) as { agents?: Agent[] };
      set({
        agents: Array.isArray(data.agents) ? data.agents : [],
        loading: false,
        loaded: true,
      });
    } catch {
      set({
        loading: false,
        error: "No se pudieron cargar los Hearts.",
      });
    }
  },

  createAgent: async (draft) => {
    set({ error: null });
    try {
      const res = await fetch("/api/hearts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        set({ error: await readError(res, "No se pudo crear el Heart.") });
        return null;
      }

      const data = (await res.json()) as { agent: Agent };
      set((state) => ({ agents: [data.agent, ...state.agents], loaded: true }));
      return data.agent;
    } catch {
      set({ error: "No se pudo crear el Heart." });
      return null;
    }
  },

  updateAgent: async (id, draft) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/hearts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        set({ error: await readError(res, "No se pudo actualizar el Heart.") });
        return null;
      }

      const data = (await res.json()) as { agent: Agent };
      set((state) => ({
        agents: state.agents.map((agent) => (agent.id === id ? data.agent : agent)),
      }));
      return data.agent;
    } catch {
      set({ error: "No se pudo actualizar el Heart." });
      return null;
    }
  },

  duplicateAgent: async (id) => {
    const source = get().agents.find((agent) => agent.id === id);
    if (!source) return null;

    return get().createAgent({
      name: `${source.name} (copia)`.slice(0, 80),
      role: source.role,
      tone: source.tone,
      instructions: source.instructions,
      limitations: source.limitations,
      temperature: source.temperature,
      tools: source.tools,
    });
  },

  deleteAgent: async (id) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/hearts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        set({ error: await readError(res, "No se pudo eliminar el Heart.") });
        return false;
      }

      set((state) => ({
        agents: state.agents.filter((agent) => agent.id !== id),
      }));
      return true;
    } catch {
      set({ error: "No se pudo eliminar el Heart." });
      return false;
    }
  },

  clearError: () => set({ error: null }),
}));

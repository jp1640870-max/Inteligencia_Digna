"use client";

import { create } from "zustand";
import type { UserRole } from "@/types";

export type UserInfo = {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  role: UserRole;
};

interface AuthState {
  user: UserInfo | null;
  loading: boolean;

  loadUser: () => Promise<void>;
  setUser: (u: UserInfo | null) => void;
  logout: () => Promise<void>;
  hasAccess: (allowedRoles: UserRole[]) => boolean;
}

export const ADMIN_VISIBLE_ROLES: UserRole[] = [
  "super_admin",
  "admin",
  "editor",
  "viewer",
];

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: true,

  loadUser: async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const u = await res.json();
        set({
          user: {
            id: u.id,
            email: u.email,
            name: u.name || null,
            picture: u.picture || null,
            role: u.role || "user",
          },
          loading: false,
        });
      } else {
        set({ user: null, loading: false });
      }
    } catch {
      set({ user: null, loading: false });
    }
  },

  setUser: (u) => set({ user: u }),

  logout: async () => {
    try {
      await fetch("/api/auth/logout");
    } catch {
      // ignore
    }
    set({ user: null });
    window.location.href = "/login";
  },

  hasAccess: (allowedRoles) => {
    const user = get().user;
    if (!user) return false;
    return allowedRoles.includes(user.role);
  },
}));

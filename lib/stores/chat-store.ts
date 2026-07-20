"use client";

import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import type { Msg, Chat, EditResult, SearchResult } from "@/types";

export type FileItem = {
  file: File;
  name: string;
  size: number;
};

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

const EDIT_KEYWORDS = /\b(agrega|añade|inserta|elimina|borra|modifica|cambia|edita|editar|columna|fila|celda|renombra|actualiza|pone|pon)\b/i;

function checkAutoSearch(text: string): boolean {
  const lower = text.toLowerCase();
  return SEARCH_KEYWORDS.some((kw) => lower.includes(kw));
}

interface ChatState {
  // State
  messages: Msg[];
  chatId: string;
  chats: Chat[];
  loading: boolean;
  searching: boolean;
  input: string;
  images: string[];
  files: FileItem[];

  // Edit mode
  editFile: File | null;
  editInstruction: string;
  isEditMode: boolean;
  editLoading: boolean;
  typeChoiceFile: File | null;

  // Abort
  abortController: AbortController | null;

  // Auto-scroll
  autoScroll: boolean;

  // Actions — chat CRUD
  loadChats: () => Promise<void>;
  newChat: (currentProjectId?: string | null) => void;
  openChat: (chat: Chat) => void;
  deleteChat: (id: string) => Promise<void>;
  renameChat: (id: string, title: string) => Promise<boolean>;
  shareChat: (chat: Chat) => Promise<void>;

  // Actions — message
  setInput: (v: string) => void;
  setImages: (v: string[]) => void;
  setFiles: (v: FileItem[]) => void;
  setMessages: (v: Msg[] | ((prev: Msg[]) => Msg[])) => void;
  setChats: (v: Chat[]) => void;
  setChatId: (v: string) => void;
  setLoading: (v: boolean) => void;
  setSearching: (v: boolean) => void;
  setAutoScroll: (v: boolean) => void;

  // Actions — edit
  handleEditFileToggle: () => void;
  setEditFile: (f: File | null) => void;
  setEditInstruction: (v: string) => void;
  setTypeChoiceFile: (f: File | null) => void;
  handleEditFlow: (file: File, instruction: string, projectId?: string | null) => Promise<void>;

  // Actions — send
  sendMessage: (currentProjectId?: string | null, textOverride?: string, editFromIndex?: number) => Promise<void>;
  handleStop: () => void;
  handleRegenerate: (currentProjectId?: string | null) => Promise<void>;
  handleEditMessage: (index: number, newText: string, projectId?: string | null) => Promise<void>;

  // Actions — files
  handlePaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  handleFilesSelected: (fileList: FileList) => void;
  handleEditFileSelected: (file: File) => boolean;
}

export const useChatStore = create<ChatState>((set, get) => ({
  // ─── Init ───
  messages: [],
  chatId: uuidv4(),
  chats: [],
  loading: false,
  searching: false,
  input: "",
  images: [],
  files: [],
  editFile: null,
  editInstruction: "",
  isEditMode: false,
  editLoading: false,
  typeChoiceFile: null,
  abortController: null,
  autoScroll: true,

  // ─── Setters ───
  setInput: (v) => set({ input: v }),
  setImages: (v) => set({ images: v }),
  setFiles: (v) => set({ files: v }),
  setMessages: (v) =>
    set((s) => ({
      messages: typeof v === "function" ? v(s.messages) : v,
    })),
  setChats: (v) => set({ chats: v }),
  setChatId: (v) => set({ chatId: v }),
  setLoading: (v) => set({ loading: v }),
  setSearching: (v) => set({ searching: v }),
  setAutoScroll: (v) => set({ autoScroll: v }),
  setEditInstruction: (v) => set({ editInstruction: v }),
  setEditFile: (f) => set({ editFile: f }),
  setTypeChoiceFile: (f) => set({ typeChoiceFile: f }),

  // ─── Chat CRUD ───
  loadChats: async () => {
    try {
      const res = await fetch("/api/chat");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const data = await res.json();
      set({ chats: Array.isArray(data) ? data : [] });
    } catch {
      set({ chats: [] });
    }
  },

  newChat: (currentProjectId) => {
    set({
      messages: [],
      input: "",
      images: [],
      files: [],
      chatId: uuidv4(),
    });

    if (currentProjectId) {
      fetch(`/api/projects/${currentProjectId}/chats/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Nueva conversación" }),
      }).then(() => {
        get().loadChats();
      });
    }
  },

  openChat: (chat) => {
    set({
      chatId: chat.id,
      messages: chat.messages,
    });
  },

  deleteChat: async (id) => {
    const res = await fetch(`/api/chat?id=${id}`, { method: "DELETE" });
    if (res.status === 401) {
      window.location.href = "/login";
      return;
    }
    set((s) => ({ chats: s.chats.filter((c) => c.id !== id) }));
    if (id === get().chatId) {
      get().newChat();
    }
  },

  renameChat: async (id, title) => {
    const res = await fetch("/api/chat", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title }),
    });
    if (res.ok) {
      set((s) => ({
        chats: s.chats.map((c) => (c.id === id ? { ...c, title } : c)),
      }));
      return true;
    }
    return false;
  },

  shareChat: async (chat) => {
    await navigator.clipboard.writeText(JSON.stringify(chat, null, 2));
  },

  // ─── Files / Paste / Drop ───
  handlePaste: (e) => {
    for (const item of e.clipboardData.items) {
      if (item.type.includes("image")) {
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () =>
          set((s) => ({ images: [...s.images, reader.result as string] }));
        reader.readAsDataURL(file);
      }
    }
  },

  handleFilesSelected: (fileList) => {
    const newFiles = Array.from(fileList).map((file) => ({
      file,
      name: file.name,
      size: file.size,
    }));
    set((s) => ({ files: [...s.files, ...newFiles] }));
  },

  handleEditFileSelected: (file) => {
    if (!file) return false;
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!["xlsx", "xls", "docx", "pdf"].includes(ext)) {
      return false;
    }
    set({ editFile: file, isEditMode: true });
    return true;
  },

  handleEditFileToggle: () => {
    set((s) => {
      if (s.isEditMode) {
        return { isEditMode: false, editInstruction: "", editFile: null };
      }
      return { isEditMode: true };
    });
  },

  handleEditFlow: async (file, instruction, projectId) => {
    set({ editLoading: true });

    const formData = new FormData();
    formData.append("file", file);
    formData.append("instruction", instruction);
    formData.append("chatId", get().chatId);
    if (projectId) formData.append("projectId", projectId);

    try {
      const res = await fetch("/api/document/edit", {
        method: "POST",
        body: formData,
      });

      if (res.status === 401) {
        window.location.href = "/login";
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

        set((s) => ({
          messages: [
            ...s.messages,
            { role: "user", text: `✏️ Editar archivo: ${file.name}\n\n${instruction}`, files: [{ name: file.name }] },
            { role: "ai", text: "", editResult },
          ],
        }));
      } else {
        const data = await res.json().catch(() => ({}));
        set((s) => ({
          messages: [
            ...s.messages,
            { role: "user", text: `✏️ Editar archivo: ${file.name}\n\n${instruction}`, files: [{ name: file.name }] },
            { role: "ai", text: data.error || "No se pudo editar el documento" },
          ],
        }));
      }
    } catch {
      set((s) => ({
        messages: [
          ...s.messages,
          { role: "user", text: `✏️ Editar archivo: ${file.name}\n\n${instruction}`, files: [{ name: file.name }] },
          { role: "ai", text: "Error de conexión al editar el documento" },
        ],
      }));
    } finally {
      set({
        editLoading: false,
        isEditMode: false,
        editFile: null,
        editInstruction: "",
      });
    }
  },

  // ─── Send / Regenerate / Edit ───
  handleStop: () => {
    get().abortController?.abort();
  },

  handleRegenerate: async (currentProjectId) => {
    const { chatId, messages } = get();
    if (!chatId || messages.length < 2) return;

    set((s) => ({ messages: s.messages.slice(0, -1), loading: true }));

    const controller = new AbortController();
    set({ abortController: controller });

    let accumulated = "";

    try {
      const res = await fetch("/api/chat/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, projectId: currentProjectId }),
        signal: controller.signal,
      });

      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({}));
        set((s) => ({
          messages: [...s.messages, { role: "ai", text: errData.error || "Error al regenerar" }],
        }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      set((s) => ({ messages: [...s.messages, { role: "ai", text: "", searching: false }] }));

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        set((s) => {
          const copy = [...s.messages];
          const last = copy[copy.length - 1];
          if (last?.role === "ai") {
            copy[copy.length - 1] = { role: "ai", text: accumulated };
          }
          return { messages: copy };
        });
      }
    } catch (err: any) {
      if (err?.name === "AbortError" && accumulated) {
        try {
          await fetch("/api/chat/save-partial", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId, content: accumulated }),
          });
        } catch { /* ignore */ }
      }
    } finally {
      set({ abortController: null, loading: false });
      get().loadChats();
    }
  },

  handleEditMessage: async (index, newText, projectId) => {
    const state = get();
    await state.sendMessage(projectId, newText, index);
  },

  sendMessage: async (currentProjectId, textOverride, editFromIndex) => {
    const state = get();
    const messageText = textOverride ?? state.input;

    if (!messageText.trim() && state.images.length === 0 && state.files.length === 0) return;

    // Auto-detect: editable file + edit keywords
    if (messageText.trim() && state.files.length > 0) {
      const editableFile = state.files.find((f) => /\.(xlsx|xls|docx|pdf)$/i.test(f.name));
      if (editableFile && EDIT_KEYWORDS.test(messageText)) {
        set({ input: "", images: [], files: [] });
        await state.handleEditFlow(editableFile.file, messageText, currentProjectId);
        return;
      }
    }

    set({ loading: true });

    const extraImages = [...state.images];
    let filesContent = "";
    let fileNames: { name: string }[] = [];

    if (state.files.length > 0) {
      const uploadForm = new FormData();
      state.files.forEach((f) => uploadForm.append("files", f.file));
      uploadForm.append("chatId", state.chatId);
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
      } catch { /* fallback: solo texto */ }
    }

    const visibleText = messageText || "Analiza este archivo";

    const formData = new FormData();
    formData.append("chatId", state.chatId);
    formData.append("message", visibleText);
    if (currentProjectId) formData.append("projectId", currentProjectId);
    if (filesContent) formData.append("filesContent", filesContent);

    extraImages.forEach((img, i) => {
      formData.append(`image_${i}`, img);
    });

    if (editFromIndex !== undefined) {
      formData.append("editFromIndex", String(editFromIndex));
    }

    const willSearch = checkAutoSearch(visibleText);
    if (willSearch) set({ searching: true });

    set({ input: "", images: [], files: [] });

    set((s) => {
      let newMsgs = [
        ...s.messages,
        { role: "user" as const, text: visibleText, images: extraImages, files: fileNames },
        { role: "ai" as const, text: "" },
      ];
      if (editFromIndex !== undefined) {
        newMsgs = newMsgs.slice(editFromIndex);
      }
      return { messages: newMsgs };
    });

    const controller = new AbortController();
    set({ abortController: controller });
    let accumulated = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }

      const contentType = res.headers.get("Content-Type") || "";

      if (contentType.includes("application/json")) {
        const data = await res.json();
        set({ loading: false, searching: false });
        if (data.type === "document" && data.editResult) {
          let editResult = data.editResult;
          if (editResult.dataUri) {
            try {
              const dataResp = await fetch(editResult.dataUri);
              const blob = await dataResp.blob();
              editResult = { ...editResult, downloadUrl: URL.createObjectURL(blob) };
            } catch { /* ignore */ }
          }
          set((s) => {
            const copy = [...s.messages];
            const last = copy[copy.length - 1];
            if (last?.role === "ai") {
              copy[copy.length - 1] = { role: "ai", text: data.text, editResult };
            }
            return { messages: copy };
          });
        } else {
          set((s) => {
            const copy = [...s.messages];
            const last = copy[copy.length - 1];
            if (last?.role === "ai") {
              copy[copy.length - 1] = { role: "ai", text: data.text || "" };
            }
            return { messages: copy };
          });
        }
        get().loadChats();
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
          set({ searching: false });
        }
        accumulated += decoder.decode(value, { stream: true });

        let displayText = accumulated;
        let sources: SearchResult[] = [];
        const sourcesMatch = accumulated.match(/__SOURCES__:(.+)$/);
        if (sourcesMatch) {
          try {
            sources = JSON.parse(sourcesMatch[1]);
            displayText = accumulated.slice(0, accumulated.lastIndexOf("__SOURCES__:")).trim();
          } catch { /* ignore */ }
        }
        set((s) => {
          const copy = [...s.messages];
          const last = copy[copy.length - 1];
          if (last?.role === "ai") {
            copy[copy.length - 1] = {
              ...last,
              text: displayText,
              sources: sources.length > 0 ? sources : undefined,
            };
          }
          return { messages: copy };
        });
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        if (accumulated) {
          try {
            await fetch("/api/chat/save-partial", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chatId: state.chatId, content: accumulated }),
            });
          } catch { /* ignore */ }
        }
      } else {
        console.error("Error al enviar mensaje:", err);
      }
    } finally {
      set({ abortController: null, loading: false, searching: false });
      get().loadChats();
    }
  },
}));

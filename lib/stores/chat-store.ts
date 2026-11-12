"use client";

import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import type {
  Msg,
  Chat,
  DocumentProgressStage,
  EditResult,
  GeneratedDocumentMeta,
  SearchResult,
} from "@/types";

type DocumentStreamEvent =
  | {
      type: "progress";
      stage?: DocumentProgressStage;
      chars?: number;
      summary?: string;
    }
  | {
      type: "document";
      text?: string;
      document: GeneratedDocumentMeta;
      editResult?: EditResult;
      target?: "previous-ai";
      targetMessageId?: number;
    }
  | { type: "error"; text?: string };

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
  /** Exporta una respuesta existente a PDF sin llamar al modelo. */
  exportMessageAsPdf: (index: number) => Promise<void>;

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
      const chats: Chat[] = Array.isArray(data) ? data : [];
      const current = chats.find((chat) => chat.id === get().chatId);
      if (!current) {
        set({ chats });
        return;
      }

      set((state) => {
        // Los mensajes de la BD son la fuente de verdad (id, documento, orden)
        // y ya incluyen las fuentes web. Se conservan los adjuntos locales y
        // los estados temporales de progreso emparejando por rol y texto para
        // que "Exportar a PDF" tenga un id con el que enlazar el archivo.
        const buckets = new Map<string, Msg[]>();
        for (const msg of state.messages) {
          const key = `${msg.role}\u0000${(msg.text || "").trim()}`;
          const bucket = buckets.get(key);
          if (bucket) bucket.push(msg);
          else buckets.set(key, [msg]);
        }

        const merged = current.messages.map((saved) => {
          const key = `${saved.role}\u0000${(saved.text || "").trim()}`;
          const match = buckets.get(key)?.shift();
          if (!match) return saved;
          return {
            ...saved,
            ...(match.sources ? { sources: match.sources } : {}),
            ...(match.files ? { files: match.files } : {}),
            ...(match.images ? { images: match.images } : {}),
            ...(!saved.document && match.document ? { document: match.document } : {}),
            ...(!saved.editResult && match.editResult ? { editResult: match.editResult } : {}),
            ...(match.documentProgress ? { documentProgress: match.documentProgress } : {}),
          };
        });

        // Si la BD todavía no tiene los mensajes (fallo de persistencia), no
        // se borra la conversación visible.
        const messages =
          current.messages.length === 0 && state.messages.length > 0
            ? state.messages
            : merged;
        return { chats, messages };
      });
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

    // Ids locales estables para los mensajes optimistas de este flujo.
    const userLocalId = uuidv4();
    const aiLocalId = uuidv4();

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
            { role: "user", localId: userLocalId, text: `✏️ Editar archivo: ${file.name}\n\n${instruction}`, files: [{ name: file.name }] },
            { role: "ai", localId: aiLocalId, text: "", editResult },
          ],
        }));
      } else {
        const data = await res.json().catch(() => ({}));
        set((s) => ({
          messages: [
            ...s.messages,
            { role: "user", localId: userLocalId, text: `✏️ Editar archivo: ${file.name}\n\n${instruction}`, files: [{ name: file.name }] },
            { role: "ai", localId: aiLocalId, text: data.error || "No se pudo editar el documento" },
          ],
        }));
      }
    } catch {
      set((s) => ({
        messages: [
          ...s.messages,
          { role: "user", localId: userLocalId, text: `✏️ Editar archivo: ${file.name}\n\n${instruction}`, files: [{ name: file.name }] },
          { role: "ai", localId: aiLocalId, text: "Error de conexión al editar el documento" },
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
    const aiLocalId = uuidv4();

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
          messages: [...s.messages, { role: "ai", localId: aiLocalId, text: errData.error || "Error al regenerar" }],
        }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      set((s) => ({ messages: [...s.messages, { role: "ai", localId: aiLocalId, text: "", searching: false }] }));

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        set((s) => {
          const copy = [...s.messages];
          const last = copy[copy.length - 1];
          if (last?.role === "ai") {
            copy[copy.length - 1] = { ...last, role: "ai", text: accumulated };
          }
          return { messages: copy };
        });
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError" && accumulated) {
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

    const userLocalId = uuidv4();
    const aiLocalId = uuidv4();

    set((s) => {
      let newMsgs = [
        ...s.messages,
        { role: "user" as const, localId: userLocalId, text: visibleText, images: extraImages, files: fileNames },
        { role: "ai" as const, localId: aiLocalId, text: "" },
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

      const contentType = (res.headers.get("Content-Type") || "").toLowerCase();

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
              copy[copy.length - 1] = {
                ...last,
                role: "ai",
                text: data.text,
                editResult,
                ...(data.document ? { document: data.document } : {}),
              };
            }
            return { messages: copy };
          });
        } else {
          set((s) => {
            const copy = [...s.messages];
            const last = copy[copy.length - 1];
            if (last?.role === "ai") {
              copy[copy.length - 1] = { ...last, role: "ai", text: data.text || "" };
            }
            return { messages: copy };
          });
        }
        return;
      }

      if (contentType.includes("application/x-ndjson")) {
        if (!res.body) throw new Error("Sin cuerpo de respuesta");

        const applyEvent = (event: DocumentStreamEvent) => {
          set((s) => {
            const copy = [...s.messages];
            const last = copy[copy.length - 1];
            if (!last || last.role !== "ai") return { messages: copy };

            if (event.type === "progress") {
              const previousSummary = last.documentProgress?.summary;
              const summary = event.summary || previousSummary;
              copy[copy.length - 1] = {
                ...last,
                documentProgress: {
                  stage: event.stage || "writing",
                  ...(typeof event.chars === "number" ? { chars: event.chars } : {}),
                  ...(summary ? { summary } : {}),
                },
              };
              return { messages: copy };
            }

            if (event.type === "document") {
              let targetIndex = -1;
              if (event.target === "previous-ai") {
                if (event.targetMessageId !== undefined) {
                  targetIndex = copy.findIndex(
                    (item) => item.id === event.targetMessageId,
                  );
                }
                if (targetIndex < 0) {
                  // Respaldo para respuestas recién transmitidas sin id: la
                  // tarjeta va a la respuesta anterior, no a la confirmación.
                  for (let i = copy.length - 2; i >= 0; i--) {
                    if (copy[i].role === "ai") {
                      targetIndex = i;
                      break;
                    }
                  }
                }
              }

              if (targetIndex >= 0) {
                copy[targetIndex] = {
                  ...copy[targetIndex],
                  document: event.document,
                  editResult: event.editResult,
                  documentProgress: undefined,
                };
                copy[copy.length - 1] = {
                  ...last,
                  text: event.text ?? last.text,
                  documentProgress: undefined,
                };
              } else {
                copy[copy.length - 1] = {
                  ...last,
                  text: event.text ?? last.text,
                  document: event.document,
                  editResult: event.editResult,
                  documentProgress: undefined,
                };
              }
              return { messages: copy };
            }

            copy[copy.length - 1] = {
              ...last,
              text: event.text || "No se pudo generar el documento.",
              documentProgress: undefined,
            };
            return { messages: copy };
          });
        };

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const processLine = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          try {
            applyEvent(JSON.parse(trimmed) as DocumentStreamEvent);
          } catch {
            /* línea incompleta o evento desconocido */
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline = buffer.indexOf("\n");
          while (newline >= 0) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            processLine(line);
            newline = buffer.indexOf("\n");
          }
        }
        buffer += decoder.decode();
        processLine(buffer);

        set({ loading: false, searching: false });
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
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
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
      // Si el stream de documento se corta (aborto, red o error no emitido),
      // no debe quedar una tarjeta de progreso girando para siempre.
      set((s) => {
        const copy = [...s.messages];
        const last = copy[copy.length - 1];
        if (last?.role === "ai" && last.documentProgress) {
          copy[copy.length - 1] = {
            ...last,
            documentProgress: undefined,
            text: last.text || "No se pudo completar la generación.",
          };
        }
        return { messages: copy };
      });
      set({ abortController: null, loading: false, searching: false });
      get().loadChats();
    }
  },

  exportMessageAsPdf: async (index) => {
    const state = get();
    const message = state.messages[index];
    if (!message || message.role !== "ai") return;

    const payload: Record<string, unknown> = { chatId: state.chatId };
    if (message.id !== undefined) {
      payload.messageId = message.id;
    } else {
      payload.text = message.text || "";
    }
    if (message.document?.summary) payload.summary = message.document.summary;

    const res = await fetch("/api/documents/from-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.status === 401) {
      window.location.href = "/login";
      return;
    }

    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      document?: GeneratedDocumentMeta;
      editResult?: EditResult;
    };

    if (!res.ok || !data.document) {
      throw new Error(data.error || "No se pudo exportar el documento.");
    }

    set((s) => {
      const copy = [...s.messages];
      let targetIndex = index;
      if (message.localId || message.id !== undefined) {
        const found = copy.findIndex(
          (item) =>
            (message.localId !== undefined && item.localId === message.localId) ||
            (message.id !== undefined && item.id === message.id),
        );
        if (found >= 0) targetIndex = found;
      }

      const target = copy[targetIndex];
      if (!target || target.role !== "ai") return { messages: copy };
      copy[targetIndex] = {
        ...target,
        document: data.document,
        editResult: data.editResult,
        documentProgress: undefined,
      };
      return { messages: copy };
    });

    get().loadChats();
  },
}));

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import Sidebar from "./components/Sidebar";
import ChatMessage from "./components/ChatMessage";
import ChatInput from "./components/ChatInput";
import type { Msg, Chat } from "@/types";

type FileItem = {
  file: File;
  name: string;
  size: number;
};

export default function Home() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [dragging, setDragging] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(true);

  const [chatId, setChatId] = useState(uuidv4());
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
  }, []);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, autoScroll]);

  const colors = {
    bg: darkMode ? "bg-[#030812]" : "bg-white",
    sidebar: darkMode ? "bg-[#0d131d]" : "bg-gray-100",
    card: darkMode ? "bg-[#121824]" : "bg-white",
    text: darkMode ? "text-white" : "text-gray-900",
    muted: darkMode ? "text-gray-400" : "text-gray-500",
    border: darkMode ? "border-[#202938]" : "border-gray-300",
  };

  const cargarChats = async () => {
    try {
      const res = await fetch("/api/chat");
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      setChats(Array.isArray(data) ? data : []);
    } catch {
      setChats([]);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargarChats();
  }, []);

  const nuevoChat = () => {
    setMessages([]);
    setInput("");
    setImages([]);
    setFiles([]);
    setChatId(uuidv4());
  };

  const abrirChat = (chat: Chat) => {
    setChatId(chat.id);
    setMessages(chat.messages);
  };

  const eliminarChat = async (id: string) => {
    const res = await fetch(`/api/chat?id=${id}`, { method: "DELETE" });
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    setChats((prev) => prev.filter((c) => c.id !== id));
    if (id === chatId) nuevoChat();
  };

  const compartirChat = async (chat: Chat) => {
    await navigator.clipboard.writeText(JSON.stringify(chat, null, 2));
    alert("Copiado ✅");
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    for (const item of e.clipboardData.items) {
      if (item.type.includes("image")) {
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () =>
          setImages((prev) => [...prev, reader.result as string]);
        reader.readAsDataURL(file);
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    dropped.forEach((file) => {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () =>
          setImages((prev) => [...prev, reader.result as string]);
        reader.readAsDataURL(file);
      } else {
        setFiles((prev) => [...prev, { file, name: file.name, size: file.size }]);
      }
    });
  };

  const handleFilesSelected = (fileList: FileList) => {
    const newFiles = Array.from(fileList).map((file) => ({
      file,
      name: file.name,
      size: file.size,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const handleRegenerate = async () => {
    if (!chatId || messages.length < 2) return;

    setMessages((prev) => prev.slice(0, -1));
    setLoading(true);

    try {
      const res = await fetch("/api/chat/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId }),
      });

      if (res.status === 401) {
        router.push("/login");
        return;
      }

      if (!res.body) throw new Error("Sin cuerpo de respuesta");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      setMessages((prev) => [...prev, { role: "ai", text: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last?.role === "ai") {
            copy[copy.length - 1] = { role: "ai", text: accumulated };
          }
          return copy;
        });
      }

      cargarChats();
    } finally {
      setLoading(false);
    }
  };

  const enviarMensaje = async (
    textOverride?: string,
    editFromIndex?: number
  ) => {
    const messageText = textOverride ?? input;

    if (!messageText.trim() && images.length === 0 && files.length === 0) return;

    setLoading(true);

    const extraImages = [...images];
    let filesContent = "";
    let fileNames: { name: string }[] = [];

    if (files.length > 0) {
      const uploadForm = new FormData();
      files.forEach((f) => uploadForm.append("files", f.file));

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
      } catch {
        // fallback: envía solo el texto
      }
    }

    const visibleText = messageText || "Analiza este archivo";

    const formData = new FormData();
    formData.append("chatId", chatId);
    formData.append("message", visibleText);
    if (filesContent) formData.append("filesContent", filesContent);

    extraImages.forEach((img, i) => {
      formData.append(`image_${i}`, img);
    });

    if (editFromIndex !== undefined) {
      formData.append("editFromIndex", String(editFromIndex));
      setMessages((prev) => prev.slice(0, editFromIndex));
    }

    setInput("");
    setImages([]);
    setFiles([]);

    setMessages((prev) => [
      ...prev,
      { role: "user", text: visibleText, images: extraImages, files: fileNames },
    ]);

    setMessages((prev) => [...prev, { role: "ai", text: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        body: formData,
      });

      if (res.status === 401) {
        router.push("/login");
        return;
      }

      if (!res.body) throw new Error("Sin cuerpo de respuesta");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last?.role === "ai") {
            copy[copy.length - 1] = { role: "ai", text: accumulated };
          }
          return copy;
        });
      }

      cargarChats();
    } finally {
      setLoading(false);
    }
  };

  const handleEditMessage = (index: number, newText: string) => {
    enviarMensaje(newText, index);
  };

  return (
    <main
      className={`h-screen flex ${colors.bg} ${colors.text} overflow-hidden`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <Sidebar
        chats={chats}
        search={search}
        menuOpen={menuOpen}
        sidebarOpen={sidebarOpen}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((v) => !v)}
        onNewChat={nuevoChat}
        onOpenChat={abrirChat}
        onDeleteChat={eliminarChat}
        onShareChat={compartirChat}
        onSearch={setSearch}
        onMenuToggle={setMenuOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onFilesSelected={handleFilesSelected}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-3 px-4 pt-3">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className={`lg:hidden p-2 rounded-xl hover:bg-[#1e293b] transition text-lg ${colors.card}`}
            title="Menú"
          >
            ☰
          </button>
          <div className="text-center flex-1">
            <h1 className="text-2xl lg:text-4xl font-bold text-green-400">
              Inteligencia Digna
            </h1>
            <p className={`text-sm ${colors.muted}`}>by Salud Digna</p>
          </div>
          <div className="w-10 lg:hidden" />
        </div>

        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <div className={`p-6 rounded-2xl text-center mx-4 ${colors.card}`}>
              <h2>¡Hola! Soy Inteligencia Digna</h2>
              <p className={`mt-2 ${colors.muted}`}>
                ¿En qué puedo ayudarte hoy?
              </p>
            </div>
          </div>
        )}

        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">
          {messages.map((m, i) => (
            <ChatMessage
              key={m.id ?? i}
              message={m}
              index={i}
              isLastAi={m.role === "ai" && i === messages.length - 1 && messages.length >= 2}
              onEdit={m.role === "user" ? handleEditMessage : undefined}
              onRegenerate={
                m.role === "ai" && i === messages.length - 1 && messages.length >= 2
                  ? handleRegenerate
                  : undefined
              }
              darkMode={darkMode}
            />
          ))}

          {loading && (
            <div className="flex items-center gap-1.5 mb-4 ml-1">
              <video
                src="/typing.mp4"
                autoPlay
                loop
                muted
                playsInline
                className="h-8"
              />
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <ChatInput
          input={input}
          images={images}
          files={files.map((f) => ({ name: f.name, size: f.size }))}
          loading={loading}
          onInputChange={setInput}
          onSend={() => enviarMensaje()}
          onPaste={handlePaste}
          onRemoveImage={(i) =>
            setImages((prev) => prev.filter((_, idx) => idx !== i))
          }
          onRemoveFile={(i) =>
            setFiles((prev) => prev.filter((_, idx) => idx !== i))
          }
          onFilesSelected={handleFilesSelected}
        />
      </div>

      <style jsx>{`
        ::-webkit-scrollbar {
          width: 8px;
        }
        ::-webkit-scrollbar-track {
          background: ${darkMode ? "#030812" : "#f1f5f9"};
        }
        ::-webkit-scrollbar-thumb {
          background: ${darkMode ? "#1e293b" : "#cbd5e1"};
          border-radius: 10px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: ${darkMode ? "#334155" : "#94a3b8"};
        }
        @keyframes bounce {
          0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-4px); }
        }
        .animate-bounce {
          animation: bounce 1.2s infinite;
        }
      `}</style>
    </main>
  );
}

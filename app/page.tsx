"use client";

import { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";

type Msg = {
  role: "user" | "ai";
  text?: string;
  image?: string | null;
  fileName?: string | null;
};

type Chat = {
  id: string;
  title: string;
  messages: Msg[];
};

export default function Home() {
  const [input, setInput] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);

  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const [chatId, setChatId] = useState(uuidv4());
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = () => setMenuOpen(null);
    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, []);

  useEffect(() => {
    cargarChats();
  }, []);

  const cargarChats = async () => {
    const res = await fetch("/api/chat");
    const data = await res.json();
    setChats(data);
  };

  const nuevoChat = () => {
    setMessages([]);
    setInput("");
    setImage(null);
    setFile(null);
    setChatId(uuidv4());
  };

  const abrirChat = (chat: Chat) => {
    setChatId(chat.id);
    setMessages(chat.messages);
  };

  const eliminarChat = (id: string) => {
    setChats((prev) => prev.filter((c) => c.id !== id));
  };

  const renombrarChat = (id: string) => {
    const name = prompt("Nuevo nombre del chat:");
    if (!name) return;

    setChats((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: name } : c))
    );
  };

  const anclarChat = (id: string) => {
    setChats((prev) => {
      const chat = prev.find((c) => c.id === id);
      if (!chat) return prev;
      return [chat, ...prev.filter((c) => c.id !== id)];
    });
  };

  const archivarChat = (id: string) => {
    setChats((prev) => prev.filter((c) => c.id !== id));
  };

  const compartirChat = async (chat: Chat) => {
    await navigator.clipboard.writeText(JSON.stringify(chat, null, 2));
    alert("Chat copiado al portapapeles");
  };

  const crearImagen = () => {
    alert("Modo creación de imagen activado (aquí conectas tu IA)");
  };

  const analizarArchivo = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    if (f) setFile(f);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;

    for (const item of items) {
      if (item.type.includes("image")) {
        const file = item.getAsFile();
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => setImage(reader.result as string);
        reader.readAsDataURL(file);
      }
    }
  };

  const enviarMensaje = async () => {
    if (!input.trim() && !image && !file) return;

    setLoading(true);

    setMessages((prev) => [
      ...prev,
      { role: "user", text: input, image, fileName: file?.name || null },
    ]);

    const formData = new FormData();
    formData.append("chatId", chatId);
    formData.append("message", input);

    if (image) formData.append("image", image);
    if (file) formData.append("file", file);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        { role: "ai", text: data.reply || "..." },
      ]);

      setInput("");
      setImage(null);
      setFile(null);

      await cargarChats();
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "ai", text: "Error al conectar" },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="h-screen bg-[#030812] text-white flex">

      {/* SIDEBAR */}
      <div className="w-[300px] bg-[#0d131d] border-r border-[#202938] flex flex-col">

        <div className="flex flex-col items-center pt-6 pb-6">
          <img src="/logo.png" className="w-20 h-20" />

          <p className="text-green-500 text-sm mt-3 text-center">
            La salud es para todos
          </p>
        </div>

        <div className="px-4 space-y-3">
          <button onClick={nuevoChat} className="btn">
            ➕ Nuevo chat
          </button>

          <button onClick={crearImagen} className="btn">
            🎨 Crear imagen
          </button>

          <button onClick={analizarArchivo} className="btn">
            📄 Analizar archivo
          </button>

          <button onClick={() => alert("Sección de proyectos")} className="btn">
            📁 Proyectos
          </button>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar chats..."
            className="w-full p-3 rounded-xl bg-[#121824] outline-none"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-3 mt-3">
          <p className="text-xs text-gray-400 mb-2">Historial de chats</p>

          {chats
            .filter((c) =>
              c.title.toLowerCase().includes(search.toLowerCase())
            )
            .map((chat) => (
              <div
                key={chat.id}
                className="relative flex items-center justify-between p-3 rounded-xl hover:bg-[#121824] mb-2"
              >
                <button
                  onClick={() => abrirChat(chat)}
                  className="flex-1 text-left"
                >
                  {chat.title}
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(menuOpen === chat.id ? null : chat.id);
                  }}
                >
                  ⋮
                </button>

                {menuOpen === chat.id && (
                  <div
                    className="absolute right-2 top-10 bg-[#0d131d] border border-[#1f2632] rounded-xl w-44 z-50"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button onClick={() => compartirChat(chat)} className="menu">📋 Compartir</button>
                    <button onClick={() => renombrarChat(chat.id)} className="menu">✏️ Renombrar</button>
                    <button onClick={() => anclarChat(chat.id)} className="menu">📌 Anclar</button>
                    <button onClick={() => archivarChat(chat.id)} className="menu">📦 Archivar</button>
                    <button onClick={() => eliminarChat(chat.id)} className="menu text-red-500">🗑 Eliminar</button>
                  </div>
                )}
              </div>
            ))}
        </div>
      </div>

      {/* MAIN */}
      <div className="flex-1 flex flex-col">

        {/* HEADER */}
        <div className="text-center mt-10">
          <div className="flex justify-center items-center gap-3">

            {/* LOGO reemplaza el círculo */}
            <img src="/logo.png" className="w-10 h-10 rounded-full" />

            <h1 className="text-4xl font-bold text-green-400">
              Inteligencia Digna
            </h1>
          </div>
          <p className="text-gray-400">by Salud Digna</p>
        </div>

        {/* WELCOME */}
        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="bg-[#121824] p-6 rounded-2xl text-center max-w-[600px]">
              <h2 className="text-xl">
                ¡Hola! Soy Inteligencia Digna, tu asistente virtual.
              </h2>
              <p className="text-gray-400 mt-2">
                ¿En qué puedo ayudarte hoy?
              </p>
            </div>
          </div>
        )}

        {/* CHAT */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((m, i) => (
            <div key={i}>
              {m.text && (
                <div
                  className={`p-4 rounded-xl max-w-[700px] ${
                    m.role === "user"
                      ? "bg-green-600 ml-auto text-right"
                      : "bg-[#121824]"
                  }`}
                >
                  {m.text}
                </div>
              )}
            </div>
          ))}

          {loading && <div>...</div>}
        </div>

        {/* INPUT */}
        <div className="p-4 border-t border-[#1f2632]">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            className="w-full p-3 rounded-xl bg-[#121824] outline-none"
            placeholder="Escribe tu mensaje..."
          />

          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileChange}
          />

          <button
            onClick={enviarMensaje}
            className="mt-2 text-green-400 text-xl"
          >
            ➤
          </button>
        </div>

      </div>

      <style jsx>{`
        .btn {
          width: 100%;
          background: #121824;
          padding: 12px;
          border-radius: 12px;
          text-align: left;
        }
        .btn:hover {
          background: #1b2433;
        }
        .menu {
          width: 100%;
          padding: 8px 12px;
          text-align: left;
        }
        .menu:hover {
          background: #121824;
        }
      `}</style>

    </main>
  );
}
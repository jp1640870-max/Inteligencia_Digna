"use client";

import { useEffect, useState, use, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, MessageSquare, User, Clock, Heart, ChevronDown, ChevronUp } from "lucide-react";

type Message = {
  id: number;
  chat_id: string;
  role: string;
  content: string;
  images: string | null;
  files: string | null;
  created_at: string;
};

type ChatDetail = {
  id: string;
  title: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  heart_id: string | null;
  created_at: string;
  updated_at: string;
  messages: Message[];
};

export default function ChatDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [chat, setChat] = useState<ChatDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedMsgs, setExpandedMsgs] = useState<Set<number>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/admin/chats/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setChat(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat?.messages.length]);

  const toggleExpand = (msgId: number) => {
    setExpandedMsgs((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-green-400 text-sm animate-pulse">Cargando...</div></div>;
  }

  if (!chat) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400">Chat no encontrado</p>
        <Link href="/admin/chats" className="text-green-400 text-sm hover:underline mt-2 inline-block">← Volver a conversaciones</Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link href="/admin/chats" className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-green-400 transition-colors">
        <ArrowLeft size={14} /> Volver a conversaciones
      </Link>

      {/* Header */}
      <div className="rounded-xl bg-[#121824] border border-[#202938] p-5">
        <h1 className="text-lg font-semibold text-white">{chat.title}</h1>
        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <User size={14} />
            <Link href={`/admin/usuarios/${chat.user_id}`} className="hover:text-green-400 transition-colors">
              {chat.user_name || chat.user_email}
            </Link>
          </span>
          <span className="flex items-center gap-1.5">
            <MessageSquare size={14} />
            {chat.messages.length} mensajes
          </span>
          {chat.heart_id && (
            <span className="flex items-center gap-1.5 text-purple-400">
              <Heart size={14} /> Heart activo
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Clock size={14} />
            {new Date(chat.updated_at).toLocaleString("es-MX")}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="space-y-3">
        {chat.messages.map((msg) => {
          const isUser = msg.role === "user";
          const isLong = msg.content.length > 500;
          const isExpanded = expandedMsgs.has(msg.id);

          return (
            <div
              key={msg.id}
              className={`rounded-xl border p-4 ${
                isUser
                  ? "bg-green-600/10 border-green-500/20 ml-8"
                  : "bg-[#121824] border-[#202938] mr-8"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                  isUser ? "bg-green-600/20 text-green-400" : "bg-purple-600/20 text-purple-400"
                }`}>
                  {isUser ? "Usuario" : "Asistente"}
                </span>
                <span className="text-[10px] text-gray-600">{new Date(msg.created_at).toLocaleString("es-MX")}</span>
              </div>

              <div className={`text-sm text-gray-300 whitespace-pre-wrap break-words ${
                isLong && !isExpanded ? "line-clamp-6" : ""
              }`}>
                {msg.content || "(mensaje vacío)"}
              </div>

              {msg.images && (
                <div className="mt-2 flex gap-2">
                  {JSON.parse(msg.images).map((img: string, i: number) => (
                    <img key={i} src={img} alt="" className="w-20 h-20 object-cover rounded-lg" />
                  ))}
                </div>
              )}

              {isLong && (
                <button
                  onClick={() => toggleExpand(msg.id)}
                  className="mt-2 flex items-center gap-1 text-xs text-gray-500 hover:text-green-400 transition-colors"
                >
                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {isExpanded ? "Mostrar menos" : "Mostrar más"}
                </button>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <p className="text-[11px] text-gray-600 text-center">
        {chat.messages.length} mensajes · {new Date(chat.created_at).toLocaleDateString("es-MX")} al {new Date(chat.updated_at).toLocaleDateString("es-MX")}
      </p>
    </div>
  );
}

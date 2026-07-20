"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Search, MessageSquare, User, Eye } from "lucide-react";
import Link from "next/link";

type ChatEntry = {
  id: string;
  title: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  heart_id: string | null;
  message_count: number;
  last_message: string | null;
  created_at: string;
  updated_at: string;
};

export default function AdminChats() {
  const [chats, setChats] = useState<ChatEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const loadChats = useCallback(async () => {
    setLoading(true);
    try {
      const params = search ? `?search=${encodeURIComponent(search)}` : "";
      const res = await fetch(`/api/admin/chats${params}`);
      if (res.ok) {
        const data = await res.json();
        setChats(data.chats);
      }
    } catch {}
    setLoading(false);
  }, [search]);

  useEffect(() => { loadChats(); }, [loadChats]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Conversaciones</h1>
        <button onClick={loadChats} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#121824] border border-[#202938] text-xs text-gray-400 hover:text-white transition-colors">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Recargar
        </button>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por título, usuario o email..." className="w-full bg-[#121824] border border-[#202938] rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50" />
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-12 text-gray-500">Cargando...</div>
        ) : chats.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <MessageSquare size={32} className="mx-auto mb-3 opacity-50" />
            {search ? "Sin resultados" : "No hay conversaciones"}
          </div>
        ) : (
          chats.map((chat) => (
            <div key={chat.id} className="rounded-xl bg-[#121824] border border-[#202938] p-4 hover:border-green-500/20 transition-colors group">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <MessageSquare size={14} className="text-green-400 shrink-0" />
                    <Link href={`/admin/chats/${chat.id}`} className="text-sm font-medium text-white truncate hover:text-green-400 transition-colors">
                      {chat.title}
                    </Link>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                    <span className="flex items-center gap-1">
                      <User size={12} />
                      {chat.user_name || chat.user_email || "—"}
                    </span>
                    <span>{chat.message_count} msgs</span>
                    {chat.heart_id && <span className="text-purple-400">♥ Heart</span>}
                    <span>{new Date(chat.updated_at).toLocaleDateString("es-MX")}</span>
                  </div>
                  {chat.last_message && (
                    <p className="text-xs text-gray-600 mt-1 truncate">{chat.last_message}</p>
                  )}
                </div>
                <Link
                  href={`/admin/usuarios/${chat.user_id}`}
                  className="p-2 rounded-lg text-gray-500 hover:text-green-400 hover:bg-green-500/10 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                  title="Ver usuario"
                >
                  <Eye size={16} />
                </Link>
              </div>
            </div>
          ))
        )}
      </div>

      <p className="text-[11px] text-gray-600">{chats.length} conversaciones{search && " filtradas"}</p>
    </div>
  );
}

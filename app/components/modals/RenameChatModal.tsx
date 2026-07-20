"use client";

import { useChatStore } from "@/lib/stores/chat-store";
import { useUIStore } from "@/lib/stores/ui-store";

export default function RenameChatModal() {
  const renameChatId = useUIStore((s) => s.renameChatId);
  const renameValue = useUIStore((s) => s.renameValue);
  const setRenameValue = useUIStore((s) => s.setRenameValue);
  const closeRenameModal = useUIStore((s) => s.closeRenameModal);
  const renameChat = useChatStore((s) => s.renameChat);

  if (!renameChatId) return null;

  const handleSave = async () => {
    const title = renameValue.trim();
    if (!title) return;
    const ok = await renameChat(renameChatId, title);
    if (ok) closeRenameModal();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[#121824] border border-[#202938] rounded-2xl p-6 w-[360px] shadow-xl">
        <h2 className="text-lg font-bold text-white mb-4">
          Renombrar conversación
        </h2>

        <input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          autoFocus
          className="w-full bg-[#030812] border border-[#202938] rounded-xl px-4 py-3 text-white outline-none mb-4"
          placeholder="Nuevo nombre"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") closeRenameModal();
          }}
        />

        <div className="flex justify-end gap-2">
          <button
            onClick={closeRenameModal}
            className="px-4 py-2 rounded-xl bg-gray-700 hover:bg-gray-600 text-white"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-xl bg-green-500 hover:bg-green-600 text-white"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

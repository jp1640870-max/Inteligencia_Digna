"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Paperclip } from "lucide-react";
import CodeBlock from "./CodeBlock";
import type { Msg } from "@/types";

type Props = {
  message: Msg;
  index: number;
  isLastAi?: boolean;
  onEdit?: (index: number, newText: string) => void;
  onRegenerate?: () => void;
  darkMode: boolean;
};

const ChatMessage = ({ message, index, isLastAi, onEdit, onRegenerate, darkMode }: Props) => {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.text || "");
  const [copied, setCopied] = useState(false);

  const colors = {
    aiBg: darkMode ? "bg-[#121824]" : "bg-gray-100",
    userBg: "bg-green-600",
    text: darkMode ? "text-white" : "text-gray-900",
    muted: darkMode ? "text-gray-400" : "text-gray-500",
    fileTagBg: darkMode ? "bg-black/30" : "bg-gray-200",
    fileTagText: darkMode ? "text-gray-300" : "text-gray-700",
    buttonBg: darkMode ? "bg-[#1e293b]" : "bg-gray-200",
    buttonHover: darkMode ? "hover:bg-[#2a3a4f]" : "hover:bg-gray-300",
    buttonText: darkMode ? "text-gray-400" : "text-gray-600",
    buttonHoverText: darkMode ? "hover:text-white" : "hover:text-gray-900",
    textareaBg: darkMode ? "bg-[#1e293b]" : "bg-gray-200",
    textareaText: darkMode ? "text-white" : "text-gray-900",
    cancelBtn: darkMode ? "bg-[#1e293b] hover:bg-[#2a3a4f]" : "bg-gray-200 hover:bg-gray-300",
    saveBtn: "bg-green-600 hover:bg-green-500",
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.text || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSaveEdit = () => {
    onEdit?.(index, editValue);
    setEditing(false);
  };

  const handleCancelEdit = () => {
    setEditValue(message.text || "");
    setEditing(false);
  };

  return (
    <div className={`group mb-4 ${message.role === "user" ? "text-right" : ""}`}>
      <div className={`relative inline-block max-w-[85%] ${message.role === "user" ? "" : "text-left"}`}>
        {editing ? (
          <div className={`p-3 rounded-xl ${colors.aiBg}`}>
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className={`w-full p-2 rounded-lg resize-none min-h-[80px] outline-none ${colors.textareaBg} ${colors.textareaText}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSaveEdit();
                }
                if (e.key === "Escape") handleCancelEdit();
              }}
              autoFocus
            />
            <div className="flex gap-2 mt-2 justify-end">
              <button
                onClick={handleCancelEdit}
                className={`px-3 py-1 rounded-lg text-sm transition ${colors.cancelBtn}`}
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveEdit}
                className={`px-3 py-1 rounded-lg text-sm transition ${colors.saveBtn}`}
              >
                Guardar
              </button>
            </div>
          </div>
        ) : (
          <>
            <div
              className={`p-3 rounded-xl ${
                message.role === "user" ? colors.userBg : colors.aiBg
              }`}
            >
              <ReactMarkdown components={{ code: CodeBlock }}>
                {message.text || ""}
              </ReactMarkdown>
              {message.files && message.files.length > 0 && (
                <div className={`flex flex-wrap gap-1.5 mt-2 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  {message.files.map((f, idx) => (
                    <span
                      key={idx}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md ${colors.fileTagBg} ${colors.fileTagText}`}
                    >
                      <Paperclip size={12} className="shrink-0" />
                      {f.name}
                    </span>
                  ))}
                </div>
              )}
              {message.images?.map((img, idx) => (
                <img key={idx} src={img} className="mt-2 max-h-40 rounded-lg" />
              ))}
            </div>

            <div
              className={`flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity ${
                message.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {message.role === "user" && onEdit && (
                <button
                  onClick={() => {
                    setEditValue(message.text || "");
                    setEditing(true);
                  }}
                  className={`text-xs px-2 py-1 rounded transition ${colors.buttonBg} ${colors.buttonHover} ${colors.buttonText} ${colors.buttonHoverText}`}
                  title="Editar mensaje"
                >
                  ✏️
                </button>
              )}
              {message.role === "ai" && isLastAi && onRegenerate && (
                <button
                  onClick={onRegenerate}
                  className={`text-xs px-2 py-1 rounded transition ${colors.buttonBg} ${colors.buttonHover} ${colors.buttonText} ${colors.buttonHoverText}`}
                  title="Regenerar respuesta"
                >
                  🔄
                </button>
              )}
              <button
                onClick={handleCopy}
                className={`text-xs px-2 py-1 rounded transition ${colors.buttonBg} ${colors.buttonHover} ${colors.buttonText} ${colors.buttonHoverText}`}
                title="Copiar mensaje"
              >
                {copied ? "✅" : "📋"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ChatMessage;

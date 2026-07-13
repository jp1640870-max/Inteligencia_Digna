"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Download, ExternalLink, FileSpreadsheet, FileText, FileType2, Paperclip, Pencil, RefreshCw, Copy, Check } from "lucide-react";
import CodeBlock from "./CodeBlock";
import type { Msg, EditResult, SearchResult } from "@/types";

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
  const [downloading, setDownloading] = useState(false);

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
    editResultBg: darkMode ? "bg-[#0f1a1a]" : "bg-green-50",
    editResultBorder: darkMode ? "border-green-800/40" : "border-green-300",
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

  const handleDownloadEditResult = async (editResult: EditResult) => {
    if (downloading) return;
    setDownloading(true);
    try {
      let url: string;
      if (editResult.downloadUrl) {
        url = editResult.downloadUrl;
      } else if (editResult.dataUri) {
        const resp = await fetch(editResult.dataUri);
        const blob = await resp.blob();
        url = URL.createObjectURL(blob);
      } else {
        throw new Error("No hay URL de descarga");
      }
      const link = document.createElement("a");
      link.href = url;
      link.download = editResult.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert("No se pudo descargar el archivo");
    } finally {
      setDownloading(false);
    }
  };

  const renderEditResult = (editResult: EditResult) => {
    const formatIcon = editResult.format === "xlsx"
      ? <FileSpreadsheet size={16} />
      : editResult.format === "docx"
        ? <FileText size={16} />
        : <FileType2 size={16} />;

    const formatLabel = editResult.format === "xlsx" ? "Excel"
      : editResult.format === "docx" ? "Word"
        : "PDF";

    return (
      <div className={`mt-3 rounded-lg border ${colors.editResultBorder} ${colors.editResultBg} p-3`}>
        <div className="flex items-center gap-2 mb-2">
          {formatIcon}
          <span className="text-sm font-medium">
            {editResult.success ? "✅ Documento modificado" : "❌ Error al modificar"}
          </span>
        </div>
        <p className="text-xs text-gray-500 mb-2">
          {editResult.changesCount > 0
            ? `${editResult.changesCount} cambio(s) aplicado(s) a ${editResult.originalName}`
            : editResult.error || "No se realizaron cambios"}
        </p>
        {(editResult.success && (editResult.downloadUrl || editResult.dataUri)) && (
          <button
            onClick={() => handleDownloadEditResult(editResult)}
            disabled={downloading}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition ${colors.buttonBg} ${colors.buttonHover}`}
          >
            <Download size={14} className={downloading ? "animate-bounce" : ""} />
            Descargar {formatLabel}
          </button>
        )}
      </div>
    );
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
              {message.editResult ? (
                renderEditResult(message.editResult)
              ) : (
                <>
                  <ReactMarkdown
                    components={{
                      code: CodeBlock,
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-green-400 hover:text-green-300 underline decoration-green-400/30 hover:decoration-green-400 transition-all"
                        >
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {message.text || ""}
                  </ReactMarkdown>
                  {message.sources && message.sources.length > 0 && (
                    <div className={`mt-4 pt-3 border-t ${darkMode ? "border-[#202938]" : "border-gray-300"}`}>
                      <p className={`text-xs font-semibold mb-2 ${colors.muted}`}>
                        Fuentes consultadas:
                      </p>
                      <div className="space-y-1.5">
                        {message.sources.map((src, i) => (
                          <a
                            key={i}
                            href={src.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`group flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-all ${colors.fileTagBg} ${colors.fileTagText} hover:bg-green-600/20 hover:text-green-400 hover:border-green-500/30 border border-transparent`}
                          >
                            <ExternalLink size={12} className="shrink-0 text-green-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <span className="font-medium text-green-500 shrink-0">[{i + 1}]</span>
                            <span className="truncate">{src.title}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
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
                </>
              )}
            </div>

            {!message.editResult && (
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
                    <Pencil size={14} />
                  </button>
                )}
                {message.role === "ai" && isLastAi && onRegenerate && (
                  <button
                    onClick={onRegenerate}
                    className={`text-xs px-2 py-1 rounded transition ${colors.buttonBg} ${colors.buttonHover} ${colors.buttonText} ${colors.buttonHoverText}`}
                    title="Regenerar respuesta"
                  >
                    <RefreshCw size={14} />
                  </button>
                )}
                <button
                  onClick={handleCopy}
                  className={`text-xs px-2 py-1 rounded transition ${colors.buttonBg} ${colors.buttonHover} ${colors.buttonText} ${colors.buttonHoverText}`}
                  title="Copiar mensaje"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ChatMessage;

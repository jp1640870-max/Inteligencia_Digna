"use client";

import { useRef, useEffect } from "react";
import { ArrowUp, FileEdit, Paperclip, Search, Wand2 } from "lucide-react";

type FilePreview = {
  name: string;
  size: number;
};

type Props = {
  input: string;
  images: string[];
  files: FilePreview[];
  loading: boolean;
  onInputChange: (val: string) => void;
  onSend: () => void;
  onStop?: () => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onRemoveImage: (index: number) => void;
  onRemoveFile: (index: number) => void;
  onFilesSelected: (files: FileList) => void;
  onEditFile?: () => void;
  isEditMode?: boolean;
  editInstruction?: string;
  onEditInstructionChange?: (val: string) => void;
  onEditFileSelected?: (file: File) => void;
  typeChoiceFile?: File | null;
  onTypeChoiceAction?: (file: File, action: "analyze" | "edit") => void;
  onDismissTypeChoice?: () => void;
  onShowTypeChoice?: (file: File) => void;
};

const EDITABLE_EXTS = [".xlsx", ".xls", ".docx", ".pdf"];

const ChatInput = ({
  input,
  images,
  files,
  loading,
  onInputChange,
  onSend,
  onStop,
  onPaste,
  onRemoveImage,
  onRemoveFile,
  onFilesSelected,
  onEditFile,
  isEditMode,
  editInstruction,
  onEditInstructionChange,
  onEditFileSelected,
  typeChoiceFile,
  onTypeChoiceAction,
  onDismissTypeChoice,
  onShowTypeChoice,
}: Props) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleFileSelect = (fileList: FileList) => {
    const file = fileList[0];
    if (!file) return;
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (EDITABLE_EXTS.includes(ext) && onShowTypeChoice) {
      onShowTypeChoice(file);
    } else {
      onFilesSelected(fileList);
    }
  };

  return (
    <div className="p-4 border-t border-[#1f2632] max-w-2xl mx-auto w-full">
      {images.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {images.map((img, i) => (
            <div key={i} className="relative">
              <img src={img} className="h-16 rounded" />
              <button
                onClick={() => onRemoveImage(i)}
                className="absolute top-0 right-0 bg-red-500 text-xs px-1 rounded"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {files.map((f, i) => (
            <div
              key={i}
              className="bg-[#1e293b] px-3 py-1.5 rounded-xl text-sm flex items-center gap-2"
            >
              <span>📄 {f.name}</span>
              <button
                onClick={() => onRemoveFile(i)}
                className="text-red-400 hover:text-red-300"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.csv,.png,.jpg,.jpeg,.gif"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) {
            if (e.target.files.length === 1) {
              handleFileSelect(e.target.files);
            } else {
              onFilesSelected(e.target.files);
            }
          }
          e.target.value = "";
        }}
      />
      <input
        ref={editFileInputRef}
        type="file"
        accept=".xlsx,.xls,.docx,.pdf"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) onEditFileSelected?.(e.target.files[0]);
          e.target.value = "";
        }}
      />

      {/* Toolbar */}
      <div className="flex items-center gap-1 mb-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-1.5 rounded-lg hover:bg-[#1e293b] transition text-gray-400 hover:text-gray-200"
          title="Adjuntar archivo"
        >
          <Paperclip size={18} />
        </button>
        {!isEditMode && (
          <button
            type="button"
            onClick={() => editFileInputRef.current?.click()}
            className="p-1.5 rounded-lg hover:bg-[#1e293b] transition text-gray-400 hover:text-gray-200"
            title="Editar archivo"
          >
            <FileEdit size={18} />
          </button>
        )}
      </div>

      {/* File type choice popover */}
      {typeChoiceFile && (
        <div className="mb-2 bg-[#1a2332] rounded-xl border border-green-600/30 p-3">
          <p className="text-sm text-gray-300 mb-2">
            📄 <span className="font-medium">{typeChoiceFile.name}</span>
          </p>
          <p className="text-xs text-gray-500 mb-3">¿Qué quieres hacer con este archivo?</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onTypeChoiceAction?.(typeChoiceFile, "analyze")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1e293b] hover:bg-[#2a3a4f] text-sm text-gray-200 transition"
            >
              <Search size={14} />
              Analizar
            </button>
            <button
              type="button"
              onClick={() => onTypeChoiceAction?.(typeChoiceFile, "edit")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-700 hover:bg-green-600 text-sm text-white transition"
            >
              <Wand2 size={14} />
              Editar
            </button>
            <button
              type="button"
              onClick={onDismissTypeChoice}
              className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-gray-300 transition ml-auto"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {isEditMode ? (
        <div className="bg-[#1a2332] rounded-xl border border-green-600/30">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#1f2632]">
            <FileEdit size={14} className="text-green-400" />
            <span className="text-xs text-green-400 font-medium">Modo edición de documento</span>
            <button
              type="button"
              onClick={onEditFile}
              className="ml-auto text-xs text-gray-500 hover:text-gray-300"
            >
              Cancelar
            </button>
          </div>
          <div className="flex gap-2 p-2">
            <textarea
              value={editInstruction || ""}
              onChange={(e) => onEditInstructionChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              placeholder="Describe los cambios que quieres hacer al archivo..."
              className="flex-1 bg-transparent text-white placeholder-gray-500 resize-none outline-none text-sm leading-relaxed max-h-[120px] min-h-[60px]"
            />
            <button
              type="button"
              onClick={onSend}
              disabled={loading || !editInstruction?.trim()}
              className="self-end p-1.5 rounded-lg bg-green-600 hover:bg-green-500 disabled:bg-gray-600 transition shrink-0"
              title="Aplicar cambios"
            >
              <ArrowUp size={18} />
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
          className="flex items-end gap-2 bg-[#121824] rounded-xl px-3 py-2 border border-[#1f2632] focus-within:border-gray-600 transition-colors"
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onPaste={onPaste}
            placeholder="Escribe un mensaje..."
            className="flex-1 bg-transparent text-white placeholder-gray-500 resize-none outline-none text-sm leading-relaxed max-h-[200px]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
          />

          {loading ? (
            <button
              type="button"
              onClick={onStop}
              className="p-1.5 rounded-lg bg-red-600 hover:bg-red-500 transition shrink-0"
              title="Detener"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="p-1.5 rounded-lg bg-green-600 hover:bg-green-500 disabled:bg-gray-600 transition shrink-0"
            >
              <ArrowUp size={18} />
            </button>
          )}
        </form>
      )}
    </div>
  );
};

export default ChatInput;

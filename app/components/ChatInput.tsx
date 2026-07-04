"use client";

import { useRef, useEffect } from "react";

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
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onRemoveImage: (index: number) => void;
  onRemoveFile: (index: number) => void;
  onFilesSelected: (files: FileList) => void;
};

const ChatInput = ({
  input,
  images,
  files,
  loading,
  onInputChange,
  onSend,
  onPaste,
  onRemoveImage,
  onRemoveFile,
  onFilesSelected,
}: Props) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, [input]);

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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
        className="flex items-end gap-2 bg-[#121824] rounded-xl px-3 py-2 border border-[#1f2632] focus-within:border-gray-600 transition-colors"
      >
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-1.5 rounded-lg hover:bg-[#1e293b] transition text-gray-400 hover:text-gray-200 shrink-0"
          title="Adjuntar archivo"
        >
          <span className="text-lg">📎</span>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.csv,.png,.jpg,.jpeg,.gif"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) onFilesSelected(e.target.files);
            e.target.value = "";
          }}
        />

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

        <button
          type="submit"
          disabled={loading}
          className="p-1.5 rounded-lg bg-green-600 hover:bg-green-500 disabled:bg-gray-600 transition shrink-0"
        >
          <span className="text-lg">➤</span>
        </button>
      </form>
    </div>
  );
};

export default ChatInput;

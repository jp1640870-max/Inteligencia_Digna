"use client";

import { useRef, useEffect } from "react";
import Image from "next/image";
import { ArrowUp, FileEdit, Paperclip, Search, Wand2, X } from "lucide-react";

type FilePreview = {
  name: string;
  size: number;
};

type Props = {
  input: string;
  images: string[];
  files: FilePreview[];
  loading: boolean;
  darkMode: boolean;
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
  darkMode,
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
      el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
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

  const canSend = input.trim().length > 0 || images.length > 0 || files.length > 0;

  return (
    <div
      className={`chat-composer-wrap ${darkMode ? "chat-theme-dark" : "chat-theme-light"}`}
    >
      <div className="chat-composer-inner">
        {images.length > 0 && (
          <div className="chat-attachment-row">
            {images.map((img, index) => (
              <div key={index} className="chat-attach-image-wrap">
                <Image
                  src={img}
                  alt="Vista previa de imagen adjunta"
                  width={64}
                  height={64}
                  className="chat-attach-image"
                />
                <button
                  type="button"
                  onClick={() => onRemoveImage(index)}
                  className="chat-attach-remove"
                  title="Quitar imagen"
                  aria-label="Quitar imagen"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {files.length > 0 && (
          <div className="chat-attachment-row">
            {files.map((file, index) => (
              <div key={index} className="chat-attach-chip">
                <Paperclip size={13} aria-hidden="true" />
                <span>{file.name}</span>
                <button
                  type="button"
                  onClick={() => onRemoveFile(index)}
                  className="chat-attach-chip-remove"
                  title="Quitar archivo"
                  aria-label="Quitar archivo"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.csv,.png,.jpg,.jpeg,.gif"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files) {
              if (event.target.files.length === 1) {
                handleFileSelect(event.target.files);
              } else {
                onFilesSelected(event.target.files);
              }
            }
            event.target.value = "";
          }}
        />
        <input
          ref={editFileInputRef}
          type="file"
          accept=".xlsx,.xls,.docx,.pdf"
          className="hidden"
          onChange={(event) => {
            if (event.target.files?.[0]) onEditFileSelected?.(event.target.files[0]);
            event.target.value = "";
          }}
        />

        {typeChoiceFile && (
          <div className="chat-type-choice">
            <p className="chat-type-choice-title">
              <Paperclip size={14} aria-hidden="true" />
              <span>{typeChoiceFile.name}</span>
            </p>
            <p className="chat-type-choice-note">¿Qué quieres hacer con este archivo?</p>
            <div className="chat-type-actions">
              <button
                type="button"
                onClick={() => onTypeChoiceAction?.(typeChoiceFile, "analyze")}
                className="chat-type-btn"
              >
                <Search size={14} />
                Analizar
              </button>
              <button
                type="button"
                onClick={() => onTypeChoiceAction?.(typeChoiceFile, "edit")}
                className="chat-type-btn chat-type-btn-primary"
              >
                <Wand2 size={14} />
                Editar
              </button>
              <button
                type="button"
                onClick={onDismissTypeChoice}
                className="chat-type-btn chat-type-btn-ghost"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {isEditMode ? (
          <div className="chat-composer chat-composer-edit">
            <div className="chat-edit-header">
              <FileEdit size={14} aria-hidden="true" />
              <span>Modo edición de documento</span>
              <button type="button" onClick={onEditFile} className="chat-edit-cancel-link">
                Cancelar
              </button>
            </div>
            <div className="chat-edit-compose-row">
              <textarea
                value={editInstruction || ""}
                onChange={(event) => onEditInstructionChange?.(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    onSend();
                  }
                }}
                placeholder="Describe los cambios que quieres hacer al archivo..."
                className="chat-edit-input"
                aria-label="Instrucciones para editar el documento"
              />
              <button
                type="button"
                onClick={onSend}
                disabled={loading || !editInstruction?.trim()}
                className="chat-send-btn"
                title="Aplicar cambios"
                aria-label="Aplicar cambios"
              >
                {loading ? <span className="chat-send-spinner" /> : <ArrowUp size={18} />}
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSend();
            }}
            className="chat-composer"
          >
            <div className="chat-composer-tools">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="chat-action-btn"
                title="Adjuntar archivo"
                aria-label="Adjuntar archivo"
              >
                <Paperclip size={18} />
              </button>
              {!isEditMode && (
                <button
                  type="button"
                  onClick={() => editFileInputRef.current?.click()}
                  className="chat-action-btn"
                  title="Editar archivo"
                  aria-label="Editar archivo"
                >
                  <FileEdit size={18} />
                </button>
              )}
            </div>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              onPaste={onPaste}
              placeholder="Escribe un mensaje..."
              className="chat-composer-textarea"
              aria-label="Mensaje"
              rows={1}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onSend();
                }
              }}
            />

            {loading ? (
              <button
                type="button"
                onClick={onStop}
                className="chat-send-btn chat-stop-btn"
                title="Detener"
                aria-label="Detener respuesta"
              >
                <span className="chat-stop-icon" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                className="chat-send-btn"
                title="Enviar mensaje"
                aria-label="Enviar mensaje"
              >
                <ArrowUp size={18} />
              </button>
            )}
          </form>
        )}

        <div className="chat-composer-hint">
          <span>Inteligencia Digna puede cometer errores. Verifica la información importante.</span>
          <span>Enter para enviar · Shift + Enter para salto de línea</span>
        </div>
      </div>
    </div>
  );
};

export default ChatInput;

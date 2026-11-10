"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileDown,
  FileSpreadsheet,
  FileText,
  FileType2,
  Loader2,
  Paperclip,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";
import CodeBlock from "./CodeBlock";
import type {
  DocumentProgress,
  EditResult,
  GeneratedDocumentMeta,
  Msg,
} from "@/types";

type Props = {
  message: Msg;
  index: number;
  isLastAi?: boolean;
  onEdit?: (index: number, newText: string) => void;
  onRegenerate?: () => void;
  onExportPdf?: () => Promise<void> | void;
  darkMode: boolean;
};

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const progressLabel = (stage: DocumentProgress["stage"]): string => {
  switch (stage) {
    case "analyzing":
      return "Analizando la solicitud…";
    case "writing":
      return "Redactando el documento…";
    case "parsing":
      return "Revisando el contenido…";
    case "rendering":
      return "Preparando el PDF…";
    case "storing":
      return "Guardando el archivo…";
    default:
      return "Generando documento…";
  }
};

const progressPercent = (progress: DocumentProgress): number => {
  switch (progress.stage) {
    case "analyzing":
      return 8;
    case "writing":
      return Math.min(80, 20 + Math.round(((progress.chars || 0) / 12000) * 60));
    case "parsing":
      return 85;
    case "rendering":
      return 92;
    case "storing":
      return 97;
    default:
      return 10;
  }
};

const ChatMessage = ({ message, index, isLastAi, onEdit, onRegenerate, onExportPdf, darkMode }: Props) => {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.text || "");
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (!previewOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewOpen]);

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
    setActionError(null);
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
    } catch {
      setActionError("No se pudo descargar el archivo. Intenta de nuevo.");
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

  const handleExportPdf = async () => {
    if (!onExportPdf || exporting) return;
    setActionError(null);
    setExporting(true);
    try {
      await onExportPdf();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "No se pudo exportar el documento. Intenta de nuevo.",
      );
    } finally {
      setExporting(false);
    }
  };

  const renderDocumentProgress = (progress: DocumentProgress) => (
    <div
      className={`mt-1 rounded-xl border p-3 ${colors.editResultBorder} ${colors.editResultBg}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <Loader2 size={16} className="shrink-0 animate-spin text-green-500" />
        <span className="text-sm font-medium">{progressLabel(progress.stage)}</span>
        <span className={`ml-auto text-xs ${colors.muted}`}>
          {progressPercent(progress)}%
        </span>
      </div>
      <p className={`mt-1 text-xs ${colors.muted}`}>
        Documento de hasta 10 páginas. Esto puede tardar unos segundos.
      </p>
      {progress.summary && (
        <p className={`mt-2 line-clamp-3 text-xs ${colors.text}`}>{progress.summary}</p>
      )}
      <div className={`mt-3 h-1.5 w-full overflow-hidden rounded-full ${darkMode ? "bg-[#1e293b]" : "bg-green-200"}`}>
        <div
          className="h-full rounded-full bg-green-500 transition-all duration-500"
          style={{ width: `${progressPercent(progress)}%` }}
        />
      </div>
    </div>
  );

  const renderDocumentCard = (doc: GeneratedDocumentMeta) => {
    const formatIcon = doc.format === "xlsx"
      ? <FileSpreadsheet size={18} />
      : doc.format === "docx"
        ? <FileText size={18} />
        : <FileType2 size={18} />;
    const formatLabel = doc.format === "xlsx" ? "Excel" : doc.format === "docx" ? "Word" : "PDF";
    const generatedLabel = doc.format === "pdf"
      ? "PDF generado"
      : doc.format === "docx"
        ? "Documento Word generado"
        : "Hoja de cálculo generada";
    const details = [
      formatLabel,
      doc.page_count ? `${doc.page_count} página${doc.page_count === 1 ? "" : "s"}` : null,
      doc.size_bytes ? formatBytes(doc.size_bytes) : null,
    ].filter(Boolean).join(" · ");

    return (
      <div
        className={`mt-3 rounded-xl border p-3 ${colors.editResultBorder} ${colors.editResultBg}`}
      >
        <div className="flex items-start gap-3">
          <div className={`rounded-lg p-2 ${darkMode ? "bg-green-500/10 text-green-400" : "bg-green-100 text-green-700"}`}>
            {formatIcon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{generatedLabel}</p>
            <p className={`truncate text-sm ${colors.text}`}>{doc.title || doc.filename}</p>
            <p className={`mt-0.5 truncate text-xs ${colors.muted}`}>
              {doc.filename} · {details}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {doc.format === "pdf" && (
            <button
              onClick={() => setPreviewOpen(true)}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition ${colors.buttonBg} ${colors.buttonHover} ${colors.buttonText} ${colors.buttonHoverText}`}
            >
              <Eye size={14} />
              Ver
            </button>
          )}
          <a
            href={doc.downloadUrl}
            download={doc.filename}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition ${colors.buttonBg} ${colors.buttonHover} ${colors.buttonText} ${colors.buttonHoverText}`}
          >
            <Download size={14} />
            Descargar
          </a>
          {doc.docxUrl && (
            <a
              href={doc.docxUrl}
              download
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition ${colors.buttonBg} ${colors.buttonHover} ${colors.buttonText} ${colors.buttonHoverText}`}
            >
              <FileText size={14} />
              Word
            </a>
          )}
        </div>
        {(doc.truncated || doc.page_limit_exceeded || doc.partial) && (
          <p
            className={`mt-3 rounded-md px-2 py-1.5 text-xs ${
              darkMode
                ? "bg-amber-500/10 text-amber-300"
                : "bg-amber-50 text-amber-800"
            }`}
          >
            {doc.timed_out
              ? `La generación se detuvo por tiempo. El documento contiene lo que se alcanzó a generar. Puedes pedir "continúa el documento" para terminar lo que falta.`
              : doc.partial
                ? `El documento está incompleto. Puedes pedir "continúa el documento" para agregar más contenido.`
                : doc.page_limit_exceeded
                  ? `El contenido superó el límite de ${doc.max_pages ?? 10} páginas. Se guardó una versión recortada; revisa el documento.`
                  : `Contenido ajustado al límite de ${doc.max_pages ?? 10} páginas.`}
          </p>
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
              {message.documentProgress ? (
                renderDocumentProgress(message.documentProgress)
              ) : message.editResult && !message.document ? (
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
                  {message.document && renderDocumentCard(message.document)}
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
                          key={`file-${idx}`}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md ${colors.fileTagBg} ${colors.fileTagText}`}
                        >
                          <Paperclip size={12} className="shrink-0" />
                          {f.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {message.images?.map((img, idx) => (
                    <Image key={`img-${idx}`} src={img} alt="Imagen adjunta al mensaje" width={320} height={160} className="mt-2 max-h-40 w-auto rounded-lg" />
                  ))}
                </>
              )}
            </div>

            {(!message.editResult || message.document) && (
              <div
                className={`flex flex-wrap gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity ${
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
                {message.role === "ai" && isLastAi && onRegenerate && !message.document && !message.documentProgress && (
                  <button
                    onClick={onRegenerate}
                    className={`text-xs px-2 py-1 rounded transition ${colors.buttonBg} ${colors.buttonHover} ${colors.buttonText} ${colors.buttonHoverText}`}
                    title="Regenerar respuesta"
                  >
                    <RefreshCw size={14} />
                  </button>
                )}
                {message.role === "ai" && !message.document && !message.documentProgress && onExportPdf && (
                  <button
                    onClick={handleExportPdf}
                    disabled={exporting}
                    className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded transition disabled:opacity-60 ${colors.buttonBg} ${colors.buttonHover} ${colors.buttonText} ${colors.buttonHoverText}`}
                    title="Exportar esta respuesta a PDF"
                  >
                    {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
                    <span>Exportar PDF</span>
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

            {actionError && (
              <div
                className={`mt-1 flex flex-wrap items-center gap-2 text-xs ${
                  darkMode ? "text-red-400" : "text-red-600"
                }`}
                role="alert"
              >
                <span>{actionError}</span>
                {onExportPdf && !message.document && !message.documentProgress && (
                  <button
                    onClick={handleExportPdf}
                    disabled={exporting}
                    className="underline underline-offset-2 hover:no-underline disabled:opacity-60"
                  >
                    Reintentar
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {previewOpen && message.document && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 text-left sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`Vista previa de ${message.document.title || message.document.filename}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreviewOpen(false);
          }}
        >
          <div className={`flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl shadow-2xl ${darkMode ? "bg-[#0b1220]" : "bg-white"}`}>
            <div className={`flex items-center gap-3 border-b px-4 py-3 ${darkMode ? "border-[#202938]" : "border-gray-200"}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{message.document.title || "Documento"}</p>
                <p className={`truncate text-xs ${colors.muted}`}>{message.document.filename}</p>
              </div>
              <button
                onClick={() => setPreviewOpen(false)}
                className={`rounded p-1.5 transition ${colors.buttonBg} ${colors.buttonHover} ${colors.buttonText} ${colors.buttonHoverText}`}
                title="Cerrar vista previa"
                aria-label="Cerrar vista previa"
              >
                <X size={18} />
              </button>
            </div>
            <iframe
              src={message.document.previewUrl}
              title={`Vista previa de ${message.document.title || message.document.filename}`}
              className="min-h-0 w-full flex-1 bg-white"
            />
            <div className={`flex flex-wrap gap-2 border-t px-4 py-3 ${darkMode ? "border-[#202938]" : "border-gray-200"}`}>
              <a
                href={message.document.downloadUrl}
                download={message.document.filename}
                className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition ${colors.buttonBg} ${colors.buttonHover} ${colors.buttonText} ${colors.buttonHoverText}`}
              >
                <Download size={14} />
                Descargar
              </a>
              <a
                href={message.document.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition ${colors.buttonBg} ${colors.buttonHover} ${colors.buttonText} ${colors.buttonHoverText}`}
              >
                <ExternalLink size={14} />
                Abrir en pestaña
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatMessage;

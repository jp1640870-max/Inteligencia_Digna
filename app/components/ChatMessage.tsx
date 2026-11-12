"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
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
import MarkdownMessage from "./MarkdownMessage";
import MessageSources from "./MessageSources";
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
  streaming?: boolean;
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

const TypingDots = () => (
  <div className="chat-typing" role="status" aria-label="Escribiendo respuesta">
    <span />
    <span />
    <span />
  </div>
);

const ChatMessage = ({
  message,
  index,
  isLastAi,
  streaming = false,
  onEdit,
  onRegenerate,
  onExportPdf,
  darkMode,
}: Props) => {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.text || "");
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const isUser = message.role === "user";
  const sourceIdPrefix = `msg-${message.id ?? message.localId ?? index}`;

  useEffect(() => {
    if (!previewOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewOpen]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.text || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setActionError("No se pudo copiar el mensaje.");
    }
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
    const formatIcon =
      editResult.format === "xlsx" ? (
        <FileSpreadsheet size={16} />
      ) : editResult.format === "docx" ? (
        <FileText size={16} />
      ) : (
        <FileType2 size={16} />
      );

    const formatLabel =
      editResult.format === "xlsx" ? "Excel" : editResult.format === "docx" ? "Word" : "PDF";

    return (
      <div className="chat-edit-result">
        <div className="chat-edit-result-head">
          {formatIcon}
          <span>{editResult.success ? "Documento modificado" : "Error al modificar"}</span>
        </div>
        <p className="chat-edit-result-detail">
          {editResult.changesCount > 0
            ? `${editResult.changesCount} cambio(s) aplicado(s) a ${editResult.originalName}`
            : editResult.error || "No se realizaron cambios"}
        </p>
        {editResult.success && (editResult.downloadUrl || editResult.dataUri) && (
          <button
            type="button"
            onClick={() => handleDownloadEditResult(editResult)}
            disabled={downloading}
            className="chat-doc-button"
          >
            <Download size={14} className={downloading ? "animate-spin" : ""} />
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

  const renderDocumentProgress = (progress: DocumentProgress) => {
    const percent = progressPercent(progress);
    return (
      <div className="chat-progress" role="status" aria-live="polite">
        <div className="chat-progress-head">
          <Loader2 size={16} className="animate-spin" />
          <span>{progressLabel(progress.stage)}</span>
          <span className="chat-progress-percent">{percent}%</span>
        </div>
        <p className="chat-progress-note">
          Documento de hasta 10 páginas. Esto puede tardar unos segundos.
        </p>
        {progress.summary && <p className="chat-progress-summary">{progress.summary}</p>}
        <div className="chat-progress-bar">
          <div className="chat-progress-fill" style={{ width: `${percent}%` }} />
        </div>
      </div>
    );
  };

  const renderDocumentCard = (doc: GeneratedDocumentMeta) => {
    const formatIcon =
      doc.format === "xlsx" ? (
        <FileSpreadsheet size={18} />
      ) : doc.format === "docx" ? (
        <FileText size={18} />
      ) : (
        <FileType2 size={18} />
      );
    const formatLabel =
      doc.format === "xlsx" ? "Excel" : doc.format === "docx" ? "Word" : "PDF";
    const generatedLabel =
      doc.format === "pdf"
        ? "PDF generado"
        : doc.format === "docx"
          ? "Documento Word generado"
          : "Hoja de cálculo generada";
    const details = [
      formatLabel,
      doc.page_count ? `${doc.page_count} página${doc.page_count === 1 ? "" : "s"}` : null,
      doc.size_bytes ? formatBytes(doc.size_bytes) : null,
    ]
      .filter(Boolean)
      .join(" · ");

    return (
      <div className="chat-doc-card">
        <div className="chat-doc-top">
          <div className="chat-doc-icon">{formatIcon}</div>
          <div className="chat-doc-info">
            <p className="chat-doc-title">{generatedLabel}</p>
            <p className="chat-doc-name">{doc.title || doc.filename}</p>
            <p className="chat-doc-detail">
              {doc.filename} · {details}
            </p>
          </div>
        </div>
        <div className="chat-doc-actions">
          {doc.format === "pdf" && (
            <button type="button" onClick={() => setPreviewOpen(true)} className="chat-doc-button">
              <Eye size={14} />
              Ver
            </button>
          )}
          <a href={doc.downloadUrl} download={doc.filename} className="chat-doc-button">
            <Download size={14} />
            Descargar
          </a>
          {doc.docxUrl && (
            <a href={doc.docxUrl} download className="chat-doc-button">
              <FileText size={14} />
              Word
            </a>
          )}
        </div>
        {(doc.truncated || doc.page_limit_exceeded || doc.partial) && (
          <p className="chat-doc-warning">
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

  const renderAttachments = () => (
    <>
      {message.files && message.files.length > 0 && (
        <div className="chat-attachments">
          {message.files.map((file, idx) => (
            <span key={`file-${idx}`} className="chat-file-chip">
              <Paperclip size={12} aria-hidden="true" />
              {file.name}
            </span>
          ))}
        </div>
      )}
      {message.images && message.images.length > 0 && (
        <div className="chat-message-images">
          {message.images.map((img, idx) => (
            <Image
              key={`img-${idx}`}
              src={img}
              alt="Imagen adjunta al mensaje"
              width={320}
              height={200}
              className="chat-message-image"
            />
          ))}
        </div>
      )}
    </>
  );

  const renderContent = () => {
    if (message.documentProgress) return renderDocumentProgress(message.documentProgress);
    if (message.editResult && !message.document) return renderEditResult(message.editResult);

    if (isUser) {
      return (
        <div className="chat-user-bubble">
          {message.text && (
            <MarkdownMessage
              text={message.text}
              sourceIdPrefix={sourceIdPrefix}
              darkMode={darkMode}
              compact
            />
          )}
          {renderAttachments()}
        </div>
      );
    }

    return (
      <div className="chat-assistant-body">
        {message.text ? (
          <MarkdownMessage
            text={message.text}
            sources={message.sources}
            sourceIdPrefix={sourceIdPrefix}
            darkMode={darkMode}
            showCursor={streaming}
          />
        ) : streaming ? (
          <TypingDots />
        ) : null}

        {message.document && renderDocumentCard(message.document)}

        {message.sources && message.sources.length > 0 && (
          <MessageSources sources={message.sources} idPrefix={sourceIdPrefix} />
        )}

        {renderAttachments()}
      </div>
    );
  };

  const showActions =
    !editing &&
    !streaming &&
    !message.documentProgress &&
    (!message.editResult || Boolean(message.document));

  return (
    <article
      className={`chat-message ${isUser ? "chat-message-user" : "chat-message-ai"} ${
        darkMode ? "chat-theme-dark" : "chat-theme-light"
      }`}
    >
      {!isUser && (
        <div className="chat-avatar" aria-hidden="true">
          ID
        </div>
      )}

      <div className="chat-message-content">
        {!isUser && (
          <div className="chat-assistant-meta">
            <span className="chat-assistant-name">Inteligencia Digna</span>
            <span className="chat-ai-badge">IA</span>
            {streaming && <span className="chat-assistant-status">escribiendo…</span>}
          </div>
        )}

        {editing ? (
          <div className="chat-edit-box">
            <textarea
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
              className="chat-edit-textarea"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSaveEdit();
                }
                if (event.key === "Escape") handleCancelEdit();
              }}
              autoFocus
              aria-label="Editar mensaje"
            />
            <div className="chat-edit-actions">
              <button type="button" onClick={handleCancelEdit} className="chat-edit-cancel">
                Cancelar
              </button>
              <button type="button" onClick={handleSaveEdit} className="chat-edit-save">
                Guardar
              </button>
            </div>
          </div>
        ) : (
          <>
            {renderContent()}

            {showActions && (
              <div className="chat-actions">
                {isUser && onEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditValue(message.text || "");
                      setEditing(true);
                    }}
                    className="chat-action-btn"
                    title="Editar mensaje"
                    aria-label="Editar mensaje"
                  >
                    <Pencil size={15} />
                  </button>
                )}

                {!isUser && isLastAi && onRegenerate && !message.document && (
                  <button
                    type="button"
                    onClick={onRegenerate}
                    className="chat-action-btn"
                    title="Regenerar respuesta"
                    aria-label="Regenerar respuesta"
                  >
                    <RefreshCw size={15} />
                  </button>
                )}

                {!isUser && onExportPdf && !message.document && (
                  <button
                    type="button"
                    onClick={handleExportPdf}
                    disabled={exporting}
                    className="chat-action-btn"
                    title="Exportar a PDF"
                    aria-label="Exportar a PDF"
                  >
                    {exporting ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} />}
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleCopy}
                  className="chat-action-btn"
                  title="Copiar mensaje"
                  aria-label="Copiar mensaje"
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                </button>
              </div>
            )}

            {actionError && (
              <div className="chat-action-error" role="alert">
                <span>{actionError}</span>
                {onExportPdf && !message.document && !isUser && (
                  <button type="button" onClick={handleExportPdf} disabled={exporting}>
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
          className="chat-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={`Vista previa de ${message.document.title || message.document.filename}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreviewOpen(false);
          }}
        >
          <div className="chat-modal">
            <div className="chat-modal-head">
              <div className="chat-modal-title-wrap">
                <p className="chat-modal-title">{message.document.title || "Documento"}</p>
                <p className="chat-modal-subtitle">{message.document.filename}</p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="chat-action-btn"
                title="Cerrar vista previa"
                aria-label="Cerrar vista previa"
              >
                <X size={18} />
              </button>
            </div>
            <iframe
              src={message.document.previewUrl}
              title={`Vista previa de ${message.document.title || message.document.filename}`}
              className="chat-modal-iframe"
            />
            <div className="chat-modal-actions">
              <a
                href={message.document.downloadUrl}
                download={message.document.filename}
                className="chat-doc-button"
              >
                <Download size={14} />
                Descargar
              </a>
              <a
                href={message.document.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="chat-doc-button"
              >
                <ExternalLink size={14} />
                Abrir en pestaña
              </a>
            </div>
          </div>
        </div>
      )}
    </article>
  );
};

export default ChatMessage;

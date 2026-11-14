"use client";

import {
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  X,
} from "lucide-react";
import type { DocumentLibraryItem } from "@/types";

type DocumentPreviewPanelProps = {
  item: DocumentLibraryItem | null;
  onClose?: () => void;
};

function formatFileSize(bytes: number): string {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function iconForFormat(format: string) {
  switch (format) {
    case "xlsx":
      return <FileSpreadsheet size={20} strokeWidth={1.7} />;
    default:
      return <FileText size={20} strokeWidth={1.7} />;
  }
}

export default function DocumentPreviewPanel({
  item,
  onClose,
}: DocumentPreviewPanelProps) {
  if (!item) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--chat-border)] bg-[var(--sidebar-card)] text-[var(--sidebar-muted)]">
          <FileText size={24} strokeWidth={1.5} />
        </div>
        <p className="text-sm font-medium text-[var(--sidebar-text)]">
          Selecciona un documento
        </p>
        <p className="max-w-xs text-xs text-[var(--sidebar-muted)]">
          Elige un archivo de la lista para verlo aquí sin salir de la
          biblioteca.
        </p>
      </div>
    );
  }

  const isPdf = item.format === "pdf";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header del visor */}
      <div className="flex items-start gap-3 border-b border-[var(--chat-border)] px-4 py-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
            item.format === "pdf"
              ? "border-red-500/20 bg-red-500/10 text-red-400"
              : item.format === "xlsx"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-500"
                : "border-blue-500/20 bg-blue-500/10 text-blue-400"
          }`}
        >
          {iconForFormat(item.format)}
        </div>

        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-semibold text-[var(--sidebar-text)]"
            title={item.title}
          >
            {item.title}
          </p>
          <p className="truncate text-[11px] text-[var(--sidebar-muted)]">
            {item.filename} · v{item.version} · {formatFileSize(item.size_bytes)}
            {item.page_count ? ` · ${item.page_count} pág.` : ""}
            {" · "}
            {formatDate(item.created_at)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <a
            href={item.downloadUrl}
            className="rounded-lg p-2 text-[var(--sidebar-muted)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[var(--chat-accent)]"
            title="Descargar"
            aria-label="Descargar"
          >
            <Download size={16} strokeWidth={1.8} />
          </a>
          <a
            href={item.previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg p-2 text-[var(--sidebar-muted)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[var(--chat-accent)]"
            title="Abrir en nueva pestaña"
            aria-label="Abrir en nueva pestaña"
          >
            <ExternalLink size={16} strokeWidth={1.8} />
          </a>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-[var(--sidebar-muted)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-text)] lg:hidden"
              title="Cerrar visor"
              aria-label="Cerrar visor"
            >
              <X size={16} strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>

      {/* Cuerpo del visor */}
      <div className="min-h-0 flex-1 bg-[var(--chat-bg-soft)]">
        {isPdf ? (
          <iframe
            key={item.id}
            src={item.previewUrl}
            title={`Vista previa de ${item.title}`}
            className="h-full w-full border-0"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--chat-border)] bg-[var(--sidebar-card)] text-[var(--sidebar-muted)]">
              {iconForFormat(item.format)}
            </div>
            <p className="text-sm font-medium text-[var(--sidebar-text)]">
              Vista previa no disponible
            </p>
            <p className="max-w-xs text-xs text-[var(--sidebar-muted)]">
              Los archivos {item.format.toUpperCase()} no se pueden previsualizar
              dentro del navegador. Descárgalo o ábrelo en una pestaña nueva.
            </p>
            <div className="flex gap-2">
              <a
                href={item.downloadUrl}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--chat-accent-border)] bg-[var(--chat-accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--chat-accent)] transition-colors hover:bg-[var(--chat-accent)] hover:text-white"
              >
                <Download size={14} strokeWidth={1.8} />
                Descargar
              </a>
              <a
                href={item.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--chat-border)] bg-[var(--sidebar-card)] px-3 py-1.5 text-xs font-medium text-[var(--sidebar-text)] transition-colors hover:border-[var(--chat-accent-border)]"
              >
                <ExternalLink size={14} strokeWidth={1.8} />
                Abrir
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

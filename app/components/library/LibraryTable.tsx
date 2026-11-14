"use client";

import { useState } from "react";
import {
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FileText,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import type { DocumentLibraryItem } from "@/types";

type LibraryTableProps = {
  items: DocumentLibraryItem[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (item: DocumentLibraryItem) => void;
  onDelete: (item: DocumentLibraryItem) => Promise<void>;
};

type MenuState = {
  id: string;
  top: number;
  left: number;
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

function sourceLabel(source: string): string {
  return source === "export" ? "Exportación" : "Chat";
}

function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Pendiente";
    case "failed":
      return "Error";
    default:
      return "Listo";
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "pending":
      return "border-amber-500/30 bg-amber-500/10 text-amber-500";
    case "failed":
      return "border-red-500/30 bg-red-500/10 text-red-400";
    default:
      return "border-[var(--chat-accent-border)] bg-[var(--chat-accent-soft)] text-[var(--chat-accent)]";
  }
}

function formatIcon(format: string) {
  if (format === "xlsx") {
    return (
      <FileSpreadsheet size={18} strokeWidth={1.7} />
    );
  }
  return <FileText size={18} strokeWidth={1.7} />;
}

function formatIconClass(format: string): string {
  switch (format) {
    case "pdf":
      return "border-red-500/20 bg-red-500/10 text-red-400";
    case "docx":
      return "border-blue-500/20 bg-blue-500/10 text-blue-400";
    case "xlsx":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-500";
    default:
      return "border-[var(--chat-border)] bg-[var(--sidebar-card)] text-[var(--sidebar-muted)]";
  }
}

export default function LibraryTable({
  items,
  selectedId,
  loading,
  onSelect,
  onDelete,
}: LibraryTableProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>, id: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const menuHeight = 176;
    const top =
      rect.bottom + 4 + menuHeight > window.innerHeight
        ? Math.max(8, rect.top - menuHeight - 4)
        : rect.bottom + 4;
    setMenu({
      id,
      top,
      left: Math.max(8, rect.right - 200),
    });
  };

  const closeMenu = () => setMenu(null);

  const handleDelete = async (item: DocumentLibraryItem) => {
    closeMenu();
    if (!window.confirm(`¿Eliminar el documento "${item.title}"?`)) return;
    setDeletingId(item.id);
    try {
      await onDelete(item);
    } finally {
      setDeletingId(null);
    }
  };

  if (loading && items.length === 0) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="h-14 animate-pulse rounded-xl border border-[var(--chat-border-soft)] bg-[var(--sidebar-card)]"
          />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--chat-border)] bg-[var(--sidebar-card)] text-[var(--sidebar-muted)]">
          <FileText size={24} strokeWidth={1.5} />
        </div>
        <p className="text-sm font-medium text-[var(--sidebar-text)]">
          No hay documentos
        </p>
        <p className="max-w-xs text-xs text-[var(--sidebar-muted)]">
          Los documentos que generes desde el chat aparecerán aquí.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Cabecera de columnas */}
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_36px] items-center gap-2 border-b border-[var(--chat-border)] bg-[var(--chat-bg-soft)]/95 px-3 py-2 backdrop-blur sm:grid-cols-[minmax(0,1fr)_104px_110px_36px]">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sidebar-muted)]">
            File
          </span>
          <span className="hidden text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sidebar-muted)] sm:block">
            Created
          </span>
          <span className="hidden text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sidebar-muted)] sm:block">
            Source
          </span>
          <span aria-hidden="true" />
        </div>

        <div className="p-2">
          {items.map((item) => {
            const selected = item.id === selectedId;
            return (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(item);
                  }
                }}
                className={`group grid cursor-pointer grid-cols-[minmax(0,1fr)_36px] items-center gap-2 rounded-xl border px-3 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--chat-accent-border)] sm:grid-cols-[minmax(0,1fr)_104px_110px_36px] ${
                  selected
                    ? "border-[var(--chat-accent-border)] bg-[var(--chat-accent-soft)]"
                    : "border-transparent hover:border-[var(--chat-border-soft)] hover:bg-[var(--sidebar-hover)]"
                }`}
              >
                {/* Archivo */}
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${formatIconClass(item.format)}`}
                  >
                    {formatIcon(item.format)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p
                        className="truncate text-[13px] font-semibold text-[var(--sidebar-text)]"
                        title={item.title}
                      >
                        {item.title}
                      </p>
                      {item.status !== "ready" && (
                        <span
                          className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${statusClass(item.status)}`}
                        >
                          {statusLabel(item.status)}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[11px] text-[var(--sidebar-muted)]">
                      {formatFileSize(item.size_bytes)}
                      {item.page_count ? ` · ${item.page_count} pág.` : ""}
                      {item.partial ? " · Parcial" : ""}
                      {` · v${item.version}`}
                    </p>
                  </div>
                </div>

                {/* Fecha */}
                <span className="hidden text-[11px] text-[var(--sidebar-muted)] sm:block">
                  {formatDate(item.created_at)}
                </span>

                {/* Origen */}
                <span className="hidden truncate text-[11px] text-[var(--sidebar-muted)] sm:block">
                  {sourceLabel(item.source)}
                </span>

                {/* Menú */}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openMenu(event, item.id);
                  }}
                  disabled={deletingId === item.id}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--sidebar-muted)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-text)] disabled:opacity-40"
                  title="Acciones"
                  aria-label="Acciones"
                  aria-haspopup="menu"
                  aria-expanded={menu?.id === item.id}
                >
                  <MoreHorizontal size={16} strokeWidth={1.8} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Menú de acciones (fixed para no recortarse con el scroll) */}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeMenu} aria-hidden="true" />
          <div
            role="menu"
            className="fixed z-50 w-[200px] overflow-hidden rounded-xl border border-[var(--chat-border)] bg-[var(--sidebar-popover)] p-1 shadow-2xl backdrop-blur-xl"
            style={{ top: menu.top, left: menu.left }}
          >
            {(() => {
              const item = items.find((entry) => entry.id === menu.id);
              if (!item) return null;
              return (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closeMenu();
                      onSelect(item);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-[var(--sidebar-text)] transition-colors hover:bg-[var(--sidebar-hover)]"
                  >
                    <Eye size={14} strokeWidth={1.8} />
                    Vista previa
                  </button>
                  <a
                    role="menuitem"
                    href={item.downloadUrl}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-[var(--sidebar-text)] transition-colors hover:bg-[var(--sidebar-hover)]"
                    onClick={closeMenu}
                  >
                    <Download size={14} strokeWidth={1.8} />
                    Descargar
                  </a>
                  <a
                    role="menuitem"
                    href={item.previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-[var(--sidebar-text)] transition-colors hover:bg-[var(--sidebar-hover)]"
                    onClick={closeMenu}
                  >
                    <ExternalLink size={14} strokeWidth={1.8} />
                    Abrir en pestaña nueva
                  </a>
                  <div className="my-1 border-t border-[var(--chat-border-soft)]" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleDelete(item)}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-red-400 transition-colors hover:bg-red-500/10"
                  >
                    <Trash2 size={14} strokeWidth={1.8} />
                    Eliminar
                  </button>
                </>
              );
            })()}
          </div>
        </>
      )}
    </>
  );
}

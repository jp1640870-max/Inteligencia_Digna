"use client";

import { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import type {
  GeneratedDocumentFormat,
  GeneratedDocumentStatus,
} from "@/types";

type DocumentSearchFiltersProps = {
  search: string;
  format: GeneratedDocumentFormat | null;
  status: GeneratedDocumentStatus | null;
  onChange: (filters: {
    search: string;
    format: GeneratedDocumentFormat | null;
    status: GeneratedDocumentStatus | null;
  }) => void;
};

const FORMAT_OPTIONS: { value: GeneratedDocumentFormat; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "DOCX" },
  { value: "xlsx", label: "XLSX" },
];

const STATUS_OPTIONS: { value: GeneratedDocumentStatus; label: string }[] = [
  { value: "ready", label: "Listo" },
  { value: "pending", label: "Pendiente" },
  { value: "failed", label: "Error" },
];

export default function DocumentSearchFilters({
  search,
  format,
  status,
  onChange,
}: DocumentSearchFiltersProps) {
  const [expanded, setExpanded] = useState(false);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ search: e.target.value, format, status });
  };

  const handleFormatChange = (value: GeneratedDocumentFormat | null) => {
    onChange({ search, format: value, status });
  };

  const handleStatusChange = (value: GeneratedDocumentStatus | null) => {
    onChange({ search, format, status: value });
  };

  const hasFilters = Boolean(format || status);

  const chipBase =
    "rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors";
  const chipActive =
    "border-[var(--chat-accent-border)] bg-[var(--chat-accent-soft)] text-[var(--chat-accent)]";
  const chipIdle =
    "border-[var(--chat-border)] text-[var(--sidebar-muted)] hover:border-[var(--chat-accent-border)] hover:text-[var(--sidebar-text)]";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search
            size={15}
            strokeWidth={1.7}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--sidebar-muted)]"
          />
          <input
            type="text"
            value={search}
            onChange={handleSearchChange}
            placeholder="Buscar por título o archivo…"
            className="w-full rounded-xl border border-[var(--chat-border)] bg-[var(--sidebar-card)] py-2 pl-9 pr-9 text-[13px] text-[var(--sidebar-text)] outline-none transition-colors placeholder:text-[var(--sidebar-faint)] focus:border-[var(--chat-accent-border)]"
          />
          {search && (
            <button
              type="button"
              onClick={() => onChange({ search: "", format, status })}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--sidebar-muted)] transition-colors hover:text-red-400"
              title="Limpiar búsqueda"
              aria-label="Limpiar búsqueda"
            >
              <X size={13} strokeWidth={1.8} />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[12px] font-medium transition-colors ${
            hasFilters || expanded
              ? chipActive
              : "border-[var(--chat-border)] bg-[var(--sidebar-card)] text-[var(--sidebar-muted)] hover:text-[var(--sidebar-text)]"
          }`}
          aria-expanded={expanded}
        >
          <SlidersHorizontal size={14} strokeWidth={1.7} />
          Filtros
          {hasFilters && (
            <span className="rounded-md bg-[var(--chat-accent)] px-1.5 text-[9px] font-bold text-white">
              {[format, status].filter(Boolean).length}
            </span>
          )}
        </button>
      </div>

      {expanded && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-[var(--chat-border)] bg-[var(--sidebar-card)] px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--sidebar-muted)]">
              Formato
            </span>
            <button
              type="button"
              onClick={() => handleFormatChange(null)}
              className={`${chipBase} ${!format ? chipActive : chipIdle}`}
            >
              Todos
            </button>
            {FORMAT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleFormatChange(option.value)}
                className={`${chipBase} ${format === option.value ? chipActive : chipIdle}`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--sidebar-muted)]">
              Estado
            </span>
            <button
              type="button"
              onClick={() => handleStatusChange(null)}
              className={`${chipBase} ${!status ? chipActive : chipIdle}`}
            >
              Todos
            </button>
            {STATUS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleStatusChange(option.value)}
                className={`${chipBase} ${status === option.value ? chipActive : chipIdle}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

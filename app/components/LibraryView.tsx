"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Library, RefreshCw } from "lucide-react";
import DocumentSearchFilters from "./library/DocumentSearchFilters";
import LibraryTable from "./library/LibraryTable";
import DocumentPreviewPanel from "./library/DocumentPreviewPanel";
import type {
  DocumentLibraryFilters,
  DocumentLibraryItem,
  DocumentLibraryPage,
  GeneratedDocumentFormat,
  GeneratedDocumentStatus,
} from "@/types";

const PAGE_SIZE = 20;

async function fetchLibraryPage(
  filters: DocumentLibraryFilters,
  page: number,
): Promise<DocumentLibraryPage> {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.format) params.set("format", filters.format);
  if (filters.status) params.set("status", filters.status);
  params.set("page", String(page));
  params.set("pageSize", String(PAGE_SIZE));

  const res = await fetch(`/api/library?${params.toString()}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Error ${res.status} al listar documentos`);
  }

  const data = await res.json();
  return {
    items: data.items ?? [],
    total: Number(data.total ?? 0),
    page: Number(data.page ?? page),
    pageSize: Number(data.pageSize ?? PAGE_SIZE),
    totalPages: Number(data.totalPages ?? 1),
  };
}

async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`/api/library/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Error ${res.status} al eliminar`);
  }
}

const EMPTY_PAGE: DocumentLibraryPage = {
  items: [],
  total: 0,
  page: 1,
  pageSize: PAGE_SIZE,
  totalPages: 1,
};

export default function LibraryView() {
  const [filters, setFilters] = useState<DocumentLibraryFilters>({
    search: "",
    format: null,
    status: null,
  });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DocumentLibraryPage>(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobilePreviewId, setMobilePreviewId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchLibraryPage(filters, page);
      setData(result);
      setSelectedId((current) => {
        if (current && result.items.some((item) => item.id === current)) {
          return current;
        }
        return result.items[0]?.id ?? null;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error inesperado";
      setError(message);
      setData(EMPTY_PAGE);
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  // Recarga con debounce para no saturar al escribir en el buscador.
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const handleFiltersChange = useCallback(
    (next: {
      search: string;
      format: GeneratedDocumentFormat | null;
      status: GeneratedDocumentStatus | null;
    }) => {
      setPage(1);
      setFilters({
        search: next.search,
        format: next.format,
        status: next.status,
      });
    },
    [],
  );

  const handleSelect = useCallback((item: DocumentLibraryItem) => {
    setSelectedId(item.id);
    setMobilePreviewId(item.id);
  }, []);

  const handleDelete = useCallback(
    async (item: DocumentLibraryItem) => {
      await deleteDocument(item.id);
      if (selectedId === item.id) setSelectedId(null);
      if (mobilePreviewId === item.id) setMobilePreviewId(null);
      await load();
    },
    [load, selectedId, mobilePreviewId],
  );

  const selectedItem = useMemo(
    () => data.items.find((item) => item.id === selectedId) ?? null,
    [data.items, selectedId],
  );

  const mobileItem = useMemo(
    () => data.items.find((item) => item.id === mobilePreviewId) ?? null,
    [data.items, mobilePreviewId],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="border-b border-[var(--chat-border-soft)] px-4 py-3 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--chat-accent-border)] bg-[var(--chat-accent-soft)] text-[var(--chat-accent)]">
              <Library size={17} strokeWidth={1.8} />
            </div>
            <div>
              <h1 className="text-base font-semibold text-[var(--sidebar-text)]">
                Biblioteca
              </h1>
              <p className="text-[11px] text-[var(--sidebar-muted)]">
                {data.total} documento{data.total === 1 ? "" : "s"} generado
                {data.total === 1 ? "" : "s"} por la IA
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--chat-border)] bg-[var(--sidebar-card)] px-3 py-1.5 text-[12px] font-medium text-[var(--sidebar-muted)] transition-colors hover:text-[var(--sidebar-text)] disabled:opacity-50"
            title="Actualizar"
          >
            <RefreshCw
              size={13}
              strokeWidth={1.8}
              className={loading ? "animate-spin" : ""}
            />
            Actualizar
          </button>
        </div>

        <div className="mt-3">
          <DocumentSearchFilters
            search={filters.search ?? ""}
            format={filters.format ?? null}
            status={filters.status ?? null}
            onChange={handleFiltersChange}
          />
        </div>
      </div>

      {error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-red-400">{error}</p>
          <button
            type="button"
            onClick={load}
            className="rounded-lg border border-[var(--chat-accent-border)] bg-[var(--chat-accent-soft)] px-4 py-2 text-xs font-medium text-[var(--chat-accent)] transition-colors hover:bg-[var(--chat-accent)] hover:text-white"
          >
            Reintentar
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* Panel de tabla */}
          <div className="flex min-h-0 flex-1 flex-col lg:max-w-[46%] lg:border-r lg:border-[var(--chat-border)]">
            <LibraryTable
              items={data.items}
              selectedId={selectedId}
              loading={loading}
              onSelect={handleSelect}
              onDelete={handleDelete}
            />

            {/* Paginación */}
            {data.total > 0 && (
              <div className="flex items-center justify-between border-t border-[var(--chat-border-soft)] px-3 py-2">
                <span className="text-[11px] text-[var(--sidebar-muted)]">
                  Página {data.page} de {data.totalPages}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={data.page <= 1 || loading}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--chat-border)] text-[var(--sidebar-muted)] transition-colors hover:text-[var(--sidebar-text)] disabled:opacity-40"
                    title="Página anterior"
                    aria-label="Página anterior"
                  >
                    <ChevronLeft size={14} strokeWidth={1.8} />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPage((current) => Math.min(data.totalPages, current + 1))
                    }
                    disabled={data.page >= data.totalPages || loading}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--chat-border)] text-[var(--sidebar-muted)] transition-colors hover:text-[var(--sidebar-text)] disabled:opacity-40"
                    title="Página siguiente"
                    aria-label="Página siguiente"
                  >
                    <ChevronRight size={14} strokeWidth={1.8} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Visor de escritorio */}
          <div className="hidden min-h-0 flex-1 lg:block">
            <DocumentPreviewPanel item={selectedItem} />
          </div>
        </div>
      )}

      {/* Visor móvil (overlay) */}
      {mobileItem && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Vista previa de ${mobileItem.title}`}
          className="fixed inset-0 z-50 flex flex-col bg-[var(--chat-bg)] lg:hidden"
        >
          <DocumentPreviewPanel
            item={mobileItem}
            onClose={() => setMobilePreviewId(null)}
          />
        </div>
      )}
    </div>
  );
}

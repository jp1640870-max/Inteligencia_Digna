"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, X } from "lucide-react";
import { useChatStore } from "@/lib/stores/chat-store";
import type { SupportEscalationRequest } from "@/lib/support-escalation";

type Props = {
  onClose: () => void;
};

const FIELD_LABELS: Record<string, string> = {
  summary: "Resumen del problema",
  description: "Descripción",
  category: "Categoría sugerida",
  priority: "Prioridad sugerida",
  reported_by: "Reportado por",
  escalation_reason: "Motivo del escalamiento",
};

const ESCALATION_FIELDS = [
  "summary",
  "description",
  "category",
  "priority",
  "reported_by",
  "escalation_reason",
] as const;

export default function SupportEscalationModal({ onClose }: Props) {
  const chatId = useChatStore((s) => s.chatId);
  const [request, setRequest] = useState<SupportEscalationRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const res = await fetch("/api/support/escalation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId }),
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          request?: SupportEscalationRequest;
        };
        if (!res.ok || !data.request) {
          setError(data.error || "No se pudo preparar la solicitud.");
          return;
        }
        setRequest(data.request);
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        setError("No se pudo conectar con el servidor.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [chatId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-escalation-title"
        className="surface-modal flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--sidebar-border)] px-6 py-4">
          <div>
            <h2
              id="support-escalation-title"
              className="text-lg font-semibold text-[var(--chat-text)]"
            >
              Preparar escalamiento
            </h2>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--chat-muted)]">
              <ShieldCheck size={14} aria-hidden="true" />
              Vista previa local · no se creó ningún ticket
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar vista previa"
            className="rounded-lg p-1.5 text-[var(--chat-muted)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[var(--chat-text)]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex items-center gap-2 py-8 text-sm text-[var(--chat-muted)]">
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              Preparando solicitud…
            </div>
          )}

          {!loading && error && (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </p>
          )}

          {!loading && request && (
            <div className="space-y-5">
              {ESCALATION_FIELDS.map((field) => (
                <div key={field}>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--chat-muted)]">
                    {FIELD_LABELS[field]}
                  </p>
                  <div className="whitespace-pre-wrap rounded-xl border border-[var(--sidebar-border)] bg-[var(--sidebar-card)] px-3.5 py-2.5 text-sm text-[var(--chat-text)]">
                    {request[field] || "—"}
                  </div>
                </div>
              ))}

              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--chat-muted)]">
                  Pasos de diagnóstico realizados
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--chat-text)]">
                  {request.troubleshooting_steps.map((step, index) => (
                    <li key={`${index}-${step}`}>{step}</li>
                  ))}
                </ul>
              </div>

              <p className="rounded-xl border border-[var(--sidebar-border)] bg-[var(--sidebar-card)] px-4 py-3 text-xs text-[var(--chat-muted)]">
                Esta es una vista previa para revisión. No se envió nada a
                ServiceDesk y no se generó ningún identificador de ticket.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-[var(--sidebar-border)] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-[var(--sidebar-hover)] px-4 py-2 text-sm font-medium text-[var(--chat-text)] transition-colors hover:bg-[var(--sidebar-border)]"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

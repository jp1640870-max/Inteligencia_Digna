export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { getChatById, getMessageForUser } from "@/lib/db";
import { exportMessageDocument, type ExportMessageFormat } from "@/lib/documents";
import { checkRateLimit } from "@/lib/rate-limit";
import type { EditResult } from "@/types";

const MAX_EXPORT_TEXT_CHARS = 200_000;

type Payload = {
  messageId?: unknown;
  chatId?: unknown;
  text?: unknown;
  title?: unknown;
  summary?: unknown;
  format?: unknown;
};

/**
 * "Exportar a PDF" sobre una respuesta existente.
 *
 * No llama al LLM: convierte el Markdown del mensaje a DOCX/PDF y lo guarda.
 * Si el mensaje aún no tiene id (respuesta recién transmitida), acepta
 * `chatId` + `text` como respaldo; en ese caso el documento no queda ligado a
 * un mensaje, pero sí se puede descargar.
 */
export async function POST(req: Request) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // Cada exportación renderiza un PDF/DOCX; el límite evita que un cliente
  // reutilice el endpoint para saturar LibreOffice o el storage.
  const rateCheck = checkRateLimit(`documents:export:${userId}`, 20, 60_000);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Demasiadas exportaciones. Intenta de nuevo en unos segundos." },
      { status: 429, headers: rateCheck.headers },
    );
  }

  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON inválido" }, { status: 400 });
  }

  const numericId = Number(payload.messageId);
  const hasMessageId = Number.isInteger(numericId) && numericId > 0;
  const requestedChatId = typeof payload.chatId === "string" ? payload.chatId.trim() : "";
  const requestedText = typeof payload.text === "string" ? payload.text : "";
  const title = typeof payload.title === "string" ? payload.title.slice(0, 200) : undefined;
  const summary =
    typeof payload.summary === "string" ? payload.summary.slice(0, 2_000) : undefined;

  let format: ExportMessageFormat;
  if (payload.format === undefined || payload.format === null || payload.format === "pdf") {
    format = "pdf";
  } else if (payload.format === "docx") {
    format = "docx";
  } else {
    return NextResponse.json(
      { error: "Formato no soportado. Usa pdf o docx." },
      { status: 400 },
    );
  }

  if (!hasMessageId && requestedText.length > MAX_EXPORT_TEXT_CHARS) {
    return NextResponse.json(
      { error: `El texto supera el máximo de ${MAX_EXPORT_TEXT_CHARS} caracteres.` },
      { status: 413 },
    );
  }

  let chatId = requestedChatId;
  let markdown = requestedText;

  if (hasMessageId) {
    const message = await getMessageForUser(numericId, userId);
    if (!message) {
      return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });
    }
    if (message.role !== "assistant") {
      return NextResponse.json(
        { error: "Solo se pueden exportar respuestas del asistente" },
        { status: 400 },
      );
    }
    chatId = message.chat_id;
    markdown = message.content;
  } else {
    if (!chatId) {
      return NextResponse.json(
        { error: "Se requiere messageId o chatId + text" },
        { status: 400 },
      );
    }
    const chat = await getChatById(chatId);
    if (!chat || chat.user_id !== userId) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }
    if (!requestedText.trim()) {
      return NextResponse.json(
        { error: "El texto para exportar está vacío" },
        { status: 400 },
      );
    }
  }

  if (!markdown.trim()) {
    return NextResponse.json(
      { error: "El mensaje no tiene contenido para exportar" },
      { status: 400 },
    );
  }

  try {
    const stored = await exportMessageDocument({
      userId,
      chatId,
      messageId: hasMessageId ? numericId : null,
      markdown,
      title,
      summary,
      format,
      signal: req.signal,
    });

    const editResult: EditResult = {
      success: true,
      format: stored.document.format,
      filename: stored.document.filename,
      originalName: stored.document.filename,
      changesCount: 0,
      downloadUrl: stored.meta.downloadUrl,
      documentId: stored.document.id,
      previewUrl: stored.meta.previewUrl,
      pages: stored.document.page_count,
    };

    return NextResponse.json({
      success: true,
      document: stored.meta,
      editResult,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo exportar el documento.";
    console.error(`[documents/from-message] ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

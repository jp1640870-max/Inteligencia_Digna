import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  asciiFilename,
  contentDispositionHeader,
  documentDocxUrl,
  documentDownloadUrl,
  documentMimeType,
  documentPreviewUrl,
  documentStoragePrefix,
  makePdfSafeText,
  toGeneratedDocumentMeta,
} from "../lib/generated-document.js";
import type { GeneratedDocumentRow } from "../types/index.js";

const row: GeneratedDocumentRow = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "22222222-2222-4222-8222-222222222222",
  chat_id: "33333333-3333-4333-8333-333333333333",
  message_id: 42,
  title: "Manual de ejemplo",
  filename: "manual-de-ejemplo.pdf",
  format: "pdf",
  mime_type: "application/pdf",
  size_bytes: 1234,
  page_count: 3,
  version: "1.0",
  summary: "Un manual breve.",
  status: "ready",
  storage_provider: "minio",
  bucket: "attachments",
  object_key: "documents/u/c/abc-manual.pdf",
  docx_object_key: "documents/u/c/def-manual.docx",
  markdown_object_key: null,
  source: "chat",
  metadata: {},
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("documentStoragePrefix", () => {
  it("incluye usuario y chat", () => {
    assert.equal(
      documentStoragePrefix("user-1", "chat-1"),
      "documents/user-1/chat-1",
    );
  });

  it("omite el chat cuando no existe", () => {
    assert.equal(documentStoragePrefix("user-1", null), "documents/user-1");
  });

  it("normaliza barras sobrantes", () => {
    assert.equal(documentStoragePrefix("/user-1/", "/chat-1/"), "documents/user-1/chat-1");
  });
});

describe("URLs de documentos", () => {
  it("codifica el id y distingue descarga de vista previa", () => {
    assert.equal(documentDownloadUrl("abc"), "/api/documents/abc");
    assert.equal(documentPreviewUrl("abc"), "/api/documents/abc?inline=1");
    assert.equal(documentDocxUrl("abc"), "/api/documents/abc?format=docx");
  });
});

describe("toGeneratedDocumentMeta", () => {
  it("expone metadatos y URLs sin incluir el binario", () => {
    const meta = toGeneratedDocumentMeta(row);
    assert.equal(meta.id, row.id);
    assert.equal(meta.downloadUrl, "/api/documents/11111111-1111-4111-8111-111111111111");
    assert.equal(
      meta.previewUrl,
      "/api/documents/11111111-1111-4111-8111-111111111111?inline=1",
    );
    assert.equal(meta.docxUrl, "/api/documents/11111111-1111-4111-8111-111111111111?format=docx");
    assert.equal(meta.page_count, 3);
    assert.equal("data" in meta, false);
  });

  it("omite docxUrl cuando no hay DOCX", () => {
    const meta = toGeneratedDocumentMeta({ ...row, docx_object_key: null });
    assert.equal(meta.docxUrl, undefined);
  });
});

describe("MIME y Content-Disposition", () => {
  it("mapea los formatos soportados", () => {
    assert.equal(documentMimeType("pdf"), "application/pdf");
    assert.match(documentMimeType("docx"), /wordprocessingml/);
    assert.match(documentMimeType("xlsx"), /spreadsheetml/);
  });

  it("deja un filename ASCII de respaldo y conserva acentos en filename*", () => {
    assert.equal(asciiFilename("informe-año.pdf"), "informe-a_o.pdf");
    assert.equal(
      contentDispositionHeader("inline", "informe-año.pdf"),
      'inline; filename="informe-a_o.pdf"; filename*=UTF-8\'\'informe-a%C3%B1o.pdf',
    );
  });
});

describe("makePdfSafeText", () => {
  it("reemplaza caracteres fuera de WinAnsi", () => {
    assert.equal(makePdfSafeText("A → B — año"), "A -> B - año");
    assert.equal(makePdfSafeText("“texto”…"), '"texto"...');
    assert.equal(makePdfSafeText("emoji 😀"), "emoji ?");
  });
});

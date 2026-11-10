-- Documentos generados por el chat.
--
-- El binario (PDF/DOCX) vive en MinIO/S3; esta tabla guarda solo metadatos y
-- las claves de los objetos. Antes cada documento se serializaba en
-- `messages.doc_data` como base64, así que `GET /api/chat` crecía con cada PDF
-- del historial. `doc_data` se conserva para los documentos legacy (XLSX y
-- documentos anteriores a esta migración), pero los nuevos no lo usan.
--
-- `message_id` enlaza el documento con la respuesta del asistente que lo
-- originó. Si el mensaje se borra (edición/regeneración), la fila se borra en
-- cascada; el objeto en storage queda huérfano, igual que ocurre hoy con los
-- adjuntos. La limpieza de storage es una tarea aparte.

CREATE TABLE IF NOT EXISTS generated_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
  message_id BIGINT REFERENCES messages(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('pdf', 'docx', 'xlsx')),
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  page_count INTEGER CHECK (page_count IS NULL OR page_count >= 0),
  version TEXT NOT NULL DEFAULT '1.0',
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('pending', 'ready', 'failed')),
  storage_provider TEXT NOT NULL DEFAULT 'minio',
  bucket TEXT NOT NULL,
  object_key TEXT NOT NULL,
  -- DOCX fuente cuando el archivo principal es el PDF convertido.
  docx_object_key TEXT,
  source TEXT NOT NULL DEFAULT 'chat'
    CHECK (source IN ('chat', 'export')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (storage_provider, bucket, object_key)
);

CREATE INDEX IF NOT EXISTS generated_documents_user_id_idx
  ON generated_documents (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS generated_documents_chat_id_idx
  ON generated_documents (chat_id, created_at DESC)
  WHERE chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS generated_documents_message_id_idx
  ON generated_documents (message_id, created_at DESC)
  WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS generated_documents_status_idx
  ON generated_documents (status);

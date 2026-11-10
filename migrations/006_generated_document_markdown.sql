-- Clave del sidecar de Markdown para documentos parciales.
--
-- Cuando un documento se corta por tiempo (timeout), se guarda el Markdown
-- fuente en MinIO para poder continuar el documento en un intento posterior
-- sin volver a generarlo desde cero. La columna es NULL para documentos que
-- no son parciales.

ALTER TABLE generated_documents
  ADD COLUMN IF NOT EXISTS markdown_object_key TEXT;

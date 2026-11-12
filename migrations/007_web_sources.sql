-- Fuentes web consultadas por una respuesta del asistente.
--
-- Se guardan como JSONB para que las tarjetas de fuentes sobrevivan a una
-- recarga. Antes solo se enviaban al cliente al final del stream y se perdían
-- al volver a abrir la conversación.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS web_sources JSONB;

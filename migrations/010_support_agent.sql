-- Agente oficial "Soporte Técnico".
--
-- La columna es nullable: los chats existentes y los Hearts personales siguen
-- funcionando exactamente igual (agent_key = NULL). Solo las conversaciones
-- iniciadas desde el agente oficial guardan su identificador estable aquí.
ALTER TABLE chats
  ADD COLUMN IF NOT EXISTS agent_key TEXT;

CREATE INDEX IF NOT EXISTS chats_agent_key_idx
  ON chats (agent_key)
  WHERE agent_key IS NOT NULL;

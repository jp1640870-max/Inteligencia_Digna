-- Generación y edición conversacional de imágenes.
--
-- Los binarios (referencias y resultados) viven en MinIO y se registran en
-- `attachments`, igual que los archivos de la base de conocimiento. Estas
-- tablas guardan el trabajo, su estado, la relación con el chat/mensaje y los
-- metadatos específicos de imagen.
--
-- El worker reclama trabajos con `FOR UPDATE SKIP LOCKED`; por eso el índice
-- principal es (status, available_at). `client_request_id` es la clave de
-- idempotencia: un reintento de red no debe crear dos trabajos ni dos imágenes.

CREATE TABLE IF NOT EXISTS image_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_message_id BIGINT REFERENCES messages(id) ON DELETE CASCADE,
  assistant_message_id BIGINT REFERENCES messages(id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('generate', 'edit', 'variant')),
  status TEXT NOT NULL DEFAULT 'preparing'
    CHECK (status IN ('preparing', 'queued', 'generating', 'saving', 'completed', 'failed', 'cancelled')),
  prompt TEXT NOT NULL,
  effective_prompt TEXT,
  context_excerpt TEXT,
  parent_job_id UUID REFERENCES image_jobs(id) ON DELETE SET NULL,
  width INTEGER NOT NULL CHECK (width BETWEEN 16 AND 4096),
  height INTEGER NOT NULL CHECK (height BETWEEN 16 AND 4096),
  steps INTEGER NOT NULL DEFAULT 4 CHECK (steps BETWEEN 1 AND 50),
  seed BIGINT,
  comfy_prompt_id TEXT,
  worker_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 2 CHECK (max_attempts >= 1),
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  error_code TEXT,
  error_message TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS image_jobs_claim_idx
  ON image_jobs (status, available_at, created_at)
  WHERE status IN ('preparing', 'queued', 'generating', 'saving');

CREATE INDEX IF NOT EXISTS image_jobs_chat_idx
  ON image_jobs (chat_id, created_at DESC);

CREATE INDEX IF NOT EXISTS image_jobs_user_idx
  ON image_jobs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS image_jobs_messages_idx
  ON image_jobs (user_message_id, assistant_message_id);

CREATE INDEX IF NOT EXISTS image_jobs_worker_idx
  ON image_jobs (worker_id, status)
  WHERE worker_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS generated_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id BIGINT REFERENCES messages(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES image_jobs(id) ON DELETE CASCADE,
  attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  width INTEGER NOT NULL CHECK (width BETWEEN 16 AND 8192),
  height INTEGER NOT NULL CHECK (height BETWEEN 16 AND 8192),
  prompt TEXT NOT NULL,
  effective_prompt TEXT,
  seed BIGINT,
  parent_image_id UUID REFERENCES generated_images(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id),
  UNIQUE (attachment_id)
);

CREATE INDEX IF NOT EXISTS generated_images_chat_idx
  ON generated_images (chat_id, created_at DESC);

CREATE INDEX IF NOT EXISTS generated_images_message_idx
  ON generated_images (message_id, created_at DESC)
  WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS generated_images_user_idx
  ON generated_images (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS image_job_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES image_jobs(id) ON DELETE CASCADE,
  attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  role TEXT NOT NULL DEFAULT 'attachment' CHECK (role IN ('attachment', 'parent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, attachment_id),
  UNIQUE (job_id, sort_order)
);

CREATE INDEX IF NOT EXISTS image_job_references_job_idx
  ON image_job_references (job_id, sort_order);

-- Heartbeat del worker. La recuperación no reencola a ciegas: primero se mira
-- si el prompt_id sigue en /queue o ya está en /history.
CREATE TABLE IF NOT EXISTS image_workers (
  worker_id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL,
  pid INTEGER NOT NULL,
  concurrency INTEGER NOT NULL DEFAULT 1 CHECK (concurrency >= 1),
  status TEXT NOT NULL DEFAULT 'starting'
    CHECK (status IN ('starting', 'idle', 'busy', 'stopping', 'stopped', 'error')),
  current_job_id UUID REFERENCES image_jobs(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS image_workers_heartbeat_idx
  ON image_workers (heartbeat_at DESC);

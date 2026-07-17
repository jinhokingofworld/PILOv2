Exit code: 0
Wall time: 0.8 seconds
Output:
CREATE TABLE public.document_embedding_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  document_id UUID NOT NULL,
  snapshot_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'superseded')),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 seconds',
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  error_code TEXT,
  error_message TEXT,
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT document_embedding_jobs_document_workspace_fk
    FOREIGN KEY (document_id, workspace_id)
    REFERENCES public.documents (id, workspace_id),
  CONSTRAINT document_embedding_jobs_snapshot_document_workspace_fk
    FOREIGN KEY (snapshot_id, document_id, workspace_id)
    REFERENCES public.document_snapshots (id, document_id, workspace_id),
  CONSTRAINT document_embedding_jobs_document_snapshot_unique
    UNIQUE (document_id, snapshot_id)
);

CREATE INDEX idx_document_embedding_jobs_claim
  ON public.document_embedding_jobs (available_at, created_at)
  WHERE status = 'queued';

CREATE TABLE public.document_embedding_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  job_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'publishing', 'delivered', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claim_token UUID,
  claimed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT document_embedding_outbox_job_fk
    FOREIGN KEY (job_id)
    REFERENCES public.document_embedding_jobs (id)
    ON DELETE CASCADE,
  CONSTRAINT document_embedding_outbox_job_unique
    UNIQUE (job_id)
);

CREATE INDEX idx_document_embedding_outbox_publish
  ON public.document_embedding_outbox (next_attempt_at, created_at)
  WHERE status = 'pending';

CREATE TABLE public.document_embedding_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  document_id UUID NOT NULL,
  snapshot_id UUID NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  heading_path TEXT NOT NULL DEFAULT '',
  chunk_text TEXT NOT NULL,
  source_text_hash TEXT NOT NULL,
  embedding extensions.vector(1536) NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_version INTEGER NOT NULL CHECK (embedding_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT document_embedding_chunks_snapshot_document_workspace_fk
    FOREIGN KEY (snapshot_id, document_id, workspace_id)
    REFERENCES public.document_snapshots (id, document_id, workspace_id),
  CONSTRAINT document_embedding_chunks_snapshot_index_unique
    UNIQUE (snapshot_id, chunk_index)
);

CREATE INDEX idx_document_embedding_chunks_workspace_document_snapshot
  ON public.document_embedding_chunks (workspace_id, document_id, snapshot_id);

CREATE INDEX idx_document_embedding_chunks_vector
  ON public.document_embedding_chunks
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX idx_document_embedding_chunks_fts
  ON public.document_embedding_chunks
  USING gin (to_tsvector('simple', chunk_text));

ALTER TABLE public.document_embedding_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_embedding_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_embedding_chunks ENABLE ROW LEVEL SECURITY;



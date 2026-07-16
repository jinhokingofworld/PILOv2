BEGIN;

-- Activity evidence is a bounded MeetingReport snapshot.  These tables never
-- copy activity_logs.metadata or the source-domain object; only the existing
-- action/summary/occurred_at projection is embedded and searched.
CREATE TABLE public.meeting_report_activity_evidence_embedding_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_report_id UUID NOT NULL
    REFERENCES public.meeting_reports(id) ON DELETE CASCADE,
  evidence_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT meeting_report_activity_evidence_embedding_jobs_unique_hash
    UNIQUE (meeting_report_id, evidence_hash),
  CONSTRAINT meeting_report_activity_evidence_embedding_jobs_hash_check
    CHECK (
      evidence_hash = btrim(evidence_hash)
      AND octet_length(evidence_hash) BETWEEN 64 AND 128
    ),
  CONSTRAINT meeting_report_activity_evidence_embedding_jobs_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'superseded')),
  CONSTRAINT meeting_report_activity_evidence_embedding_jobs_attempt_count_check
    CHECK (attempt_count >= 0),
  CONSTRAINT meeting_report_activity_evidence_embedding_jobs_error_message_check
    CHECK (error_message IS NULL OR octet_length(error_message) <= 4096),
  CONSTRAINT meeting_report_activity_evidence_embedding_jobs_completed_at_order_check
    CHECK (completed_at IS NULL OR completed_at >= created_at)
);

CREATE INDEX idx_meeting_report_activity_evidence_embedding_jobs_pending
  ON public.meeting_report_activity_evidence_embedding_jobs (status, created_at)
  WHERE status IN ('pending', 'processing');

CREATE TABLE public.meeting_report_activity_evidence_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_report_id UUID NOT NULL,
  activity_evidence_id UUID NOT NULL,
  source_index INTEGER NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  action activity_log_action NOT NULL,
  summary TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  embedding extensions.vector(1536),
  embedding_model TEXT,
  embedding_version TEXT,
  indexed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT meeting_report_activity_evidence_chunks_report_evidence_unique
    UNIQUE (meeting_report_id, activity_evidence_id),
  CONSTRAINT meeting_report_activity_evidence_chunks_source_index_unique
    UNIQUE (meeting_report_id, source_index),
  CONSTRAINT meeting_report_activity_evidence_chunks_source_index_check
    CHECK (source_index >= 0),
  CONSTRAINT meeting_report_activity_evidence_chunks_summary_check
    CHECK (octet_length(summary) BETWEEN 1 AND 500),
  CONSTRAINT meeting_report_activity_evidence_chunks_content_check
    CHECK (octet_length(content) BETWEEN 1 AND 1200),
  CONSTRAINT meeting_report_activity_evidence_chunks_hash_check
    CHECK (
      content_hash = btrim(content_hash)
      AND octet_length(content_hash) BETWEEN 64 AND 128
    ),
  CONSTRAINT meeting_report_activity_evidence_chunks_evidence_hash_check
    CHECK (
      evidence_hash = btrim(evidence_hash)
      AND octet_length(evidence_hash) BETWEEN 64 AND 128
    ),
  CONSTRAINT meeting_report_activity_evidence_chunks_embedding_metadata_check
    CHECK (
      (embedding IS NULL AND embedding_model IS NULL AND embedding_version IS NULL)
      OR (
        embedding IS NOT NULL
        AND embedding_model = btrim(embedding_model)
        AND embedding_version = btrim(embedding_version)
        AND octet_length(embedding_model) BETWEEN 1 AND 160
        AND octet_length(embedding_version) BETWEEN 1 AND 160
      )
    ),
  CONSTRAINT meeting_report_activity_evidence_chunks_evidence_fk
    FOREIGN KEY (meeting_report_id, activity_evidence_id)
    REFERENCES public.meeting_report_activity_evidence (meeting_report_id, id)
    ON DELETE CASCADE
);

CREATE INDEX idx_meeting_report_activity_evidence_chunks_report
  ON public.meeting_report_activity_evidence_chunks (meeting_report_id, source_index);

CREATE INDEX idx_meeting_report_activity_evidence_chunks_embedding_hnsw
  ON public.meeting_report_activity_evidence_chunks
  USING hnsw (embedding extensions.vector_cosine_ops)
  WHERE embedding IS NOT NULL;

CREATE TRIGGER trg_meeting_report_activity_evidence_embedding_jobs_updated_at
BEFORE UPDATE ON public.meeting_report_activity_evidence_embedding_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_meeting_report_activity_evidence_chunks_updated_at
BEFORE UPDATE ON public.meeting_report_activity_evidence_chunks
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.meeting_report_activity_evidence_embedding_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_report_activity_evidence_chunks ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.meeting_report_activity_evidence_embedding_jobs IS
  'Durable internal jobs that index only bounded MeetingReport Activity evidence snapshots.';

COMMENT ON TABLE public.meeting_report_activity_evidence_chunks IS
  'Safe action/summary Activity evidence chunks and OpenAI text-embedding-3-small (1536 dimensions). Raw activity_logs.metadata and source-domain objects are never copied here.';

COMMIT;

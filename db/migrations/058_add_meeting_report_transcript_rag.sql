BEGIN;

-- Transcript segments are chunked and indexed separately for bounded,
-- workspace-authorized RAG retrieval.
CREATE TABLE public.meeting_report_transcript_embedding_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_report_id UUID NOT NULL
    REFERENCES public.meeting_reports(id) ON DELETE CASCADE,
  transcript_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT meeting_report_transcript_embedding_jobs_unique_hash
    UNIQUE (meeting_report_id, transcript_hash),
  CONSTRAINT meeting_report_transcript_embedding_jobs_hash_check
    CHECK (
      transcript_hash = btrim(transcript_hash)
      AND octet_length(transcript_hash) BETWEEN 64 AND 128
    ),
  CONSTRAINT meeting_report_transcript_embedding_jobs_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'superseded')),
  CONSTRAINT meeting_report_transcript_embedding_jobs_attempt_count_check
    CHECK (attempt_count >= 0),
  CONSTRAINT meeting_report_transcript_embedding_jobs_error_message_check
    CHECK (error_message IS NULL OR octet_length(error_message) <= 4096),
  CONSTRAINT meeting_report_transcript_embedding_jobs_completed_at_order_check
    CHECK (completed_at IS NULL OR completed_at >= created_at)
);

CREATE INDEX idx_meeting_report_transcript_embedding_jobs_pending
  ON public.meeting_report_transcript_embedding_jobs (status, created_at)
  WHERE status IN ('pending', 'processing');

CREATE TABLE public.meeting_report_transcript_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_report_id UUID NOT NULL
    REFERENCES public.meeting_reports(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  start_segment_index INTEGER NOT NULL,
  end_segment_index INTEGER NOT NULL,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  transcript_hash TEXT NOT NULL,
  embedding extensions.vector(384),
  embedding_model TEXT,
  embedding_version TEXT,
  indexed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT meeting_report_transcript_chunks_report_index_unique
    UNIQUE (meeting_report_id, chunk_index),
  CONSTRAINT meeting_report_transcript_chunks_index_check
    CHECK (chunk_index >= 0),
  CONSTRAINT meeting_report_transcript_chunks_segment_range_check
    CHECK (start_segment_index >= 0 AND end_segment_index >= start_segment_index),
  CONSTRAINT meeting_report_transcript_chunks_time_range_check
    CHECK (started_at_ms >= 0 AND ended_at_ms > started_at_ms),
  CONSTRAINT meeting_report_transcript_chunks_content_check
    CHECK (octet_length(content) BETWEEN 1 AND 16000),
  CONSTRAINT meeting_report_transcript_chunks_hash_check
    CHECK (
      content_hash = btrim(content_hash)
      AND octet_length(content_hash) BETWEEN 64 AND 128
    ),
  CONSTRAINT meeting_report_transcript_chunks_transcript_hash_check
    CHECK (
      transcript_hash = btrim(transcript_hash)
      AND octet_length(transcript_hash) BETWEEN 64 AND 128
    ),
  CONSTRAINT meeting_report_transcript_chunks_embedding_metadata_check
    CHECK (
      (embedding IS NULL AND embedding_model IS NULL AND embedding_version IS NULL)
      OR (
        embedding IS NOT NULL
        AND embedding_model = btrim(embedding_model)
        AND embedding_version = btrim(embedding_version)
        AND octet_length(embedding_model) BETWEEN 1 AND 160
        AND octet_length(embedding_version) BETWEEN 1 AND 160
      )
    )
);

CREATE INDEX idx_meeting_report_transcript_chunks_report
  ON public.meeting_report_transcript_chunks (meeting_report_id, chunk_index);

CREATE INDEX idx_meeting_report_transcript_chunks_embedding_hnsw
  ON public.meeting_report_transcript_chunks
  USING hnsw (embedding extensions.vector_cosine_ops)
  WHERE embedding IS NOT NULL;

CREATE TRIGGER trg_meeting_report_transcript_embedding_jobs_updated_at
BEFORE UPDATE ON public.meeting_report_transcript_embedding_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_meeting_report_transcript_chunks_updated_at
BEFORE UPDATE ON public.meeting_report_transcript_chunks
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.meeting_report_transcript_embedding_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_report_transcript_chunks ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.meeting_report_transcript_embedding_jobs IS
  'Durable internal indexing jobs for MeetingReport transcript segment RAG. Public clients must not access this table.';

COMMENT ON TABLE public.meeting_report_transcript_chunks IS
  'Bounded transcript segment chunks and pgvector embeddings. Retrieval must join MeetingReport and Meeting to enforce Workspace access and match transcript_hash to the current transcript segments.';

COMMIT;

-- Durable PR Review analysis jobs. The job row is also the outbox intent:
-- publisher delivery state lives with the one-to-one analysis job rather than
-- in a second table.

BEGIN;

ALTER TABLE public.pr_review_sessions
  ADD COLUMN analysis_error_code TEXT,
  ADD COLUMN analysis_error_message TEXT;

-- The legacy synchronous flow creates sessions as `reviewing`. Any older
-- `analyzing` row has no durable job to recover, so never leave it waiting.
UPDATE public.pr_review_sessions
SET status = 'failed',
    analysis_error_code = 'ANALYSIS_ENQUEUE_FAILED',
    analysis_error_message = '분석 작업을 시작하지 못했습니다. 새 분석을 시작해주세요.'
WHERE status = 'analyzing';

ALTER TABLE public.pr_review_sessions
  ADD CONSTRAINT pr_review_sessions_analysis_error_code_check
    CHECK (
      analysis_error_code IS NULL
      OR analysis_error_code IN (
        'ANALYSIS_ENQUEUE_FAILED',
        'ANALYSIS_PROVIDER_FAILED',
        'ANALYSIS_INPUT_INVALID',
        'PR_HEAD_CHANGED'
      )
    ),
  ADD CONSTRAINT pr_review_sessions_analysis_error_message_check
    CHECK (
      analysis_error_message IS NULL
      OR octet_length(analysis_error_message) BETWEEN 1 AND 500
    ),
  ADD CONSTRAINT pr_review_sessions_analysis_error_state_check
    CHECK (
      (analysis_error_code IS NULL AND analysis_error_message IS NULL)
      OR (
        status = 'failed'
        AND analysis_error_code IS NOT NULL
        AND analysis_error_message IS NOT NULL
      )
    );

CREATE UNIQUE INDEX idx_pr_review_sessions_active_creator_pull_request
  ON public.pr_review_sessions(pull_request_id, created_by_user_id)
  WHERE status = 'analyzing'
    AND created_by_user_id IS NOT NULL;

CREATE TABLE public.pr_review_analysis_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  review_session_id UUID NOT NULL
    REFERENCES public.pr_review_sessions(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,
  head_sha TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending',

  publish_attempt_count INTEGER NOT NULL DEFAULT 0,
  next_publish_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  publish_claim_token UUID,
  publish_claimed_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,

  error_code TEXT,
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pr_review_analysis_jobs_session_unique
    UNIQUE (review_session_id),

  CONSTRAINT pr_review_analysis_jobs_head_sha_check
    CHECK (
      head_sha = btrim(head_sha)
      AND octet_length(head_sha) BETWEEN 1 AND 255
    ),

  CONSTRAINT pr_review_analysis_jobs_status_check
    CHECK (status IN ('pending', 'publishing', 'queued', 'processing', 'succeeded', 'failed')),

  CONSTRAINT pr_review_analysis_jobs_publish_attempt_count_check
    CHECK (publish_attempt_count >= 0),

  CONSTRAINT pr_review_analysis_jobs_error_code_check
    CHECK (error_code IS NULL OR octet_length(error_code) BETWEEN 1 AND 80),

  CONSTRAINT pr_review_analysis_jobs_error_message_check
    CHECK (error_message IS NULL OR octet_length(error_message) <= 1000),

  CONSTRAINT pr_review_analysis_jobs_error_pair_check
    CHECK (
      (error_code IS NULL AND error_message IS NULL)
      OR (error_code IS NOT NULL AND error_message IS NOT NULL)
    ),

  CONSTRAINT pr_review_analysis_jobs_publish_state_check
    CHECK (
      (status = 'pending'
        AND publish_claim_token IS NULL
        AND publish_claimed_at IS NULL
        AND published_at IS NULL)
      OR (status = 'publishing'
        AND publish_claim_token IS NOT NULL
        AND publish_claimed_at IS NOT NULL
        AND published_at IS NULL)
      OR (status IN ('queued', 'processing', 'succeeded')
        AND publish_claim_token IS NULL
        AND publish_claimed_at IS NULL
        AND published_at IS NOT NULL)
      OR (status = 'failed'
        AND publish_claim_token IS NULL
        AND publish_claimed_at IS NULL)
    ),

  CONSTRAINT pr_review_analysis_jobs_published_at_order_check
    CHECK (published_at IS NULL OR published_at >= created_at),

  CONSTRAINT pr_review_analysis_jobs_publish_claimed_at_order_check
    CHECK (publish_claimed_at IS NULL OR publish_claimed_at >= created_at)
);

CREATE INDEX idx_pr_review_analysis_jobs_pending_publish
  ON public.pr_review_analysis_jobs(next_publish_attempt_at)
  WHERE status = 'pending';

CREATE INDEX idx_pr_review_analysis_jobs_publishing_claim
  ON public.pr_review_analysis_jobs(publish_claimed_at)
  WHERE status = 'publishing';

CREATE TRIGGER trg_pr_review_analysis_jobs_updated_at
BEFORE UPDATE ON public.pr_review_analysis_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.pr_review_analysis_jobs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.pr_review_analysis_jobs IS
  'PR Review asynchronous analysis jobs and durable SQS publish intents. At-least-once publisher delivery is made safe by the stable job id.';

COMMIT;

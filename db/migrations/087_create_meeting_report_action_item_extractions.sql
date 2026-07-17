BEGIN;

CREATE TABLE public.meeting_report_action_item_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_report_id UUID NOT NULL UNIQUE
    REFERENCES public.meeting_reports(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claim_token UUID,
  claimed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failure_code TEXT,
  failure_detail JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT meeting_report_action_item_extractions_status_check
    CHECK (status IN ('pending', 'publishing', 'queued', 'processing', 'completed', 'failed')),
  CONSTRAINT meeting_report_action_item_extractions_attempt_count_check
    CHECK (attempt_count >= 0),
  CONSTRAINT meeting_report_action_item_extractions_failure_code_check
    CHECK (failure_code IS NULL OR octet_length(failure_code) BETWEEN 1 AND 80),
  CONSTRAINT meeting_report_action_item_extractions_failure_detail_check
    CHECK (
      failure_detail IS NULL
      OR (
        jsonb_typeof(failure_detail) = 'object'
        AND failure_detail ? 'category'
        AND failure_detail ? 'retryable'
        AND (failure_detail - 'category' - 'retryable' - 'providerStatusCode') = '{}'::jsonb
        AND jsonb_typeof(failure_detail->'category') = 'string'
        AND jsonb_typeof(failure_detail->'retryable') = 'boolean'
        AND (
          NOT failure_detail ? 'providerStatusCode'
          OR failure_detail->'providerStatusCode' = 'null'::jsonb
          OR jsonb_typeof(failure_detail->'providerStatusCode') = 'number'
        )
      )
    ),
  CONSTRAINT meeting_report_action_item_extractions_state_check
    CHECK (
      (status = 'pending' AND claim_token IS NULL AND claimed_at IS NULL AND delivered_at IS NULL AND completed_at IS NULL)
      OR (status = 'publishing' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL AND delivered_at IS NULL AND completed_at IS NULL)
      OR (status = 'queued' AND claim_token IS NULL AND claimed_at IS NULL AND delivered_at IS NOT NULL AND completed_at IS NULL)
      OR (status = 'processing' AND claim_token IS NULL AND claimed_at IS NULL AND delivered_at IS NOT NULL AND completed_at IS NULL)
      OR (status = 'completed' AND claim_token IS NULL AND claimed_at IS NULL AND delivered_at IS NOT NULL AND completed_at IS NOT NULL)
      OR (status = 'failed' AND claim_token IS NULL AND claimed_at IS NULL AND completed_at IS NOT NULL)
    )
);

CREATE INDEX idx_meeting_report_action_item_extractions_pending_attempt
  ON public.meeting_report_action_item_extractions (next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX idx_meeting_report_action_item_extractions_publishing_claimed
  ON public.meeting_report_action_item_extractions (claimed_at)
  WHERE status = 'publishing';

CREATE TRIGGER trg_meeting_report_action_item_extractions_updated_at
BEFORE UPDATE ON public.meeting_report_action_item_extractions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.meeting_report_action_item_extractions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.meeting_report_action_item_extractions IS
  'Durable post-report action item extraction job. Its failure never changes MeetingReport completion.';

COMMIT;

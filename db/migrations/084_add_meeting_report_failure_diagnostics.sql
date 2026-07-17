BEGIN;

ALTER TABLE public.meeting_reports
  ADD COLUMN failure_code TEXT,
  ADD COLUMN failure_detail JSONB;

ALTER TABLE public.meeting_reports
  ADD CONSTRAINT meeting_reports_failure_diagnostic_state_check
  CHECK (
    (status = 'FAILED' AND (
      (failure_code IS NULL AND failure_detail IS NULL)
      OR (failure_code IS NOT NULL AND failure_detail IS NOT NULL)
    ))
    OR (status <> 'FAILED' AND failure_code IS NULL AND failure_detail IS NULL)
  ),
  ADD CONSTRAINT meeting_reports_failure_code_check
  CHECK (
    failure_code IS NULL
    OR failure_code IN (
      'MISSING_ACTION_ITEM_EVIDENCE',
      'INVALID_TRANSCRIPT_SEGMENT_INDEX',
      'INVALID_ACTIVITY_EVIDENCE_INDEX',
      'INVALID_EVIDENCE_SOURCE_INDEX',
      'INVALID_EVIDENCE_FORMAT',
      'INVALID_JSON',
      'EMPTY_OUTPUT',
      'OPENAI_API_ERROR',
      'INVALID_OUTPUT'
    )
  ),
  ADD CONSTRAINT meeting_reports_failure_detail_check
  CHECK (
    failure_detail IS NULL
    OR (
      jsonb_typeof(failure_detail) = 'object'
      AND failure_detail ?& ARRAY['category', 'retryable', 'providerStatusCode']
      AND failure_detail - ARRAY['category', 'retryable', 'providerStatusCode'] = '{}'::jsonb
      AND jsonb_typeof(failure_detail -> 'category') = 'string'
      AND octet_length(failure_detail ->> 'category') BETWEEN 1 AND 80
      AND jsonb_typeof(failure_detail -> 'retryable') = 'boolean'
      AND jsonb_typeof(failure_detail -> 'providerStatusCode') IN ('number', 'null')
    )
  );

COMMENT ON COLUMN public.meeting_reports.failure_code IS
  'Allow-listed internal MeetingReport failure code. Never returned by public API responses.';

COMMENT ON COLUMN public.meeting_reports.failure_detail IS
  'Safe diagnostic object with category, retryable and providerStatusCode only. Never stores provider payloads, LLM output, transcript, prompts, tokens or stack traces.';

COMMIT;

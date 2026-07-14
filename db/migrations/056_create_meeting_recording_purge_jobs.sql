BEGIN;

ALTER TABLE public.meeting_recordings
  ADD COLUMN audio_deleted_at TIMESTAMPTZ;

ALTER TABLE public.meeting_recordings
  DROP CONSTRAINT chk_recordings_completed_fields;

ALTER TABLE public.meeting_recordings
  ADD CONSTRAINT chk_recordings_completed_fields
  CHECK (
    status <> 'COMPLETED'
    OR (
      duration_sec IS NOT NULL
      AND (audio_file_key IS NOT NULL OR audio_deleted_at IS NOT NULL)
    )
  );

ALTER TABLE public.meeting_recordings
  ADD CONSTRAINT chk_recordings_audio_delete_state
  CHECK (
    audio_deleted_at IS NULL
    OR (audio_file_key IS NULL AND audio_file_url IS NULL)
  );

CREATE TABLE public.meeting_recording_purge_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL
    REFERENCES public.meetings(id) ON DELETE CASCADE,
  recording_id UUID NOT NULL UNIQUE
    REFERENCES public.meeting_recordings(id) ON DELETE CASCADE,
  audio_file_key TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  claim_token UUID,
  claimed_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,

  error_code TEXT,
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT meeting_recording_purge_jobs_audio_file_key_check
    CHECK (
      audio_file_key = btrim(audio_file_key)
      AND octet_length(audio_file_key) BETWEEN 1 AND 1000
    ),
  CONSTRAINT meeting_recording_purge_jobs_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CONSTRAINT meeting_recording_purge_jobs_attempt_count_check
    CHECK (attempt_count >= 0),
  CONSTRAINT meeting_recording_purge_jobs_error_code_check
    CHECK (error_code IS NULL OR octet_length(error_code) BETWEEN 1 AND 80),
  CONSTRAINT meeting_recording_purge_jobs_error_message_check
    CHECK (error_message IS NULL OR octet_length(error_message) <= 1000),
  CONSTRAINT meeting_recording_purge_jobs_processing_state_check
    CHECK (
      (status = 'pending' AND claim_token IS NULL AND claimed_at IS NULL AND deleted_at IS NULL)
      OR (status = 'processing' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL AND deleted_at IS NULL)
      OR (status = 'completed' AND claim_token IS NULL AND claimed_at IS NULL AND deleted_at IS NOT NULL)
      OR (status = 'failed' AND claim_token IS NULL AND claimed_at IS NULL AND deleted_at IS NULL)
    )
);

CREATE INDEX idx_meeting_recording_purge_jobs_pending_attempt
  ON public.meeting_recording_purge_jobs(next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX idx_meeting_recording_purge_jobs_processing_claimed_at
  ON public.meeting_recording_purge_jobs(claimed_at)
  WHERE status = 'processing';

CREATE INDEX idx_meeting_recording_purge_jobs_workspace_created_at
  ON public.meeting_recording_purge_jobs(workspace_id, created_at DESC);

CREATE TRIGGER trg_meeting_recording_purge_jobs_updated_at
BEFORE UPDATE ON public.meeting_recording_purge_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.meeting_recording_purge_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.meeting_recording_purge_jobs
  FROM anon, authenticated, service_role;

COMMENT ON TABLE public.meeting_recording_purge_jobs IS
  'Durable at-least-once audio purge audit. Only completed Meeting recording S3 objects are removed after the Meeting ended_at retention window; MeetingReport data is retained.';

COMMIT;

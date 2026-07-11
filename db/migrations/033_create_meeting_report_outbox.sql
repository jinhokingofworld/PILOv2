BEGIN;

CREATE TABLE public.meeting_report_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  report_id UUID NOT NULL UNIQUE,
  meeting_id UUID NOT NULL,
  recording_id UUID NOT NULL,
  audio_file_key TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  claim_token UUID,
  claimed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,

  error_code TEXT,
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT meeting_report_outbox_report_fk
    FOREIGN KEY (report_id)
    REFERENCES public.meeting_reports(id)
    ON DELETE CASCADE,

  CONSTRAINT meeting_report_outbox_meeting_fk
    FOREIGN KEY (meeting_id)
    REFERENCES public.meetings(id)
    ON DELETE CASCADE,

  CONSTRAINT meeting_report_outbox_recording_fk
    FOREIGN KEY (recording_id)
    REFERENCES public.meeting_recordings(id)
    ON DELETE CASCADE,

  CONSTRAINT meeting_report_outbox_audio_file_key_check
    CHECK (
      audio_file_key = btrim(audio_file_key)
      AND octet_length(audio_file_key) BETWEEN 1 AND 1000
    ),

  CONSTRAINT meeting_report_outbox_status_check
    CHECK (status IN ('pending', 'publishing', 'delivered', 'failed')),

  CONSTRAINT meeting_report_outbox_attempt_count_check
    CHECK (attempt_count >= 0),

  CONSTRAINT meeting_report_outbox_error_code_check
    CHECK (error_code IS NULL OR octet_length(error_code) BETWEEN 1 AND 80),

  CONSTRAINT meeting_report_outbox_error_message_check
    CHECK (error_message IS NULL OR octet_length(error_message) <= 1000),

  CONSTRAINT meeting_report_outbox_delivery_state_check
    CHECK (
      (status = 'pending' AND claim_token IS NULL AND claimed_at IS NULL AND delivered_at IS NULL)
      OR (status = 'publishing' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL AND delivered_at IS NULL)
      OR (status = 'delivered' AND claim_token IS NULL AND claimed_at IS NULL AND delivered_at IS NOT NULL)
      OR (status = 'failed' AND claim_token IS NULL AND claimed_at IS NULL)
    )
);

CREATE INDEX idx_meeting_report_outbox_pending_attempt
  ON public.meeting_report_outbox(next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX idx_meeting_report_outbox_publishing_claimed_at
  ON public.meeting_report_outbox(claimed_at)
  WHERE status = 'publishing';

CREATE TRIGGER trg_meeting_report_outbox_updated_at
BEFORE UPDATE ON public.meeting_report_outbox
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.meeting_report_outbox ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.meeting_report_outbox IS
  'Durable MeetingReport SQS delivery intents. Publisher delivery is at-least-once; MeetingReport processing is idempotent by report id.';

COMMIT;

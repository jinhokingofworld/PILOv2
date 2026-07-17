-- Connects safe Canvas Activity Log rows to the Meeting recording that was
-- running when the Realtime server received the change.

BEGIN;

CREATE TABLE public.meeting_recording_activity_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id UUID NOT NULL
    REFERENCES public.meeting_recordings(id) ON DELETE CASCADE,
  activity_log_id UUID NOT NULL
    REFERENCES public.activity_logs(id) ON DELETE CASCADE,
  capture_id TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  receive_seq BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT meeting_recording_activity_links_capture_id_check
    CHECK (length(btrim(capture_id)) BETWEEN 1 AND 512),
  CONSTRAINT meeting_recording_activity_links_receive_seq_check
    CHECK (receive_seq > 0),
  CONSTRAINT meeting_recording_activity_links_recording_activity_unique
    UNIQUE (recording_id, activity_log_id),
  CONSTRAINT meeting_recording_activity_links_capture_unique
    UNIQUE (capture_id)
);

CREATE INDEX idx_meeting_recording_activity_links_recording_order
  ON public.meeting_recording_activity_links(recording_id, captured_at ASC, receive_seq ASC, id ASC);

CREATE INDEX idx_meeting_recording_activity_links_activity
  ON public.meeting_recording_activity_links(activity_log_id);

ALTER TABLE public.meeting_recording_activity_links ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.meeting_recording_activity_links IS
  'Server-only links between safe Activity Logs and the recording selected by Realtime capture. Recording identity is not copied into Activity Log metadata.';

COMMENT ON COLUMN public.meeting_recording_activity_links.captured_at IS
  'Realtime server receive timestamp, not a client-provided timestamp.';

COMMENT ON COLUMN public.meeting_recording_activity_links.receive_seq IS
  'Monotonic Realtime receive order used to preserve capture order during async delivery.';

COMMIT;

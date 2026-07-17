BEGIN;

ALTER TABLE public.meeting_reports
  ADD COLUMN title TEXT,
  ADD COLUMN user_title TEXT,
  ADD COLUMN user_discussion_points TEXT,
  ADD COLUMN content_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN content_edited_by_user_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN content_edited_at TIMESTAMPTZ;

ALTER TABLE public.meeting_reports
  ADD CONSTRAINT meeting_reports_title_check
    CHECK (
      title IS NULL
      OR (title = btrim(title) AND octet_length(title) BETWEEN 1 AND 500)
    ),
  ADD CONSTRAINT meeting_reports_user_title_check
    CHECK (
      user_title IS NULL
      OR (user_title = btrim(user_title) AND octet_length(user_title) BETWEEN 1 AND 500)
    ),
  ADD CONSTRAINT meeting_reports_user_discussion_points_check
    CHECK (
      user_discussion_points IS NULL
      OR (
        user_discussion_points = btrim(user_discussion_points)
        AND octet_length(user_discussion_points) BETWEEN 1 AND 16000
      )
    ),
  ADD CONSTRAINT meeting_reports_content_version_check
    CHECK (content_version >= 1);

ALTER TABLE public.meeting_report_decision_items
  ADD COLUMN user_text TEXT,
  ADD COLUMN edited_by_user_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN edited_at TIMESTAMPTZ,
  ADD CONSTRAINT meeting_report_decision_items_user_text_check
    CHECK (
      user_text IS NULL
      OR (user_text = btrim(user_text) AND octet_length(user_text) BETWEEN 1 AND 5000)
    );

CREATE INDEX idx_meeting_reports_content_edited_by
  ON public.meeting_reports(content_edited_by_user_id)
  WHERE content_edited_by_user_id IS NOT NULL;

ALTER TABLE public.meeting_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_report_decision_items ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.meeting_reports.title IS
  'AI-generated MeetingReport title. User overrides are stored separately.';
COMMENT ON COLUMN public.meeting_reports.user_title IS
  'User-edited MeetingReport title that takes precedence over the AI title.';
COMMENT ON COLUMN public.meeting_reports.user_discussion_points IS
  'User-edited discussion text that takes precedence over the AI discussion text.';
COMMENT ON COLUMN public.meeting_reports.content_version IS
  'Optimistic concurrency version for user-editable MeetingReport content.';
COMMENT ON COLUMN public.meeting_report_decision_items.user_text IS
  'User-edited decision text that takes precedence while retaining source_index evidence links.';

COMMIT;

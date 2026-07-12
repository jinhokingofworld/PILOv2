BEGIN;

-- Server-side MeetingReport keyword search and keyset pagination.
CREATE INDEX idx_meeting_reports_created_cursor
  ON public.meeting_reports (created_at DESC, id ASC);

CREATE INDEX idx_meeting_reports_search_document
  ON public.meeting_reports
  USING gin (
    to_tsvector(
      'simple',
      concat_ws(
        ' ',
        COALESCE(summary, ''),
        COALESCE(discussion_points, ''),
        COALESCE(decisions, ''),
        COALESCE(action_item_candidates::text, ''),
        COALESCE(error_message, '')
      )
    )
  );

COMMIT;

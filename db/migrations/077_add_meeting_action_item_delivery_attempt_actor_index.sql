BEGIN;

CREATE INDEX IF NOT EXISTS idx_meeting_report_action_item_deliveries_last_attempted_by_user
  ON public.meeting_report_action_item_deliveries(last_attempted_by_user_id)
  WHERE last_attempted_by_user_id IS NOT NULL;

COMMIT;

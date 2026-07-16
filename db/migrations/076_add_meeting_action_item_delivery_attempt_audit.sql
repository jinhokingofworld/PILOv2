BEGIN;

ALTER TABLE public.meeting_report_action_item_deliveries
  ADD COLUMN last_attempted_by_user_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN last_attempted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.meeting_report_action_item_deliveries.last_attempted_by_user_id IS
  'Workspace member that most recently claimed this delivery attempt. The original requester remains requested_by_user_id.';

COMMENT ON COLUMN public.meeting_report_action_item_deliveries.last_attempted_at IS
  'When the most recent delivery attempt was claimed.';

COMMIT;

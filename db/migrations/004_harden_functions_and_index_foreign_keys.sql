-- Harden public functions by pinning search_path and add covering indexes for
-- foreign keys reported by Supabase advisors.

BEGIN;

ALTER FUNCTION public.update_updated_at_column()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.enforce_meeting_report_policy()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.refresh_pilo_issues_from_github(BIGINT)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.hydrate_pilo_board_from_github(UUID, UUID)
  SET search_path = public, pg_temp;

CREATE INDEX IF NOT EXISTS idx_project_item_field_values_field_id
  ON public.github_project_v2_item_field_values(field_id);

CREATE INDEX IF NOT EXISTS idx_project_v2_items_status_field_id
  ON public.github_project_v2_items(status_field_id);

CREATE INDEX IF NOT EXISTS idx_project_v2_items_status_option_id
  ON public.github_project_v2_items(status_option_id);

CREATE INDEX IF NOT EXISTS idx_github_sync_runs_installation_id
  ON public.github_sync_runs(installation_id);

CREATE INDEX IF NOT EXISTS idx_github_sync_runs_repository_id
  ON public.github_sync_runs(repository_id);

CREATE INDEX IF NOT EXISTS idx_meeting_reports_recording_meeting_id
  ON public.meeting_reports(recording_id, meeting_id);

CREATE INDEX IF NOT EXISTS idx_meetings_created_by_id
  ON public.meetings(created_by_id);

CREATE INDEX IF NOT EXISTS idx_meetings_ended_by_id
  ON public.meetings(ended_by_id);

CREATE INDEX IF NOT EXISTS idx_pilo_issues_column_board_id
  ON public.pilo_issues(column_id, board_id);

CREATE INDEX IF NOT EXISTS idx_review_files_reviewed_by_user_id
  ON public.review_files(reviewed_by_user_id);

COMMIT;

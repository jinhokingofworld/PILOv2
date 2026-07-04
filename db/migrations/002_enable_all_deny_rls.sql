-- Enable baseline Row Level Security on all public application tables.
--
-- No policies are created in this migration. In PostgreSQL/Supabase, enabling RLS
-- without policies makes anon/authenticated API access deny-by-default while
-- server-side privileged access can continue to use the database.

BEGIN;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.github_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_pull_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_projects_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_project_v2_repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_project_v2_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_project_v2_field_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_project_v2_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_project_v2_item_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_webhook_deliveries ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.pr_review_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_flow_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_review_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_submissions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_reports ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilo_issues ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.canvas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_freeform_shapes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_user_states ENABLE ROW LEVEL SECURITY;

COMMIT;

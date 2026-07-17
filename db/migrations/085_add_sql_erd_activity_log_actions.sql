ALTER TYPE public.activity_log_action
  ADD VALUE IF NOT EXISTS 'sql_erd_session_created';

ALTER TYPE public.activity_log_action
  ADD VALUE IF NOT EXISTS 'sql_erd_schema_updated';

ALTER TYPE public.activity_log_action
  ADD VALUE IF NOT EXISTS 'sql_erd_session_renamed';

ALTER TYPE public.activity_log_action
  ADD VALUE IF NOT EXISTS 'sql_erd_session_deleted';

ALTER TYPE public.activity_log_action
  ADD VALUE IF NOT EXISTS 'sql_erd_note_created';

ALTER TYPE public.activity_log_action
  ADD VALUE IF NOT EXISTS 'sql_erd_note_updated';

ALTER TYPE public.activity_log_action
  ADD VALUE IF NOT EXISTS 'sql_erd_note_deleted';

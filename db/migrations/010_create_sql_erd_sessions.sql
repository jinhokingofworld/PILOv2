-- Create Workspace sqltoerd session storage.
-- Stores the MVP SQL DDL source, parsed ERD model, layout state, and autosave
-- revision for one active sqltoerd session per Workspace.

CREATE TABLE public.sql_erd_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,

  title TEXT NOT NULL DEFAULT 'Untitled ERD',

  source_format TEXT NOT NULL DEFAULT 'sql',
  dialect TEXT NOT NULL DEFAULT 'auto',
  source_text TEXT NOT NULL DEFAULT '',

  model_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  layout_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,

  table_count INTEGER NOT NULL DEFAULT 0,
  relation_count INTEGER NOT NULL DEFAULT 0,

  revision INTEGER NOT NULL DEFAULT 1,

  created_by UUID
    REFERENCES public.users(id) ON DELETE SET NULL,

  updated_by UUID
    REFERENCES public.users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,

  CONSTRAINT sql_erd_sessions_source_format_check
    CHECK (source_format IN ('sql')),

  CONSTRAINT sql_erd_sessions_dialect_check
    CHECK (dialect IN ('auto', 'postgresql', 'mysql')),

  CONSTRAINT sql_erd_sessions_title_length_check
    CHECK (char_length(title) BETWEEN 1 AND 120),

  CONSTRAINT sql_erd_sessions_source_text_size_check
    CHECK (octet_length(source_text) <= 1048576),

  CONSTRAINT sql_erd_sessions_model_json_object_check
    CHECK (jsonb_typeof(model_json) = 'object'),

  CONSTRAINT sql_erd_sessions_layout_json_object_check
    CHECK (jsonb_typeof(layout_json) = 'object'),

  CONSTRAINT sql_erd_sessions_settings_json_object_check
    CHECK (jsonb_typeof(settings_json) = 'object'),

  CONSTRAINT sql_erd_sessions_model_json_size_check
    CHECK (octet_length(model_json::text) <= 1048576),

  CONSTRAINT sql_erd_sessions_layout_json_size_check
    CHECK (octet_length(layout_json::text) <= 1048576),

  CONSTRAINT sql_erd_sessions_settings_json_size_check
    CHECK (octet_length(settings_json::text) <= 65536),

  CONSTRAINT sql_erd_sessions_counts_check
    CHECK (
      table_count BETWEEN 0 AND 100
      AND relation_count BETWEEN 0 AND 300
    ),

  CONSTRAINT sql_erd_sessions_revision_positive_check
    CHECK (revision > 0),

  CONSTRAINT sql_erd_sessions_deleted_at_order_check
    CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

CREATE UNIQUE INDEX ux_sql_erd_sessions_workspace_active
  ON public.sql_erd_sessions(workspace_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_sql_erd_sessions_workspace_id
  ON public.sql_erd_sessions(workspace_id);

CREATE INDEX idx_sql_erd_sessions_created_by
  ON public.sql_erd_sessions(created_by);

CREATE INDEX idx_sql_erd_sessions_updated_by
  ON public.sql_erd_sessions(updated_by);

CREATE INDEX idx_sql_erd_sessions_workspace_updated_at
  ON public.sql_erd_sessions(workspace_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_sql_erd_sessions_updated_at
BEFORE UPDATE ON public.sql_erd_sessions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.sql_erd_sessions ENABLE ROW LEVEL SECURITY;

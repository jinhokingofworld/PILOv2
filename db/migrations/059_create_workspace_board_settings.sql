BEGIN;

CREATE TABLE public.workspace_board_settings (
  workspace_id UUID PRIMARY KEY
    REFERENCES public.workspaces(id) ON DELETE CASCADE,
  active_board_id BIGINT NOT NULL,
  updated_by_user_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.boards
  ADD CONSTRAINT boards_workspace_id_id_key UNIQUE (workspace_id, id);

ALTER TABLE public.workspace_board_settings
  ADD CONSTRAINT workspace_board_settings_active_board_workspace_fkey
  FOREIGN KEY (workspace_id, active_board_id)
  REFERENCES public.boards(workspace_id, id)
  ON DELETE RESTRICT;

CREATE INDEX idx_workspace_board_settings_active_board_id
  ON public.workspace_board_settings(active_board_id);

CREATE TRIGGER trg_workspace_board_settings_updated_at
BEFORE UPDATE ON public.workspace_board_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.workspace_board_settings ENABLE ROW LEVEL SECURITY;

COMMIT;

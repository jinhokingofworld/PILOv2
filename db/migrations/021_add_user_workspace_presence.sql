ALTER TABLE public.users
  ADD COLUMN active_workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  ADD COLUMN last_seen_at TIMESTAMPTZ;

CREATE INDEX idx_users_active_workspace_last_seen
  ON public.users (active_workspace_id, last_seen_at DESC);

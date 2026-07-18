-- Persist short-lived Agent conversation threads across independently created runs.
-- The App Server alone selects a thread; clients cannot provide a thread identifier.

BEGIN;

CREATE TABLE public.agent_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  requested_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_threads_expires_after_creation_check
    CHECK (expires_at > created_at)
);

CREATE INDEX idx_agent_threads_requester_last_activity
  ON public.agent_threads(workspace_id, requested_by_user_id, last_activity_at DESC);

CREATE INDEX idx_agent_threads_requested_by_user_id
  ON public.agent_threads(requested_by_user_id);

CREATE INDEX idx_agent_threads_expires_at
  ON public.agent_threads(expires_at);

CREATE TRIGGER trg_agent_threads_updated_at
BEFORE UPDATE ON public.agent_threads
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.agent_threads ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.agent_runs
  ADD COLUMN thread_id UUID REFERENCES public.agent_threads(id) ON DELETE SET NULL;

CREATE INDEX idx_agent_runs_thread_created_at
  ON public.agent_runs(thread_id, created_at DESC)
  WHERE thread_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.touch_agent_thread_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.thread_id IS NOT NULL THEN
    UPDATE public.agent_threads
    SET last_activity_at = now()
    WHERE id = NEW.thread_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_agent_thread_activity() FROM PUBLIC;

CREATE TRIGGER trg_agent_runs_touch_thread_activity
AFTER INSERT OR UPDATE ON public.agent_runs
FOR EACH ROW
EXECUTE FUNCTION public.touch_agent_thread_activity();

COMMENT ON TABLE public.agent_threads IS
  'Server-owned short-lived Agent conversation thread, scoped to one Workspace and requesting user.';

COMMENT ON COLUMN public.agent_runs.thread_id IS
  'Server-selected Agent thread. A client never supplies or selects this value.';

COMMIT;

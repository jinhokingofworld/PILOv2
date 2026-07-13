-- Replace the user-scoped PR Review session model with one shared room per PR.
-- Existing PR Review rows are test-only data and are intentionally reset.

BEGIN;

DELETE FROM public.pr_review_sessions;

ALTER TABLE public.github_pull_requests
  ADD CONSTRAINT uq_github_pull_requests_workspace_id_id
    UNIQUE (workspace_id, id);

ALTER TABLE public.canvas
  ADD CONSTRAINT uq_canvas_workspace_id_id
    UNIQUE (workspace_id, id);

CREATE TABLE public.pr_review_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,
  pull_request_id UUID NOT NULL,
  canvas_id UUID NOT NULL,
  current_session_id UUID,

  status TEXT NOT NULL DEFAULT 'active',
  completion_reason TEXT,
  created_by_user_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pr_review_rooms_workspace_pull_request_unique
    UNIQUE (workspace_id, pull_request_id),
  CONSTRAINT pr_review_rooms_canvas_unique
    UNIQUE (canvas_id),
  CONSTRAINT pr_review_rooms_workspace_pull_request_fkey
    FOREIGN KEY (workspace_id, pull_request_id)
    REFERENCES public.github_pull_requests(workspace_id, id)
    ON DELETE CASCADE,
  CONSTRAINT pr_review_rooms_workspace_canvas_fkey
    FOREIGN KEY (workspace_id, canvas_id)
    REFERENCES public.canvas(workspace_id, id)
    ON DELETE CASCADE,
  CONSTRAINT pr_review_rooms_status_check
    CHECK (status IN ('active', 'completed')),
  CONSTRAINT pr_review_rooms_completion_reason_check
    CHECK (completion_reason IS NULL OR completion_reason IN ('merged', 'closed')),
  CONSTRAINT pr_review_rooms_completion_state_check
    CHECK (
      (status = 'active' AND completion_reason IS NULL AND completed_at IS NULL)
      OR
      (status = 'completed' AND completion_reason IS NOT NULL AND completed_at IS NOT NULL)
    )
);

CREATE INDEX idx_pr_review_rooms_workspace_status_updated_at
  ON public.pr_review_rooms(workspace_id, status, updated_at DESC);

CREATE INDEX idx_pr_review_rooms_pull_request_id
  ON public.pr_review_rooms(pull_request_id);

CREATE INDEX idx_pr_review_rooms_created_by_user_id
  ON public.pr_review_rooms(created_by_user_id);

CREATE INDEX idx_pr_review_rooms_current_session_id
  ON public.pr_review_rooms(current_session_id)
  WHERE current_session_id IS NOT NULL;

CREATE TRIGGER trg_pr_review_rooms_updated_at
BEFORE UPDATE ON public.pr_review_rooms
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.pr_review_rooms ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.validate_pr_review_room_canvas()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.canvas AS review_canvas
    WHERE review_canvas.id = NEW.canvas_id
      AND review_canvas.workspace_id = NEW.workspace_id
      AND review_canvas.board_type = 'review'
  ) THEN
    RAISE EXCEPTION 'PR Review room canvas must be a review canvas in the same workspace';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pr_review_rooms_validate_canvas
BEFORE INSERT OR UPDATE OF workspace_id, canvas_id
ON public.pr_review_rooms
FOR EACH ROW
EXECUTE FUNCTION public.validate_pr_review_room_canvas();

DROP INDEX IF EXISTS public.idx_pr_review_sessions_active_creator_pull_request;

ALTER TABLE public.pr_review_sessions
  ADD COLUMN room_id UUID NOT NULL
    REFERENCES public.pr_review_rooms(id) ON DELETE CASCADE,
  ADD CONSTRAINT uq_pr_review_sessions_room_id_id
    UNIQUE (room_id, id);

CREATE UNIQUE INDEX idx_pr_review_sessions_room_head_active
  ON public.pr_review_sessions(room_id, head_sha)
  WHERE status <> 'failed';

CREATE UNIQUE INDEX idx_pr_review_sessions_room_analyzing
  ON public.pr_review_sessions(room_id)
  WHERE status = 'analyzing';

CREATE INDEX idx_pr_review_sessions_room_created_at
  ON public.pr_review_sessions(room_id, created_at DESC);

ALTER TABLE public.pr_review_rooms
  ADD CONSTRAINT pr_review_rooms_current_session_fkey
    FOREIGN KEY (id, current_session_id)
    REFERENCES public.pr_review_sessions(room_id, id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.pr_review_room_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  room_id UUID NOT NULL
    REFERENCES public.pr_review_rooms(id) ON DELETE CASCADE,
  current_file_path TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pr_review_room_files_room_path_unique
    UNIQUE (room_id, current_file_path),
  CONSTRAINT uq_pr_review_room_files_room_id_id
    UNIQUE (room_id, id),
  CONSTRAINT pr_review_room_files_path_check
    CHECK (
      current_file_path = btrim(current_file_path)
      AND octet_length(current_file_path) BETWEEN 1 AND 4096
    )
);

CREATE INDEX idx_pr_review_room_files_room_updated_at
  ON public.pr_review_room_files(room_id, updated_at DESC);

CREATE TRIGGER trg_pr_review_room_files_updated_at
BEFORE UPDATE ON public.pr_review_room_files
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.pr_review_room_files ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.review_files
  ADD COLUMN room_id UUID NOT NULL,
  ADD COLUMN room_file_id UUID NOT NULL,
  ADD COLUMN head_blob_sha TEXT,
  ADD COLUMN carried_from_decision_id UUID
    REFERENCES public.file_review_decisions(id) ON DELETE SET NULL,
  ADD CONSTRAINT review_files_room_session_fkey
    FOREIGN KEY (room_id, session_id)
    REFERENCES public.pr_review_sessions(room_id, id)
    ON DELETE CASCADE,
  ADD CONSTRAINT review_files_room_file_fkey
    FOREIGN KEY (room_id, room_file_id)
    REFERENCES public.pr_review_room_files(room_id, id)
    ON DELETE CASCADE,
  ADD CONSTRAINT review_files_session_room_file_unique
    UNIQUE (session_id, room_file_id),
  ADD CONSTRAINT review_files_head_blob_sha_check
    CHECK (
      head_blob_sha IS NULL
      OR (
        head_blob_sha = btrim(head_blob_sha)
        AND octet_length(head_blob_sha) BETWEEN 1 AND 255
      )
    );

CREATE INDEX idx_review_files_room_file_id
  ON public.review_files(room_file_id);

CREATE INDEX idx_review_files_room_id
  ON public.review_files(room_id);

CREATE INDEX idx_review_files_carried_from_decision_id
  ON public.review_files(carried_from_decision_id);

COMMENT ON TABLE public.pr_review_rooms IS
  'One shared PR Review workspace and review canvas per workspace pull request.';

COMMENT ON COLUMN public.pr_review_rooms.current_session_id IS
  'Last successfully persisted review revision. An analyzing revision does not replace it.';

COMMENT ON TABLE public.pr_review_room_files IS
  'Stable file identities shared by all head-SHA review revisions in one room.';

COMMENT ON COLUMN public.pr_review_sessions.room_id IS
  'Shared PR Review room that owns this immutable head-SHA review revision.';

COMMENT ON COLUMN public.review_files.carried_from_decision_id IS
  'Decision provenance when an unchanged file carries a previous revision decision.';

COMMIT;

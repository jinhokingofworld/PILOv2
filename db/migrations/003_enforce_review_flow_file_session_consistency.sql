-- Enforce that review_flow_files can only connect flows and files from the
-- same PR review session.
--
-- 001_initial_schema.sql already exists on shared databases, so this migration
-- backfills the new session_id column before adding same-session foreign keys.

BEGIN;

ALTER TABLE public.review_flow_files
  ADD COLUMN session_id UUID;

UPDATE public.review_flow_files rff
SET session_id = rf.session_id
FROM public.review_flows rf
WHERE rff.flow_id = rf.id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.review_flow_files rff
    JOIN public.review_flows rf
      ON rf.id = rff.flow_id
    JOIN public.review_files rfile
      ON rfile.id = rff.review_file_id
    WHERE rf.session_id <> rfile.session_id
  ) THEN
    RAISE EXCEPTION
      'review_flow_files contains rows whose flow_id and review_file_id belong to different review sessions';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.review_flow_files
    WHERE session_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'review_flow_files.session_id backfill failed for one or more rows';
  END IF;
END;
$$;

ALTER TABLE public.review_flow_files
  ALTER COLUMN session_id SET NOT NULL;

ALTER TABLE public.review_flows
  ADD CONSTRAINT uq_review_flows_session_id_id
  UNIQUE (session_id, id);

ALTER TABLE public.review_files
  ADD CONSTRAINT uq_review_files_session_id_id
  UNIQUE (session_id, id);

ALTER TABLE public.review_flow_files
  ADD CONSTRAINT fk_review_flow_files_session
  FOREIGN KEY (session_id)
  REFERENCES public.pr_review_sessions(id)
  ON DELETE CASCADE;

ALTER TABLE public.review_flow_files
  ADD CONSTRAINT fk_review_flow_files_flow_same_session
  FOREIGN KEY (session_id, flow_id)
  REFERENCES public.review_flows(session_id, id)
  ON DELETE CASCADE;

ALTER TABLE public.review_flow_files
  ADD CONSTRAINT fk_review_flow_files_file_same_session
  FOREIGN KEY (session_id, review_file_id)
  REFERENCES public.review_files(session_id, id)
  ON DELETE CASCADE;

CREATE INDEX idx_review_flow_files_session_id
  ON public.review_flow_files(session_id);

CREATE INDEX idx_review_flow_files_session_flow_id
  ON public.review_flow_files(session_id, flow_id);

CREATE INDEX idx_review_flow_files_session_review_file_id
  ON public.review_flow_files(session_id, review_file_id);

COMMIT;

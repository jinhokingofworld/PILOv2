BEGIN;

CREATE TABLE public.pr_review_conflict_drafts (
  review_file_id UUID PRIMARY KEY
    REFERENCES public.review_files(id) ON DELETE CASCADE,

  source_head_blob_sha TEXT NOT NULL,
  resolved_content TEXT NOT NULL,
  draft_version INTEGER NOT NULL DEFAULT 1,

  updated_by_user_id UUID NOT NULL
    REFERENCES public.users(id) ON DELETE RESTRICT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pr_review_conflict_drafts_source_head_blob_sha_check
    CHECK (char_length(source_head_blob_sha) BETWEEN 1 AND 255),
  CONSTRAINT pr_review_conflict_drafts_resolved_content_size_check
    CHECK (char_length(resolved_content) BETWEEN 1 AND 204800),
  CONSTRAINT pr_review_conflict_drafts_draft_version_positive_check
    CHECK (draft_version > 0)
);

CREATE INDEX idx_pr_review_conflict_drafts_updated_by_user_id
  ON public.pr_review_conflict_drafts(updated_by_user_id);

CREATE TRIGGER trg_pr_review_conflict_drafts_updated_at
BEFORE UPDATE ON public.pr_review_conflict_drafts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.pr_review_conflict_drafts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.pr_review_conflict_drafts IS
  'Durable shared Conflict resolution drafts. Content may intentionally contain unresolved Git Conflict markers until GitHub apply.';

COMMIT;

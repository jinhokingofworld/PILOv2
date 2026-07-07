ALTER TABLE public.review_files
  ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20) NOT NULL DEFAULT 'unknown';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'review_files_risk_level_check'
      AND conrelid = 'public.review_files'::regclass
  ) THEN
    ALTER TABLE public.review_files
      ADD CONSTRAINT review_files_risk_level_check
      CHECK (risk_level IN ('high', 'medium', 'low', 'unknown'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_review_files_risk_level
  ON public.review_files(session_id, risk_level);

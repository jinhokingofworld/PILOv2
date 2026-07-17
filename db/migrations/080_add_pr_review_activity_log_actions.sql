ALTER TYPE public.activity_log_action
  ADD VALUE IF NOT EXISTS 'pr_review_conflict_resolution_applied';

ALTER TYPE public.activity_log_action
  ADD VALUE IF NOT EXISTS 'pr_review_pull_request_merged';

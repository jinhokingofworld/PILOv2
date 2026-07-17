BEGIN;

ALTER TABLE public.board_issue_create_operations
  DROP CONSTRAINT chk_board_issue_create_operations_success;

ALTER TABLE public.board_issue_create_operations
  ADD CONSTRAINT chk_board_issue_create_operations_success
  CHECK (
    status <> 'succeeded'
    OR (
      completed_stage = 'cache_persisted'
      AND response_body IS NOT NULL
      AND jsonb_typeof(response_body) = 'object'
      AND completed_at IS NOT NULL
    )
  );

COMMIT;

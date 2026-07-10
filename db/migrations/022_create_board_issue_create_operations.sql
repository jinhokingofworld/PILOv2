CREATE TABLE public.board_issue_create_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,

  actor_user_id UUID NOT NULL
    REFERENCES public.users(id) ON DELETE CASCADE,

  board_id BIGINT NOT NULL,
  column_id BIGINT NOT NULL,

  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  request_title VARCHAR(255) NOT NULL,
  request_body TEXT,

  status TEXT NOT NULL DEFAULT 'processing',
  completed_stage TEXT NOT NULL DEFAULT 'none',

  lease_token UUID NOT NULL DEFAULT gen_random_uuid(),
  locked_until TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '5 minutes'),

  github_issue_id BIGINT,
  github_issue_node_id TEXT,
  github_issue_snapshot JSONB,
  github_project_item_node_id TEXT,

  pilo_issue_id BIGINT
    REFERENCES public.pilo_issues(id) ON DELETE SET NULL,

  response_body JSONB,
  last_error_code TEXT,
  last_error_message TEXT,

  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_board_issue_create_operations_scope
    UNIQUE (workspace_id, actor_user_id, idempotency_key),

  CONSTRAINT fk_board_issue_create_operations_column_board
    FOREIGN KEY (column_id, board_id)
    REFERENCES public.board_columns(id, board_id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  CONSTRAINT chk_board_issue_create_operations_idempotency_key
    CHECK (
      idempotency_key = btrim(idempotency_key)
      AND octet_length(idempotency_key) BETWEEN 1 AND 128
    ),

  CONSTRAINT chk_board_issue_create_operations_request_hash
    CHECK (request_hash ~ '^[0-9a-f]{64}$'),

  CONSTRAINT chk_board_issue_create_operations_status
    CHECK (status IN ('processing', 'retryable', 'succeeded')),

  CONSTRAINT chk_board_issue_create_operations_completed_stage
    CHECK (
      completed_stage IN (
        'none',
        'github_issue_created',
        'project_item_added',
        'status_updated',
        'cache_persisted'
      )
    ),

  CONSTRAINT chk_board_issue_create_operations_issue_checkpoint
    CHECK (
      completed_stage = 'none'
      OR (
        github_issue_id IS NOT NULL
        AND github_issue_node_id IS NOT NULL
        AND github_issue_snapshot IS NOT NULL
        AND jsonb_typeof(github_issue_snapshot) = 'object'
      )
    ),

  CONSTRAINT chk_board_issue_create_operations_item_checkpoint
    CHECK (
      completed_stage IN ('none', 'github_issue_created')
      OR github_project_item_node_id IS NOT NULL
    ),

  CONSTRAINT chk_board_issue_create_operations_success
    CHECK (
      status <> 'succeeded'
      OR (
        completed_stage = 'cache_persisted'
        AND pilo_issue_id IS NOT NULL
        AND response_body IS NOT NULL
        AND jsonb_typeof(response_body) = 'object'
        AND completed_at IS NOT NULL
      )
    )
);

CREATE INDEX idx_board_issue_create_operations_status
  ON public.board_issue_create_operations(status, updated_at);

CREATE INDEX idx_board_issue_create_operations_github_issue_node_id
  ON public.board_issue_create_operations(github_issue_node_id)
  WHERE github_issue_node_id IS NOT NULL;

CREATE INDEX idx_board_issue_create_operations_project_item_node_id
  ON public.board_issue_create_operations(github_project_item_node_id)
  WHERE github_project_item_node_id IS NOT NULL;

CREATE TRIGGER trg_board_issue_create_operations_updated_at
BEFORE UPDATE ON public.board_issue_create_operations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.board_issue_create_operations ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.board_issue_create_operations IS
  'Durable Board Issue creation checkpoints for idempotent retry and partial-success recovery.';

COMMENT ON COLUMN public.board_issue_create_operations.idempotency_key IS
  'Client-generated key scoped to one Workspace and actor.';

COMMENT ON COLUMN public.board_issue_create_operations.completed_stage IS
  'Last fully persisted remote or local step that a retry can safely resume after.';

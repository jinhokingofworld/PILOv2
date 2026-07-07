-- Canvas realtime collaboration operation log.
-- Adds a canvas-local operation sequence, durable shape operation history, and
-- user-state activity timestamp for presence/session bookkeeping.

BEGIN;

ALTER TABLE public.canvas
  ADD COLUMN latest_op_seq BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT canvas_latest_op_seq_non_negative_check
    CHECK (latest_op_seq >= 0);

CREATE TABLE public.canvas_shape_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,

  canvas_id UUID NOT NULL
    REFERENCES public.canvas(id) ON DELETE CASCADE,

  shape_id TEXT NOT NULL,

  actor_user_id UUID NOT NULL
    REFERENCES public.users(id) ON DELETE RESTRICT,

  operation_type TEXT NOT NULL,
  op_seq BIGINT NOT NULL,
  client_operation_id TEXT NOT NULL,

  base_revision BIGINT,
  result_revision BIGINT NOT NULL,
  content_hash TEXT NOT NULL,
  payload JSONB NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT canvas_shape_operations_type_check
    CHECK (operation_type IN ('create', 'update', 'delete')),

  CONSTRAINT canvas_shape_operations_op_seq_positive_check
    CHECK (op_seq > 0),

  CONSTRAINT canvas_shape_operations_client_operation_id_check
    CHECK (length(trim(client_operation_id)) > 0),

  CONSTRAINT canvas_shape_operations_base_revision_positive_check
    CHECK (base_revision IS NULL OR base_revision > 0),

  CONSTRAINT canvas_shape_operations_result_revision_positive_check
    CHECK (result_revision > 0),

  CONSTRAINT canvas_shape_operations_content_hash_check
    CHECK (length(content_hash) > 0),

  CONSTRAINT unique_canvas_shape_operation_seq
    UNIQUE (canvas_id, op_seq),

  CONSTRAINT unique_canvas_shape_operation_client_retry
    UNIQUE (canvas_id, actor_user_id, client_operation_id)
);

CREATE INDEX idx_canvas_shape_operations_canvas_created_at
  ON public.canvas_shape_operations(canvas_id, created_at);

CREATE INDEX idx_canvas_shape_operations_shape_id
  ON public.canvas_shape_operations(shape_id);

CREATE INDEX idx_canvas_shape_operations_actor_user_id
  ON public.canvas_shape_operations(actor_user_id);

CREATE INDEX idx_canvas_shape_operations_workspace_canvas
  ON public.canvas_shape_operations(workspace_id, canvas_id);

ALTER TABLE public.canvas_user_states
  ADD COLUMN last_seen_at TIMESTAMPTZ;

ALTER TABLE public.canvas_shape_operations ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.canvas.latest_op_seq IS
  'Last committed canvas_shape_operations.op_seq for this canvas. Writers lock the canvas row and increment this value in the same transaction as shape writes.';

COMMENT ON TABLE public.canvas_shape_operations IS
  'Durable Canvas shape operation log used for Socket.IO reconnect catch-up and operation ordering. Socket events are delivery only; this table is the ordering source of truth.';

COMMENT ON COLUMN public.canvas_shape_operations.shape_id IS
  'Client-generated shape id. Not a foreign key so operation history can outlive shape cleanup.';

COMMENT ON COLUMN public.canvas_shape_operations.client_operation_id IS
  'Operation idempotency key. Realtime clients should provide a stable value; the app server generates one when legacy clients omit it.';

COMMENT ON COLUMN public.canvas_shape_operations.payload IS
  'MVP snapshot payload. create/update store the latest rawShape snapshot; delete stores deletion metadata.';

COMMENT ON COLUMN public.canvas_user_states.last_seen_at IS
  'Last activity timestamp for Canvas presence/session bookkeeping. Cursor and selection are realtime-only and are not stored here.';

COMMIT;

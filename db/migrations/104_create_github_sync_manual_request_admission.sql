ALTER TABLE public.github_sync_runs
  ADD CONSTRAINT github_sync_runs_id_workspace_unique
    UNIQUE (id, workspace_id);

CREATE TABLE public.github_sync_manual_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,

  requested_by_user_id UUID NOT NULL
    REFERENCES public.users(id) ON DELETE CASCADE,

  idempotency_key_hash TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,

  sync_run_id UUID NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT github_sync_manual_requests_idempotency_key_hash_check
    CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'),

  CONSTRAINT github_sync_manual_requests_request_fingerprint_check
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),

  CONSTRAINT github_sync_manual_requests_workspace_requester_key_unique
    UNIQUE (workspace_id, requested_by_user_id, idempotency_key_hash),

  CONSTRAINT github_sync_manual_requests_sync_run_workspace_fkey
    FOREIGN KEY (sync_run_id, workspace_id)
    REFERENCES public.github_sync_runs (id, workspace_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_github_sync_manual_requests_workspace_requester_created_at
  ON public.github_sync_manual_requests (
    workspace_id,
    requested_by_user_id,
    created_at DESC
  );

CREATE INDEX idx_github_sync_manual_requests_workspace_created_at
  ON public.github_sync_manual_requests (workspace_id, created_at DESC);

CREATE INDEX idx_github_sync_manual_requests_sync_run_id
  ON public.github_sync_manual_requests (sync_run_id);

ALTER TABLE public.github_sync_manual_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.github_sync_manual_requests FROM PUBLIC;

REVOKE ALL ON TABLE public.github_sync_manual_requests
  FROM anon, authenticated, service_role;

COMMENT ON TABLE public.github_sync_manual_requests IS
  'Durable manual GitHub sync idempotency ledger scoped to one Workspace and requester.';

COMMENT ON COLUMN public.github_sync_manual_requests.idempotency_key_hash IS
  'Lowercase SHA-256 hash of the client idempotency key; the raw key is never stored.';

COMMENT ON COLUMN public.github_sync_manual_requests.request_fingerprint IS
  'Lowercase SHA-256 hash of the canonical manual sync scope used to reject key reuse with different payloads.';

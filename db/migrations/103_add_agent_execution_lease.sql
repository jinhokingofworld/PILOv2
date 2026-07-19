ALTER TABLE public.agent_runs
  ADD COLUMN execution_lease_token UUID,
  ADD COLUMN execution_lease_generation INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN execution_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN execution_heartbeat_at TIMESTAMPTZ,
  ADD CONSTRAINT agent_runs_execution_lease_generation_check
    CHECK (execution_lease_generation >= 0),
  ADD CONSTRAINT agent_runs_execution_lease_state_check
    CHECK (
      (
        execution_lease_token IS NULL
        AND execution_lease_expires_at IS NULL
        AND execution_heartbeat_at IS NULL
      )
      OR (
        execution_lease_token IS NOT NULL
        AND execution_lease_expires_at IS NOT NULL
        AND execution_heartbeat_at IS NOT NULL
        AND execution_lease_expires_at >= execution_heartbeat_at
      )
    );

CREATE INDEX idx_agent_runs_execution_lease_expiry
  ON public.agent_runs(execution_lease_expires_at)
  WHERE status = 'running' AND execution_lease_token IS NOT NULL;

COMMENT ON COLUMN public.agent_runs.execution_lease_token IS
  'Opaque fencing token owned by the App Server process currently executing a domain tool.';

COMMENT ON COLUMN public.agent_runs.execution_lease_generation IS
  'Monotonic execution claim generation. Late completions must match both generation and token.';

COMMENT ON COLUMN public.agent_runs.execution_lease_expires_at IS
  'Deadline after which stale execution recovery may fence and terminalize the current tool claim.';

COMMENT ON COLUMN public.agent_runs.execution_heartbeat_at IS
  'Last successful heartbeat from the App Server process executing the claimed domain tool.';

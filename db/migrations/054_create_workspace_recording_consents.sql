BEGIN;

CREATE TABLE public.workspace_recording_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL
    REFERENCES public.users(id) ON DELETE CASCADE,
  policy_version VARCHAR(32) NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT workspace_recording_consents_policy_version_check
    CHECK (length(btrim(policy_version)) BETWEEN 1 AND 32)
);

CREATE UNIQUE INDEX unique_workspace_recording_consent_policy
  ON public.workspace_recording_consents(workspace_id, user_id, policy_version);

CREATE INDEX idx_workspace_recording_consents_workspace_user
  ON public.workspace_recording_consents(workspace_id, user_id, accepted_at DESC);

ALTER TABLE public.workspace_recording_consents ENABLE ROW LEVEL SECURITY;

COMMIT;

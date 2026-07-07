-- Add owner/member workspace access and hashed invitation tokens.

BEGIN;

CREATE TABLE public.workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,

  user_id UUID NOT NULL
    REFERENCES public.users(id) ON DELETE CASCADE,

  role TEXT NOT NULL,

  invited_by_user_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL,

  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT workspace_members_role_check
    CHECK (role IN ('owner', 'member')),

  CONSTRAINT workspace_members_workspace_user_unique
    UNIQUE (workspace_id, user_id)
);

CREATE INDEX idx_workspace_members_workspace_id
  ON public.workspace_members(workspace_id);

CREATE INDEX idx_workspace_members_user_id
  ON public.workspace_members(user_id);

CREATE INDEX idx_workspace_members_workspace_role
  ON public.workspace_members(workspace_id, role);

CREATE TRIGGER trg_workspace_members_updated_at
BEFORE UPDATE ON public.workspace_members
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.workspace_members (
  workspace_id,
  user_id,
  role,
  joined_at,
  created_at,
  updated_at
)
SELECT
  id,
  owner_user_id,
  'owner',
  created_at,
  created_at,
  updated_at
FROM public.workspaces
WHERE owner_user_id IS NOT NULL
ON CONFLICT (workspace_id, user_id) DO NOTHING;

CREATE TABLE public.workspace_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,

  email VARCHAR(320) NOT NULL,

  role TEXT NOT NULL DEFAULT 'member',
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',

  invited_by_user_id UUID NOT NULL
    REFERENCES public.users(id) ON DELETE RESTRICT,

  accepted_by_user_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL,

  revoked_by_user_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL,

  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT workspace_invitations_role_check
    CHECK (role = 'member'),

  CONSTRAINT workspace_invitations_status_check
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired'))
);

CREATE UNIQUE INDEX unique_workspace_invitation_token_hash
  ON public.workspace_invitations(token_hash);

CREATE UNIQUE INDEX unique_pending_workspace_invitation_email
  ON public.workspace_invitations(workspace_id, lower(email))
  WHERE status = 'pending';

CREATE INDEX idx_workspace_invitations_workspace_status
  ON public.workspace_invitations(workspace_id, status);

CREATE INDEX idx_workspace_invitations_expires_at
  ON public.workspace_invitations(expires_at);

CREATE INDEX idx_workspace_invitations_invited_by_user_id
  ON public.workspace_invitations(invited_by_user_id);

CREATE TRIGGER trg_workspace_invitations_updated_at
BEFORE UPDATE ON public.workspace_invitations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;

COMMIT;

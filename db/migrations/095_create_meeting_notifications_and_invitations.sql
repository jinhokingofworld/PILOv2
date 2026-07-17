BEGIN;

CREATE TABLE public.meeting_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL
    REFERENCES public.meetings(id) ON DELETE CASCADE,
  inviter_user_id UUID NOT NULL
    REFERENCES public.users(id) ON DELETE CASCADE,
  invitee_user_id UUID NOT NULL
    REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,

  CONSTRAINT meeting_invitations_status_check
    CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED')),
  CONSTRAINT meeting_invitations_distinct_users_check
    CHECK (inviter_user_id <> invitee_user_id),
  CONSTRAINT meeting_invitations_terminal_timestamp_check
    CHECK (
      (status = 'PENDING' AND responded_at IS NULL AND cancelled_at IS NULL)
      OR (status IN ('ACCEPTED', 'DECLINED') AND responded_at IS NOT NULL AND cancelled_at IS NULL)
      OR (status = 'CANCELLED' AND responded_at IS NULL AND cancelled_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX meeting_invitations_active_invitee_unique
  ON public.meeting_invitations(meeting_id, invitee_user_id)
  WHERE status = 'PENDING';

CREATE INDEX idx_meeting_invitations_invitee_pending
  ON public.meeting_invitations(invitee_user_id, created_at DESC)
  WHERE status = 'PENDING';

CREATE TABLE public.meeting_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id UUID NOT NULL
    REFERENCES public.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL
    REFERENCES public.meetings(id) ON DELETE CASCADE,
  report_id UUID
    REFERENCES public.meeting_reports(id) ON DELETE CASCADE,
  invitation_id UUID
    REFERENCES public.meeting_invitations(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  can_open_report BOOLEAN NOT NULL DEFAULT false,
  title TEXT,
  message TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  terminal_at TIMESTAMPTZ,

  CONSTRAINT meeting_notifications_type_check
    CHECK (type IN ('meeting_report_completed', 'meeting_invitation')),
  CONSTRAINT meeting_notifications_message_check
    CHECK (octet_length(message) BETWEEN 1 AND 280),
  CONSTRAINT meeting_notifications_title_check
    CHECK (title IS NULL OR octet_length(title) BETWEEN 1 AND 160),
  CONSTRAINT meeting_notifications_target_check
    CHECK (
      (type = 'meeting_report_completed' AND report_id IS NOT NULL AND invitation_id IS NULL)
      OR (type = 'meeting_invitation' AND report_id IS NULL AND invitation_id IS NOT NULL)
    ),
  CONSTRAINT meeting_notifications_report_access_check
    CHECK (
      type <> 'meeting_report_completed'
      OR can_open_report = (title IS NOT NULL)
    ),
  CONSTRAINT meeting_notifications_read_order_check
    CHECK (read_at IS NULL OR read_at >= created_at)
);

CREATE UNIQUE INDEX meeting_notifications_report_recipient_unique
  ON public.meeting_notifications(report_id, recipient_user_id)
  WHERE type = 'meeting_report_completed';

CREATE UNIQUE INDEX meeting_notifications_invitation_recipient_unique
  ON public.meeting_notifications(invitation_id, recipient_user_id)
  WHERE type = 'meeting_invitation';

CREATE INDEX idx_meeting_notifications_recipient_unread
  ON public.meeting_notifications(recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;

ALTER TABLE public.meeting_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_notifications ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.meeting_invitations IS
  'Durable in-app invitations to a currently running Meeting. Invitation does not grant Workspace or Meeting access.';

COMMENT ON TABLE public.meeting_notifications IS
  'Server-only durable personal Meeting notifications. Former Workspace members receive only a minimal report-completed projection.';

COMMIT;

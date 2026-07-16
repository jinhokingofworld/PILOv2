BEGIN;

CREATE TABLE public.workspace_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  sender_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  client_message_id TEXT NOT NULL,
  content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT workspace_chat_messages_id_workspace_unique UNIQUE (id, workspace_id),
  CONSTRAINT workspace_chat_messages_sender_client_unique
    UNIQUE (workspace_id, sender_user_id, client_message_id),
  CONSTRAINT workspace_chat_messages_client_id_check
    CHECK (char_length(client_message_id) BETWEEN 1 AND 128),
  CONSTRAINT workspace_chat_messages_shape_check CHECK (
    (deleted_at IS NULL AND content IS NOT NULL
      AND char_length(btrim(content)) BETWEEN 1 AND 4000)
    OR (deleted_at IS NOT NULL AND content IS NULL)
  ),
  CONSTRAINT workspace_chat_messages_deleted_order_check
    CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

CREATE INDEX idx_workspace_chat_messages_workspace_created
  ON public.workspace_chat_messages(workspace_id, created_at DESC, id DESC);

CREATE TRIGGER trg_workspace_chat_messages_updated_at
BEFORE UPDATE ON public.workspace_chat_messages
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.workspace_chat_reads (
  workspace_id UUID NOT NULL,
  user_id UUID NOT NULL,
  last_read_message_id UUID,
  last_read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id, user_id)
    REFERENCES public.workspace_members(workspace_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (last_read_message_id, workspace_id)
    REFERENCES public.workspace_chat_messages(id, workspace_id) ON DELETE CASCADE
);

CREATE TRIGGER trg_workspace_chat_reads_updated_at
BEFORE UPDATE ON public.workspace_chat_reads
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.workspace_chat_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  message_id UUID NOT NULL,
  mentioned_user_id UUID NOT NULL,
  display_text TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (message_id, workspace_id)
    REFERENCES public.workspace_chat_messages(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, mentioned_user_id)
    REFERENCES public.workspace_members(workspace_id, user_id) ON DELETE CASCADE,
  CONSTRAINT workspace_chat_mentions_message_user_unique
    UNIQUE (message_id, mentioned_user_id),
  CONSTRAINT workspace_chat_mentions_display_text_check
    CHECK (char_length(display_text) BETWEEN 2 AND 257),
  CONSTRAINT workspace_chat_mentions_read_order_check
    CHECK (read_at IS NULL OR read_at >= created_at)
);

CREATE INDEX idx_workspace_chat_mentions_user_unread
  ON public.workspace_chat_mentions(workspace_id, mentioned_user_id, created_at DESC)
  WHERE read_at IS NULL;

ALTER TABLE public.workspace_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_chat_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_chat_mentions ENABLE ROW LEVEL SECURITY;

COMMIT;

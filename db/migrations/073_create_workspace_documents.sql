-- Add native Workspace documents to the shared Drive tree.

ALTER TYPE public.activity_log_action ADD VALUE IF NOT EXISTS 'document_created';
ALTER TYPE public.activity_log_action ADD VALUE IF NOT EXISTS 'document_content_updated';
ALTER TYPE public.activity_log_action ADD VALUE IF NOT EXISTS 'document_renamed';
ALTER TYPE public.activity_log_action ADD VALUE IF NOT EXISTS 'document_moved';
ALTER TYPE public.activity_log_action ADD VALUE IF NOT EXISTS 'document_attachment_updated';
ALTER TYPE public.activity_log_action ADD VALUE IF NOT EXISTS 'document_deleted';

ALTER TABLE public.drive_items
  DROP CONSTRAINT drive_items_item_type_check,
  DROP CONSTRAINT drive_items_shape_check;

ALTER TABLE public.drive_items
  ADD CONSTRAINT drive_items_item_type_check
    CHECK (item_type IN ('folder', 'file', 'document')),
  ADD CONSTRAINT drive_items_shape_check
    CHECK (
      (
        item_type = 'folder'
        AND object_key IS NULL
        AND mime_type IS NULL
        AND size_bytes IS NULL
        AND upload_status IS NULL
      )
      OR
      (
        item_type = 'file'
        AND object_key IS NOT NULL
        AND mime_type IS NOT NULL
        AND size_bytes IS NOT NULL
        AND upload_status IN ('pending', 'ready', 'failed')
      )
      OR
      (
        item_type = 'document'
        AND object_key IS NULL
        AND mime_type IS NULL
        AND size_bytes IS NULL
        AND upload_status IS NULL
      )
    );

CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_item_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  current_version BIGINT NOT NULL DEFAULT 0,
  latest_snapshot_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,

  CONSTRAINT documents_drive_item_unique UNIQUE (drive_item_id),
  CONSTRAINT documents_id_workspace_unique UNIQUE (id, workspace_id),
  CONSTRAINT documents_drive_item_same_workspace_fk
    FOREIGN KEY (drive_item_id, workspace_id)
    REFERENCES public.drive_items (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT documents_current_version_check CHECK (current_version >= 0),
  CONSTRAINT documents_deleted_at_order_check
    CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

CREATE INDEX idx_documents_workspace_updated_at
  ON public.documents (workspace_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_documents_updated_at
BEFORE UPDATE ON public.documents
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.document_edit_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  actor_user_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL,
  first_update_sequence BIGINT,
  last_update_sequence BIGINT,
  base_version BIGINT NOT NULL,
  closed_version BIGINT,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT document_edit_sessions_document_workspace_fk
    FOREIGN KEY (document_id, workspace_id)
    REFERENCES public.documents (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT document_edit_sessions_id_document_workspace_unique
    UNIQUE (id, document_id, workspace_id),
  CONSTRAINT document_edit_sessions_base_version_check CHECK (base_version >= 0),
  CONSTRAINT document_edit_sessions_closed_version_check
    CHECK (closed_version IS NULL OR closed_version >= base_version),
  CONSTRAINT document_edit_sessions_sequence_order_check
    CHECK (
      first_update_sequence IS NULL
      OR last_update_sequence IS NULL
      OR last_update_sequence >= first_update_sequence
    ),
  CONSTRAINT document_edit_sessions_closed_at_check
    CHECK (
      (closed_at IS NULL AND closed_version IS NULL)
      OR (closed_at IS NOT NULL AND closed_version IS NOT NULL)
    )
);

CREATE INDEX idx_document_edit_sessions_document_open
  ON public.document_edit_sessions (document_id, created_at ASC)
  WHERE closed_at IS NULL;

CREATE TABLE public.document_yjs_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  update_sequence BIGINT NOT NULL,
  client_update_id TEXT NOT NULL,
  edit_session_id UUID,
  actor_user_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL,
  yjs_update BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT document_yjs_updates_document_workspace_fk
    FOREIGN KEY (document_id, workspace_id)
    REFERENCES public.documents (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT document_yjs_updates_session_same_document_fk
    FOREIGN KEY (edit_session_id, document_id, workspace_id)
    REFERENCES public.document_edit_sessions (id, document_id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT document_yjs_updates_sequence_check CHECK (update_sequence >= 1),
  CONSTRAINT document_yjs_updates_client_update_id_check
    CHECK (char_length(client_update_id) BETWEEN 1 AND 128),
  CONSTRAINT document_yjs_updates_update_not_empty_check
    CHECK (octet_length(yjs_update) > 0),
  CONSTRAINT document_yjs_updates_document_sequence_unique
    UNIQUE (document_id, update_sequence),
  CONSTRAINT document_yjs_updates_document_client_update_unique
    UNIQUE (document_id, client_update_id)
);

CREATE INDEX idx_document_yjs_updates_document_sequence
  ON public.document_yjs_updates (document_id, update_sequence ASC);

CREATE TABLE public.document_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  version BIGINT NOT NULL,
  yjs_state BYTEA NOT NULL,
  content_json JSONB NOT NULL,
  plain_text TEXT NOT NULL,
  source_update_sequence BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT document_snapshots_document_workspace_fk
    FOREIGN KEY (document_id, workspace_id)
    REFERENCES public.documents (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT document_snapshots_id_document_workspace_unique
    UNIQUE (id, document_id, workspace_id),
  CONSTRAINT document_snapshots_version_check CHECK (version >= 0),
  CONSTRAINT document_snapshots_source_sequence_check
    CHECK (source_update_sequence >= 0),
  CONSTRAINT document_snapshots_yjs_state_not_empty_check
    CHECK (octet_length(yjs_state) > 0),
  CONSTRAINT document_snapshots_content_json_object_check
    CHECK (jsonb_typeof(content_json) = 'object'),
  CONSTRAINT document_snapshots_document_version_unique
    UNIQUE (document_id, version)
);

CREATE INDEX idx_document_snapshots_document_version
  ON public.document_snapshots (document_id, version DESC);

ALTER TABLE public.documents
  ADD CONSTRAINT documents_latest_snapshot_same_document_fk
    FOREIGN KEY (latest_snapshot_id, id, workspace_id)
    REFERENCES public.document_snapshots (id, document_id, workspace_id);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_edit_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_yjs_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_snapshots ENABLE ROW LEVEL SECURITY;

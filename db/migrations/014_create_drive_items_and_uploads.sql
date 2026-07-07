-- Create Workspace shared drive metadata and upload tracking.
-- Files are stored in private S3 using server-issued presigned URLs.

CREATE TABLE public.drive_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,

  parent_id UUID,

  item_type TEXT NOT NULL,
  name TEXT NOT NULL,

  object_key TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  upload_status TEXT,

  created_by_user_id UUID NOT NULL
    REFERENCES public.users(id) ON DELETE RESTRICT,

  updated_by_user_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,

  CONSTRAINT drive_items_id_workspace_unique
    UNIQUE (id, workspace_id),

  CONSTRAINT drive_items_parent_same_workspace_fk
    FOREIGN KEY (parent_id, workspace_id)
    REFERENCES public.drive_items(id, workspace_id)
    ON DELETE CASCADE,

  CONSTRAINT drive_items_item_type_check
    CHECK (item_type IN ('folder', 'file')),

  CONSTRAINT drive_items_upload_status_check
    CHECK (
      upload_status IS NULL
      OR upload_status IN ('pending', 'ready', 'failed')
    ),

  CONSTRAINT drive_items_name_length_check
    CHECK (char_length(name) BETWEEN 1 AND 255),

  CONSTRAINT drive_items_name_trim_check
    CHECK (name = btrim(name)),

  CONSTRAINT drive_items_name_reserved_check
    CHECK (name NOT IN ('.', '..')),

  CONSTRAINT drive_items_name_no_path_separator_check
    CHECK (position('/' in name) = 0 AND position(chr(92) in name) = 0),

  CONSTRAINT drive_items_parent_not_self_check
    CHECK (parent_id IS NULL OR parent_id <> id),

  CONSTRAINT drive_items_file_size_check
    CHECK (size_bytes IS NULL OR size_bytes BETWEEN 0 AND 104857600),

  CONSTRAINT drive_items_mime_type_length_check
    CHECK (mime_type IS NULL OR char_length(mime_type) BETWEEN 1 AND 255),

  CONSTRAINT drive_items_shape_check
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
    ),

  CONSTRAINT drive_items_deleted_at_order_check
    CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

CREATE UNIQUE INDEX ux_drive_items_workspace_parent_name_active
  ON public.drive_items (
    workspace_id,
    COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  )
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX ux_drive_items_object_key
  ON public.drive_items(object_key)
  WHERE object_key IS NOT NULL;

CREATE INDEX idx_drive_items_workspace_parent
  ON public.drive_items(workspace_id, parent_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_drive_items_workspace_updated_at
  ON public.drive_items(workspace_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_drive_items_created_by_user_id
  ON public.drive_items(created_by_user_id);

CREATE INDEX idx_drive_items_updated_by_user_id
  ON public.drive_items(updated_by_user_id);

CREATE INDEX idx_drive_items_pending_uploads
  ON public.drive_items(workspace_id, created_at ASC)
  WHERE item_type = 'file'
    AND upload_status = 'pending'
    AND deleted_at IS NULL;

CREATE TRIGGER trg_drive_items_updated_at
BEFORE UPDATE ON public.drive_items
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.drive_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,

  drive_item_id UUID NOT NULL,

  object_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',

  expected_size_bytes BIGINT NOT NULL,
  expected_mime_type TEXT NOT NULL,

  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,

  created_by_user_id UUID NOT NULL
    REFERENCES public.users(id) ON DELETE RESTRICT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT drive_uploads_item_same_workspace_fk
    FOREIGN KEY (drive_item_id, workspace_id)
    REFERENCES public.drive_items(id, workspace_id)
    ON DELETE CASCADE,

  CONSTRAINT drive_uploads_drive_item_unique
    UNIQUE (drive_item_id),

  CONSTRAINT drive_uploads_object_key_unique
    UNIQUE (object_key),

  CONSTRAINT drive_uploads_status_check
    CHECK (status IN ('pending', 'completed', 'failed', 'expired')),

  CONSTRAINT drive_uploads_expected_size_check
    CHECK (expected_size_bytes BETWEEN 0 AND 104857600),

  CONSTRAINT drive_uploads_expected_mime_type_length_check
    CHECK (char_length(expected_mime_type) BETWEEN 1 AND 255),

  CONSTRAINT drive_uploads_completed_at_status_check
    CHECK (
      (
        status = 'completed'
        AND completed_at IS NOT NULL
      )
      OR
      (
        status <> 'completed'
        AND completed_at IS NULL
      )
    ),

  CONSTRAINT drive_uploads_expiry_order_check
    CHECK (expires_at > created_at)
);

CREATE INDEX idx_drive_uploads_workspace_status
  ON public.drive_uploads(workspace_id, status);

CREATE INDEX idx_drive_uploads_drive_item_id
  ON public.drive_uploads(drive_item_id);

CREATE INDEX idx_drive_uploads_created_by_user_id
  ON public.drive_uploads(created_by_user_id);

CREATE INDEX idx_drive_uploads_expires_at
  ON public.drive_uploads(expires_at)
  WHERE status = 'pending';

CREATE TRIGGER trg_drive_uploads_updated_at
BEFORE UPDATE ON public.drive_uploads
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.drive_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drive_uploads ENABLE ROW LEVEL SECURITY;

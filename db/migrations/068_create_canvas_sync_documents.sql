-- Store document snapshots for non-classic Canvas engines.
-- tldraw_sync canvases use this table instead of canvas_freeform_shapes for
-- their primary document persistence.

BEGIN;

CREATE TABLE public.canvas_sync_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id UUID NOT NULL,
  canvas_id UUID NOT NULL,

  provider_type TEXT NOT NULL,
  snapshot JSONB,
  version BIGINT NOT NULL DEFAULT 1,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT canvas_sync_documents_canvas_workspace_fk
    FOREIGN KEY (canvas_id, workspace_id)
    REFERENCES public.canvas(id, workspace_id)
    ON DELETE CASCADE,

  CONSTRAINT canvas_sync_documents_canvas_unique
    UNIQUE (canvas_id),

  CONSTRAINT canvas_sync_documents_provider_type_check
    CHECK (provider_type IN ('tldraw_sync')),

  CONSTRAINT canvas_sync_documents_version_positive_check
    CHECK (version > 0),

  CONSTRAINT canvas_sync_documents_snapshot_object_check
    CHECK (snapshot IS NULL OR jsonb_typeof(snapshot) = 'object')
);

CREATE INDEX idx_canvas_sync_documents_workspace_canvas
  ON public.canvas_sync_documents(workspace_id, canvas_id);

ALTER TABLE public.canvas_sync_documents ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.canvas_sync_documents IS
  'Document-level persistence for Canvas engines such as tldraw_sync. Classic Canvas continues to use canvas_freeform_shapes and canvas_shape_operations.';

COMMENT ON COLUMN public.canvas_sync_documents.snapshot IS
  'Serialized tldraw editor/store snapshot for restoring a sync engine canvas room.';

COMMENT ON COLUMN public.canvas_sync_documents.version IS
  'Monotonic document snapshot version incremented on every save.';

COMMIT;

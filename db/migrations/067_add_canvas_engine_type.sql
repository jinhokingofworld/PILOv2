-- Add Canvas engine metadata so classic API-backed canvases and future
-- tldraw sync canvases can coexist without migrating existing shapes.

BEGIN;

ALTER TABLE public.canvas
  ADD COLUMN engine_type TEXT NOT NULL DEFAULT 'classic',
  ADD COLUMN engine_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN source_canvas_id UUID
    REFERENCES public.canvas(id) ON DELETE SET NULL,
  ADD CONSTRAINT canvas_engine_type_check
    CHECK (engine_type IN ('classic', 'tldraw_sync')),
  ADD CONSTRAINT canvas_engine_version_positive_check
    CHECK (engine_version > 0),
  ADD CONSTRAINT canvas_source_canvas_not_self_check
    CHECK (source_canvas_id IS NULL OR source_canvas_id <> id);

CREATE INDEX idx_canvas_source_canvas_id
  ON public.canvas(source_canvas_id)
  WHERE source_canvas_id IS NOT NULL;

COMMENT ON COLUMN public.canvas.engine_type IS
  'Canvas rendering/sync engine. classic uses the existing API batch/operation log flow; tldraw_sync is reserved for the sync document engine.';

COMMENT ON COLUMN public.canvas.engine_version IS
  'Version of the Canvas engine implementation used by this canvas.';

COMMENT ON COLUMN public.canvas.source_canvas_id IS
  'When a user starts a new engine version from an existing canvas, this points to the source canvas. Existing shapes are not migrated automatically.';

COMMIT;

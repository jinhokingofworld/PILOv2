-- Remove the unused tldraw sync persistence objects introduced by migrations
-- 067 and 068. Keep canvas.engine_type temporarily because deployed Canvas,
-- Agent, recording, and Realtime access queries still use it as a Classic-only
-- compatibility guard.

LOCK TABLE public.canvas, public.canvas_sync_documents
  IN ACCESS EXCLUSIVE MODE;

DO $canvas_sync_cleanup$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.canvas
    WHERE engine_type = 'tldraw_sync'
  ) THEN
    RAISE EXCEPTION
      'Cannot remove Canvas sync storage while tldraw_sync canvases remain'
      USING HINT = 'Audit and remove or migrate tldraw_sync canvas rows before applying migration 105.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.canvas_sync_documents
  ) THEN
    RAISE EXCEPTION
      'Cannot remove Canvas sync storage while sync documents remain'
      USING HINT = 'Audit and remove or archive canvas_sync_documents rows before applying migration 105.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.canvas
    WHERE source_canvas_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot remove Canvas source metadata while source references remain'
      USING HINT = 'Audit source_canvas_id references before applying migration 105.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.canvas
    WHERE engine_version <> 1
  ) THEN
    RAISE EXCEPTION
      'Cannot remove Canvas engine version metadata with non-default versions'
      USING HINT = 'Audit non-default engine_version rows before applying migration 105.';
  END IF;
END;
$canvas_sync_cleanup$;

DROP TABLE public.canvas_sync_documents;

DROP INDEX public.idx_canvas_source_canvas_id;

ALTER TABLE public.canvas
  DROP CONSTRAINT canvas_source_canvas_id_fkey,
  DROP CONSTRAINT canvas_source_canvas_not_self_check,
  DROP CONSTRAINT canvas_engine_version_positive_check,
  DROP CONSTRAINT canvas_engine_type_check,
  DROP COLUMN source_canvas_id,
  DROP COLUMN engine_version,
  ADD CONSTRAINT canvas_engine_type_check
    CHECK (engine_type = 'classic');

COMMENT ON COLUMN public.canvas.engine_type IS
  'Temporary Classic Canvas compatibility discriminator. Only classic is allowed after tldraw sync removal.';

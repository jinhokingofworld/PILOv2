-- Canvas shape parent relation for frame-scoped lazy loading.
-- Stores the immediate parent shape id so the server can fetch or exclude
-- shapes inside collapsed frames without loading every shape in the viewport.

ALTER TABLE public.canvas_freeform_shapes
  ADD COLUMN parent_shape_id TEXT;

CREATE INDEX idx_canvas_freeform_shapes_parent_active
  ON public.canvas_freeform_shapes(canvas_id, parent_shape_id)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.canvas_freeform_shapes.parent_shape_id IS
  'Immediate parent shape id for frame-scoped Canvas lazy loading. Null means the shape is top-level on the canvas.';

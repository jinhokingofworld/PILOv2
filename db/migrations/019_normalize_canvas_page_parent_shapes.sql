-- Normalize tldraw page parents that were briefly persisted as shape parents.
-- Top-level Canvas shapes must use NULL parent_shape_id; only shape:* parents
-- are frame/shape relationships used by lazy loading.

UPDATE public.canvas_freeform_shapes
SET parent_shape_id = NULL
WHERE parent_shape_id LIKE 'page:%';

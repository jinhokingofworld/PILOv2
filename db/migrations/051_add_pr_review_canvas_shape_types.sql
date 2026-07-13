BEGIN;

ALTER TABLE public.canvas_freeform_shapes
  DROP CONSTRAINT canvas_shape_type_check;

ALTER TABLE public.canvas_freeform_shapes
  ADD CONSTRAINT canvas_shape_type_check
  CHECK (
    shape_type IN (
      'sticky-note',
      'note',
      'text',
      'frame',
      'draw',
      'highlight',
      'geo',
      'arrow',
      'line',
      'image',
      'video',
      'bookmark',
      'embed',
      'pilo-code-block',
      'file_node',
      'pr_review_file_node',
      'pr_review_relation_edge',
      'group'
    )
  );

COMMIT;

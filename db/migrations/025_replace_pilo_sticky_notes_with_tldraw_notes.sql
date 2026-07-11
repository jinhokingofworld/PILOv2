-- Replace the custom PILO sticky-note record with Tldraw's built-in note shape.
-- Existing note text is retained as Tldraw rich text so saved canvases remain readable.

ALTER TABLE public.canvas_freeform_shapes
  DROP CONSTRAINT canvas_shape_type_check;

UPDATE public.canvas_freeform_shapes
SET
  shape_type = 'note',
  raw_shape = jsonb_set(
    jsonb_set(raw_shape, '{type}', '"note"'::jsonb),
    '{props}',
    jsonb_build_object(
      'color', 'yellow',
      'richText',
        CASE
          WHEN NULLIF(BTRIM(COALESCE(raw_shape -> 'props' ->> 'text', '')), '') IS NULL
            THEN jsonb_build_object(
              'type', 'doc',
              'content', jsonb_build_array(jsonb_build_object('type', 'paragraph'))
            )
          ELSE jsonb_build_object(
            'type', 'doc',
            'content', jsonb_build_array(
              jsonb_build_object(
                'type', 'paragraph',
                'content', jsonb_build_array(
                  jsonb_build_object(
                    'type', 'text',
                    'text', raw_shape -> 'props' ->> 'text'
                  )
                )
              )
            )
          END,
      'size', 'm',
      'font', 'draw',
      'align', 'middle',
      'verticalAlign', 'middle',
      'labelColor', 'black',
      'growY', 0,
      'fontSizeAdjustment', 1,
      'url', '',
      'scale', 1,
      'textFirstEditedBy', NULL
    )
  )
WHERE shape_type = 'pilo-sticky-note';

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
      'group'
    )
  );

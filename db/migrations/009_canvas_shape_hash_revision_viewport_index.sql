-- Canvas shape storage stability and viewport lookup support.
-- Adds server-managed content hashes, write revisions, generated bounds, and
-- active-shape indexes for viewport overlap queries.

ALTER TABLE canvas_freeform_shapes
  ADD COLUMN content_hash TEXT NOT NULL DEFAULT '',
  ADD COLUMN revision BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN max_x DOUBLE PRECISION
    GENERATED ALWAYS AS (x + COALESCE(width, 0)) STORED,
  ADD COLUMN max_y DOUBLE PRECISION
    GENERATED ALWAYS AS (y + COALESCE(height, 0)) STORED;

UPDATE canvas_freeform_shapes
SET content_hash = encode(
  digest(
    jsonb_build_object(
      'height', height,
      'rawShape', raw_shape,
      'rotation', rotation,
      'shapeType', shape_type,
      'textContent', text_content,
      'title', title,
      'width', width,
      'x', x,
      'y', y,
      'zIndex', z_index
    )::text,
    'sha256'
  ),
  'hex'
)
WHERE content_hash = '';

CREATE INDEX idx_canvas_freeform_shapes_viewport_active
  ON canvas_freeform_shapes(canvas_id, x, max_x, y, max_y)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_canvas_freeform_shapes_order_active
  ON canvas_freeform_shapes(canvas_id, z_index, updated_at, id)
  WHERE deleted_at IS NULL;

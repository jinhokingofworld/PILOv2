INSERT INTO public.canvas (id, workspace_id, board_type)
VALUES (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'freeform'
);

INSERT INTO public.canvas_freeform_shapes (
  id,
  canvas_id,
  shape_type,
  title,
  text_content,
  revision
)
VALUES (
  'shape:test',
  '10000000-0000-0000-0000-000000000001',
  'text',
  'PILO',
  'RDS',
  1
);

DO $verification$
DECLARE
  actual_hash TEXT;
  expected_hash TEXT;
BEGIN
  SELECT expected_source_text_hash
  INTO actual_hash
  FROM public.canvas_agent_shape_embedding_jobs
  WHERE shape_id = 'shape:test';

  expected_hash := encode(
    public.digest(E'text\nPILO\nRDS'::text, 'sha256'::text),
    'hex'
  );

  IF actual_hash IS DISTINCT FROM expected_hash THEN
    RAISE EXCEPTION 'Canvas Agent trigger hash mismatch';
  END IF;

  IF pg_get_functiondef(
    'public.enqueue_canvas_agent_shape_embedding_job()'::regprocedure
  ) LIKE '%extensions.digest(%' THEN
    RAISE EXCEPTION 'legacy extensions.digest reference remains';
  END IF;
END;
$verification$;

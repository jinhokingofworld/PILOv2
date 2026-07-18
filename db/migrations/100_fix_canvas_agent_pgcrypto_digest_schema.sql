DO $pgcrypto_verification$
BEGIN
  IF to_regprocedure('public.digest(text,text)') IS NULL THEN
    RAISE EXCEPTION
      'public.digest(text,text) is required before fixing the Canvas Agent embedding trigger';
  END IF;
END;
$pgcrypto_verification$;

CREATE OR REPLACE FUNCTION public.enqueue_canvas_agent_shape_embedding_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_workspace_id UUID;
  v_operation TEXT;
  v_source_text_hash TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NOT NULL THEN
      RETURN NEW;
    END IF;
    v_operation := 'upsert';
  ELSIF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    v_operation := CASE WHEN NEW.deleted_at IS NULL THEN 'upsert' ELSE 'delete' END;
  ELSIF NEW.shape_type IS DISTINCT FROM OLD.shape_type
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.text_content IS DISTINCT FROM OLD.text_content THEN
    v_operation := 'upsert';
  ELSE
    RETURN NEW;
  END IF;

  SELECT canvas.workspace_id
  INTO v_workspace_id
  FROM public.canvas
  WHERE canvas.id = NEW.canvas_id
    AND canvas.board_type = 'freeform';

  IF v_workspace_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_source_text_hash := encode(
    public.digest(
      concat_ws(
        E'\n',
        NEW.shape_type,
        COALESCE(NEW.title, ''),
        COALESCE(NEW.text_content, '')
      )::text,
      'sha256'::text
    ),
    'hex'
  );

  INSERT INTO public.canvas_agent_shape_embedding_jobs (
    workspace_id,
    canvas_id,
    shape_id,
    operation,
    expected_shape_revision,
    expected_source_text_hash
  )
  VALUES (
    v_workspace_id,
    NEW.canvas_id,
    NEW.id,
    v_operation,
    NEW.revision,
    v_source_text_hash
  )
  ON CONFLICT (canvas_id, shape_id, operation, expected_shape_revision)
  DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_canvas_agent_shape_embedding_job() IS
  'Queues Canvas Agent shape embeddings using pgcrypto.digest from its installed public schema.';

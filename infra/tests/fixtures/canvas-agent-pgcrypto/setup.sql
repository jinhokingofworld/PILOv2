CREATE EXTENSION pgcrypto WITH SCHEMA public;

CREATE TABLE public.canvas (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  board_type TEXT NOT NULL
);

CREATE TABLE public.canvas_freeform_shapes (
  id TEXT PRIMARY KEY,
  canvas_id UUID NOT NULL REFERENCES public.canvas(id),
  shape_type TEXT NOT NULL,
  title TEXT,
  text_content TEXT,
  deleted_at TIMESTAMPTZ,
  revision BIGINT NOT NULL
);

CREATE TABLE public.canvas_agent_shape_embedding_jobs (
  workspace_id UUID NOT NULL,
  canvas_id UUID NOT NULL,
  shape_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  expected_shape_revision BIGINT NOT NULL,
  expected_source_text_hash TEXT NOT NULL,
  UNIQUE (canvas_id, shape_id, operation, expected_shape_revision)
);

CREATE FUNCTION public.enqueue_canvas_agent_shape_embedding_job()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'legacy function must be replaced';
END;
$$;

CREATE TRIGGER trg_canvas_freeform_shapes_enqueue_agent_embedding
AFTER INSERT OR UPDATE OF shape_type, title, text_content, deleted_at
ON public.canvas_freeform_shapes
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_canvas_agent_shape_embedding_job();

-- Observe every SQLtoERD session creation independently of the App Server
-- creation path. This audit remains available for cutover monitoring even
-- when a route omits write_protocol and the database default is used.

BEGIN;

CREATE TABLE public.sql_erd_session_creation_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  session_id UUID NOT NULL UNIQUE,
  workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,

  write_protocol TEXT NOT NULL,
  session_created_at TIMESTAMPTZ NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sql_erd_session_creation_audit_write_protocol_check
    CHECK (write_protocol IN ('snapshot', 'operations_v1'))
);

CREATE INDEX idx_sql_erd_session_creation_audit_cutover_protocol
  ON public.sql_erd_session_creation_audit(session_created_at DESC, write_protocol);

CREATE FUNCTION public.capture_sql_erd_session_creation_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.sql_erd_session_creation_audit (
    session_id,
    workspace_id,
    write_protocol,
    session_created_at
  )
  VALUES (
    NEW.id,
    NEW.workspace_id,
    NEW.write_protocol,
    NEW.created_at
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sql_erd_sessions_capture_creation_audit
AFTER INSERT ON public.sql_erd_sessions
FOR EACH ROW
EXECUTE FUNCTION public.capture_sql_erd_session_creation_audit();

ALTER TABLE public.sql_erd_session_creation_audit ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.sql_erd_session_creation_audit IS
  'Append-only observation of every SQLtoERD session INSERT. Used to detect snapshot sessions created after the operations_v1 cutover flag is enabled, including direct SQL or omitted-protocol insert paths.';

COMMIT;

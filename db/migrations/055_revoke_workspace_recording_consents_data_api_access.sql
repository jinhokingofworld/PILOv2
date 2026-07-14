BEGIN;

REVOKE ALL ON TABLE public.workspace_recording_consents
  FROM anon, authenticated, service_role;

COMMIT;

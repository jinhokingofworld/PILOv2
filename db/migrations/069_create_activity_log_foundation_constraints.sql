-- Establishes the append-only Activity Log contract shared by all domains.

BEGIN;

ALTER TABLE public.activity_logs
  ADD CONSTRAINT activity_logs_dedupe_key_max_length_check
    CHECK (length(dedupe_key) <= 512) NOT VALID,
  ADD CONSTRAINT activity_logs_actor_type_check
    CHECK (
      actor_type IN ('user', 'agent', 'system', 'integration')
      AND (actor_type <> 'user' OR actor_user_id IS NOT NULL)
    ) NOT VALID,
  ADD CONSTRAINT activity_logs_metadata_envelope_check
    CHECK (
      jsonb_typeof(metadata) = 'object'
      AND metadata @> '{"version": 1}'::jsonb
      AND jsonb_typeof(metadata -> 'summary') = 'string'
      AND length(btrim(metadata ->> 'summary')) BETWEEN 1 AND 500
      AND jsonb_typeof(metadata -> 'data') = 'object'
    ) NOT VALID;

CREATE OR REPLACE FUNCTION public.prevent_activity_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('pilo.activity_log_tenant_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION 'activity_logs are append-only and cannot be deleted';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.actor_user_id IS NOT NULL
      AND NEW.actor_user_id IS NULL
      AND (to_jsonb(OLD) - 'actor_user_id') = (to_jsonb(NEW) - 'actor_user_id') THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'activity_logs are append-only and cannot be updated';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_activity_logs_prevent_mutation
BEFORE UPDATE OR DELETE ON public.activity_logs
FOR EACH ROW
EXECUTE FUNCTION public.prevent_activity_log_mutation();

COMMENT ON FUNCTION public.prevent_activity_log_mutation() IS
  'Blocks Activity Log mutation except actor anonymization and the transaction-scoped Workspace tenant purge.';

COMMIT;

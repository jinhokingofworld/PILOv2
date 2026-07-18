DO $baseline_verification$
DECLARE
  missing_objects TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF to_regclass('public.canvas_freeform_shapes') IS NULL THEN
    missing_objects := array_append(missing_objects, 'public.canvas_freeform_shapes');
  END IF;

  IF to_regclass('public.workspace_membership_revocation_outbox') IS NULL THEN
    missing_objects := array_append(
      missing_objects,
      'public.workspace_membership_revocation_outbox'
    );
  END IF;

  IF to_regclass('public.meeting_recording_activity_links') IS NULL THEN
    missing_objects := array_append(
      missing_objects,
      'public.meeting_recording_activity_links'
    );
  END IF;

  IF to_regclass('public.agent_threads') IS NULL THEN
    missing_objects := array_append(missing_objects, 'public.agent_threads');
  END IF;

  IF to_regclass('public.agent_candidate_selections') IS NULL THEN
    missing_objects := array_append(
      missing_objects,
      'public.agent_candidate_selections'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'meeting_reports'
      AND column_name = 'content_version'
  ) THEN
    missing_objects := array_append(
      missing_objects,
      'public.meeting_reports.content_version'
    );
  END IF;

  IF to_regprocedure(
    'public.enqueue_canvas_agent_shape_embedding_job()'
  ) IS NULL THEN
    missing_objects := array_append(
      missing_objects,
      'public.enqueue_canvas_agent_shape_embedding_job()'
    );
  END IF;

  IF to_regprocedure('public.digest(text,text)') IS NULL THEN
    missing_objects := array_append(missing_objects, 'public.digest(text,text)');
  END IF;

  IF cardinality(missing_objects) > 0 THEN
    RAISE EXCEPTION
      'RDS schema is not ready for migration 099 baseline. Missing: %',
      array_to_string(missing_objects, ', ');
  END IF;
END;
$baseline_verification$;

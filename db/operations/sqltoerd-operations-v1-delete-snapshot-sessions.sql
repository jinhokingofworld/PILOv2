-- SQLtoERD operations_v1 cutover only. This is an operator-run template,
-- not a migration. Run it inside the approved maintenance window only after
-- the encrypted snapshot export and full recovery validation have completed.
--
-- Replace expected_session_versions and expected_delete_after from the manifest.
-- Keep sessionVersions in lexicographic sessionId order. An empty list aborts.

BEGIN;

-- Blocks concurrent INSERT/UPDATE/DELETE on sql_erd_sessions while the
-- manifest target versions are checked and physically deleted.
LOCK TABLE public.sql_erd_sessions IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  -- Replace this placeholder object with the full manifest sessionVersions array.
  expected_session_versions JSONB := '[
    {"sessionId":"00000000-0000-4000-8000-000000000000","revision":1,"updatedAt":"2026-07-15T09:00:00.000Z"}
  ]'::JSONB;
  expected_delete_after TIMESTAMPTZ := '2026-07-23T09:00:00.000Z';
  expected_count INTEGER;
  expected_unique_count INTEGER;
BEGIN
  IF expected_delete_after IS NULL
    OR NOT isfinite(expected_delete_after)
    OR expected_delete_after < clock_timestamp() + INTERVAL '7 days' THEN
    RAISE EXCEPTION
      'Snapshot export retention must extend at least seven days after deletion';
  END IF;

  IF jsonb_typeof(expected_session_versions) <> 'array'
    OR jsonb_array_length(expected_session_versions) = 0 THEN
    RAISE EXCEPTION
      'Replace expected_session_versions with the validated export manifest versions before deletion';
  END IF;

  SELECT
    count(*)::INTEGER,
    count(DISTINCT (item ->> 'sessionId')::UUID)::INTEGER
  INTO expected_count, expected_unique_count
  FROM jsonb_array_elements(expected_session_versions) AS item;

  IF expected_count IS DISTINCT FROM expected_unique_count THEN
    RAISE EXCEPTION
      'Expected snapshot session versions contain duplicate session IDs';
  END IF;

  IF EXISTS (
    WITH expected AS (
      SELECT
        (item ->> 'sessionId')::UUID AS session_id,
        (item ->> 'revision')::INTEGER AS revision,
        (item ->> 'updatedAt')::TIMESTAMPTZ AS updated_at
      FROM jsonb_array_elements(expected_session_versions) AS item
    ),
    current_snapshot AS (
      SELECT id AS session_id, revision, updated_at
      FROM public.sql_erd_sessions
      WHERE write_protocol = 'snapshot'
        AND deleted_at IS NULL
    )
    SELECT 1
    FROM expected
    FULL OUTER JOIN current_snapshot USING (session_id)
    WHERE expected.session_id IS NULL
      OR current_snapshot.session_id IS NULL
      OR expected.revision IS DISTINCT FROM current_snapshot.revision
      OR expected.updated_at IS DISTINCT FROM current_snapshot.updated_at
  ) THEN
    RAISE EXCEPTION
      'Active snapshot session versions no longer match the validated export manifest';
  END IF;
END;
$$;

WITH deleted_sessions AS (
  DELETE FROM public.sql_erd_sessions
  WHERE write_protocol = 'snapshot'
    AND deleted_at IS NULL
  RETURNING id
)
SELECT
  count(*)::INTEGER AS deleted_snapshot_session_count,
  COALESCE(array_agg(id ORDER BY id), ARRAY[]::UUID[]) AS deleted_session_ids
FROM deleted_sessions;

COMMIT;

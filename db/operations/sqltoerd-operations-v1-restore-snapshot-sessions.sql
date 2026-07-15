\set ON_ERROR_STOP on

-- Privileged SQLtoERD snapshot-session disaster recovery template.
-- Run with psql as the sql_erd_sessions table owner during maintenance only.
-- Replace the \copy path with the plaintext produced by the verified age
-- artifact, then securely delete that plaintext immediately after this script.

BEGIN;

CREATE TEMP TABLE pilo_sql_erd_snapshot_restore_stage (
  payload JSONB NOT NULL
) ON COMMIT DROP;

-- JSON strings escape control characters, so these control-byte CSV settings
-- preserve each NDJSON line as one field without COPY text backslash decoding.
\copy pilo_sql_erd_snapshot_restore_stage(payload) FROM 'C:/secure-temp/snapshot-sessions.ndjson' WITH (FORMAT csv, DELIMITER E'\x02', QUOTE E'\x01')

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pilo_sql_erd_snapshot_restore_stage) THEN
    RAISE EXCEPTION 'Snapshot restore stage is empty';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pilo_sql_erd_snapshot_restore_stage stage
    JOIN public.sql_erd_sessions session
      ON session.id = (stage.payload ->> 'id')::UUID
  ) THEN
    RAISE EXCEPTION 'A SQLtoERD session ID from the restore already exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pilo_sql_erd_snapshot_restore_stage stage
    JOIN public.sql_erd_session_creation_audit audit
      ON audit.session_id = (stage.payload ->> 'id')::UUID
    WHERE audit.workspace_id IS DISTINCT FROM
        (stage.payload ->> 'workspace_id')::UUID
      OR audit.write_protocol IS DISTINCT FROM
        stage.payload ->> 'write_protocol'
      OR audit.session_created_at IS DISTINCT FROM
        (stage.payload ->> 'created_at')::TIMESTAMPTZ
  ) THEN
    RAISE EXCEPTION
      'Existing SQLtoERD creation audit metadata conflicts with the restore';
  END IF;
END;
$$;

-- The creation audit table retains UNIQUE(session_id) rows after physical
-- deletion. Disable only its INSERT trigger while restoring the same IDs;
-- FK/constraint triggers remain enabled.
ALTER TABLE public.sql_erd_sessions
  DISABLE TRIGGER trg_sql_erd_sessions_capture_creation_audit;

INSERT INTO public.sql_erd_sessions (
  id,
  workspace_id,
  title,
  source_format,
  dialect,
  source_text,
  model_json,
  layout_json,
  settings_json,
  table_count,
  relation_count,
  revision,
  created_by,
  updated_by,
  created_at,
  updated_at,
  deleted_at,
  write_protocol,
  latest_op_seq
)
SELECT
  (payload ->> 'id')::UUID,
  (payload ->> 'workspace_id')::UUID,
  payload ->> 'title',
  payload ->> 'source_format',
  payload ->> 'dialect',
  payload ->> 'source_text',
  payload -> 'model_json',
  payload -> 'layout_json',
  payload -> 'settings_json',
  (payload ->> 'table_count')::INTEGER,
  (payload ->> 'relation_count')::INTEGER,
  (payload ->> 'revision')::INTEGER,
  (payload ->> 'created_by')::UUID,
  (payload ->> 'updated_by')::UUID,
  (payload ->> 'created_at')::TIMESTAMPTZ,
  (payload ->> 'updated_at')::TIMESTAMPTZ,
  (payload ->> 'deleted_at')::TIMESTAMPTZ,
  payload ->> 'write_protocol',
  (payload ->> 'latest_op_seq')::BIGINT
FROM pilo_sql_erd_snapshot_restore_stage
ORDER BY payload ->> 'id';

ALTER TABLE public.sql_erd_sessions
  ENABLE TRIGGER trg_sql_erd_sessions_capture_creation_audit;

-- Sessions created before migration 069 may not have an audit row. Preserve
-- existing matching audit rows and create only the missing observations.
INSERT INTO public.sql_erd_session_creation_audit (
  session_id,
  workspace_id,
  write_protocol,
  session_created_at
)
SELECT
  session.id,
  session.workspace_id,
  session.write_protocol,
  session.created_at
FROM public.sql_erd_sessions session
JOIN pilo_sql_erd_snapshot_restore_stage stage
  ON (stage.payload ->> 'id')::UUID = session.id
ON CONFLICT (session_id) DO NOTHING;

SELECT
  count(*)::INTEGER AS restored_snapshot_session_count,
  array_agg(session.id ORDER BY session.id) AS restored_session_ids
FROM public.sql_erd_sessions session
JOIN pilo_sql_erd_snapshot_restore_stage stage
  ON (stage.payload ->> 'id')::UUID = session.id;

COMMIT;

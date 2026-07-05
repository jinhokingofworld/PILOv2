-- Move post-baseline workspace and meeting recording/report contract changes
-- out of 001_initial_schema.sql so applied migrations remain immutable.

BEGIN;

DROP INDEX IF EXISTS public.idx_workspaces_owner_user_id;

CREATE UNIQUE INDEX IF NOT EXISTS unique_workspace_per_owner_user_id
  ON public.workspaces(owner_user_id)
  WHERE owner_user_id IS NOT NULL;

ALTER TABLE public.meeting_recordings
  DROP CONSTRAINT IF EXISTS unique_recording_per_meeting;

CREATE UNIQUE INDEX IF NOT EXISTS unique_running_recording_per_meeting
  ON public.meeting_recordings(meeting_id)
  WHERE status = 'RUNNING';

ALTER TABLE public.meeting_reports
  DROP CONSTRAINT IF EXISTS unique_report_per_meeting;

CREATE OR REPLACE FUNCTION public.enforce_meeting_report_policy()
RETURNS TRIGGER AS $$
DECLARE
  recording_status public.meeting_recording_status;
  recording_duration_sec integer;
BEGIN
  SELECT r.status, r.duration_sec
  INTO recording_status, recording_duration_sec
  FROM public.meetings m
  JOIN public.meeting_recordings r
    ON r.meeting_id = m.id
  WHERE m.id = NEW.meeting_id
    AND r.id = NEW.recording_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'meeting_report must reference a recording from the same meeting';
  END IF;

  IF recording_status = 'RUNNING' THEN
    RAISE EXCEPTION 'meeting_report cannot be created while recording is still running';
  END IF;

  IF recording_status = 'COMPLETED'
     AND (recording_duration_sec IS NULL OR recording_duration_sec <= 60) THEN
    RAISE EXCEPTION 'meeting_report cannot be created for recordings shorter than or equal to 60 seconds';
  END IF;

  IF recording_status = 'FAILED'
     AND (NEW.status <> 'FAILED' OR NEW.failed_step <> 'RECORDING') THEN
    RAISE EXCEPTION 'failed recording must create a FAILED report with failed_step RECORDING';
  END IF;

  IF recording_status = 'COMPLETED'
     AND NEW.failed_step = 'RECORDING' THEN
    RAISE EXCEPTION 'completed recording cannot create a report failed at RECORDING step';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION public.enforce_meeting_report_policy()
  SET search_path = public, pg_temp;

COMMIT;

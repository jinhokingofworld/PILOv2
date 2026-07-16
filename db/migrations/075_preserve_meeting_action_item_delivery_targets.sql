BEGIN;

-- 074 was applied to the shared dev database before its target-deletion
-- contract was corrected. Keep this migration safe for both that schema and
-- fresh databases where the corrected 074 has already added the column.
ALTER TABLE public.meeting_report_action_item_deliveries
  ADD COLUMN IF NOT EXISTS target_resource_id TEXT;

UPDATE public.meeting_report_action_item_deliveries
SET target_resource_id = COALESCE(calendar_event_id::text, pilo_issue_id::text)
WHERE status = 'COMPLETED'
  AND target_resource_id IS NULL;

UPDATE public.meeting_report_action_item_deliveries
SET calendar_event_id = NULL,
    pilo_issue_id = NULL,
    target_resource_id = NULL
WHERE status <> 'COMPLETED'
  AND (
    calendar_event_id IS NOT NULL
    OR pilo_issue_id IS NOT NULL
    OR target_resource_id IS NOT NULL
  );

ALTER TABLE public.meeting_report_action_item_deliveries
  DROP CONSTRAINT IF EXISTS meeting_report_action_item_deliveries_completed_target_check,
  DROP CONSTRAINT IF EXISTS meeting_report_action_item_deliveries_target_check,
  DROP CONSTRAINT IF EXISTS meeting_report_action_item_deliveries_calendar_event_id_fkey,
  DROP CONSTRAINT IF EXISTS meeting_report_action_item_deliveries_pilo_issue_id_fkey,
  ADD CONSTRAINT meeting_report_action_item_deliveries_calendar_event_id_fkey
    FOREIGN KEY (calendar_event_id)
    REFERENCES public.calendar_events(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT meeting_report_action_item_deliveries_pilo_issue_id_fkey
    FOREIGN KEY (pilo_issue_id)
    REFERENCES public.pilo_issues(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT meeting_report_action_item_deliveries_target_check
    CHECK (
      (
        status <> 'COMPLETED'
        AND calendar_event_id IS NULL
        AND pilo_issue_id IS NULL
        AND target_resource_id IS NULL
      )
      OR (
        status = 'COMPLETED'
        AND target_resource_id IS NOT NULL
        AND target_resource_id ~ '^[1-9][0-9]{0,18}$'
        AND (
          (
            delivery_type = 'calendar_event'
            AND pilo_issue_id IS NULL
            AND (
              calendar_event_id IS NULL
              OR target_resource_id = calendar_event_id::text
            )
          )
          OR (
            delivery_type = 'pilo_issue'
            AND calendar_event_id IS NULL
            AND (
              pilo_issue_id IS NULL
              OR target_resource_id = pilo_issue_id::text
            )
          )
        )
      )
    );

CREATE INDEX IF NOT EXISTS idx_meeting_report_action_item_deliveries_target_resource
  ON public.meeting_report_action_item_deliveries(delivery_type, target_resource_id)
  WHERE target_resource_id IS NOT NULL;

COMMENT ON COLUMN public.meeting_report_action_item_deliveries.target_resource_id IS
  'Immutable delivered target ID snapshot. The live FK can become null when Calendar or Board deletes the target.';

COMMIT;

BEGIN;

ALTER TABLE calendar_event_google_syncs
  ADD COLUMN google_calendar_id TEXT;

UPDATE calendar_event_google_syncs AS sync
SET google_calendar_id = connection.target_calendar_id
FROM google_calendar_connections AS connection
WHERE sync.connection_user_id = connection.user_id
  AND sync.google_calendar_id IS NULL
  AND connection.revoked_at IS NULL
  AND connection.target_calendar_id IS NOT NULL;

CREATE INDEX idx_calendar_event_google_syncs_google_calendar_id
  ON calendar_event_google_syncs(google_calendar_id)
  WHERE google_calendar_id IS NOT NULL;

COMMIT;

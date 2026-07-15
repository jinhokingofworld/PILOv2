-- Preserve each Meeting participation interval so Activity snapshots can prove
-- that the actor was present at the Activity Log occurrence time.
--
-- Existing rows were maintained as a single mutable row, so their earlier
-- participation intervals cannot be reconstructed safely. Keep them for the
-- existing Meeting API, but exclude them from newly created Activity snapshots.

BEGIN;

ALTER TABLE meeting_participants
  ADD COLUMN is_legacy_session boolean NOT NULL DEFAULT false;

UPDATE meeting_participants
SET is_legacy_session = true;

ALTER TABLE meeting_participants
  DROP CONSTRAINT IF EXISTS unique_meeting_participant,
  DROP CONSTRAINT IF EXISTS unique_meeting_livekit_identity;

CREATE UNIQUE INDEX unique_active_meeting_participant
  ON meeting_participants (meeting_id, user_id)
  WHERE left_at IS NULL;

CREATE UNIQUE INDEX unique_active_meeting_livekit_identity
  ON meeting_participants (meeting_id, livekit_identity)
  WHERE left_at IS NULL;

CREATE INDEX idx_meeting_participants_activity_session
  ON meeting_participants (meeting_id, user_id, joined_at, left_at)
  WHERE is_legacy_session = false;

COMMIT;

-- Add the queued state in its own transaction so later migrations can use it.
ALTER TYPE github_sync_status ADD VALUE IF NOT EXISTS 'queued' BEFORE 'running';

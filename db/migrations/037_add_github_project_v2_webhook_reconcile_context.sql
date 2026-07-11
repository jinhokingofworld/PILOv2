BEGIN;

ALTER TABLE github_webhook_deliveries
  ADD COLUMN action TEXT,
  ADD COLUMN github_installation_id BIGINT,
  ADD COLUMN project_v2_node_id TEXT,
  ADD COLUMN project_item_node_id TEXT,
  ADD COLUMN lease_owner TEXT,
  ADD COLUMN lease_expires_at TIMESTAMPTZ,
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE github_webhook_deliveries
  DROP CONSTRAINT github_webhook_deliveries_status_check,
  ADD CONSTRAINT github_webhook_deliveries_status_check
    CHECK (status IN ('received', 'processing', 'processed', 'failed', 'ignored'));

CREATE INDEX idx_github_webhook_deliveries_runnable
  ON github_webhook_deliveries(status, lease_expires_at)
  WHERE status IN ('received', 'processing');

COMMIT;

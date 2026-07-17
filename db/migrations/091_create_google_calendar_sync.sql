BEGIN;

CREATE TABLE google_calendar_connections (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  target_calendar_id TEXT,
  target_calendar_summary TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_google_calendar_connections_updated_at
BEFORE UPDATE ON google_calendar_connections
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE google_calendar_oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  return_path TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_google_calendar_oauth_states_expiry
  ON google_calendar_oauth_states(expires_at);

CREATE TABLE calendar_event_google_syncs (
  calendar_event_id BIGINT PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disconnected', 'failed')),
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_calendar_event_google_syncs_connection
  ON calendar_event_google_syncs(connection_user_id, status);

CREATE TRIGGER trg_calendar_event_google_syncs_updated_at
BEFORE UPDATE ON calendar_event_google_syncs
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE calendar_google_sync_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_event_id BIGINT NOT NULL,
  connection_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'publishing', 'delivered', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claim_token UUID,
  claimed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_user_id, dedupe_key)
);

CREATE INDEX idx_calendar_google_sync_outbox_due
  ON calendar_google_sync_outbox(status, next_attempt_at);
CREATE INDEX idx_calendar_google_sync_outbox_event
  ON calendar_google_sync_outbox(calendar_event_id, created_at);

ALTER TABLE google_calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_calendar_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_event_google_syncs ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_google_sync_outbox ENABLE ROW LEVEL SECURITY;

COMMIT;

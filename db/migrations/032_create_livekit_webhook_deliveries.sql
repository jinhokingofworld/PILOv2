BEGIN;

CREATE TABLE public.livekit_webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  delivery_id TEXT NOT NULL UNIQUE,
  event_name TEXT NOT NULL,
  room_name TEXT,
  participant_identity TEXT,
  status TEXT NOT NULL,

  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_message TEXT,

  CONSTRAINT livekit_webhook_deliveries_event_name_check
    CHECK (
      event_name = btrim(event_name)
      AND octet_length(event_name) BETWEEN 1 AND 100
    ),
  CONSTRAINT livekit_webhook_deliveries_status_check
    CHECK (status IN ('received', 'ignored')),
  CONSTRAINT livekit_webhook_deliveries_error_message_check
    CHECK (error_message IS NULL OR octet_length(error_message) BETWEEN 1 AND 500)
);

CREATE INDEX idx_livekit_webhook_deliveries_status_received_at
  ON public.livekit_webhook_deliveries(status, received_at DESC);

CREATE INDEX idx_livekit_webhook_deliveries_room_participant
  ON public.livekit_webhook_deliveries(room_name, participant_identity);

ALTER TABLE public.livekit_webhook_deliveries ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.livekit_webhook_deliveries IS
  'Verified LiveKit participant departure webhook deliveries. Raw provider payloads are intentionally not stored.';

COMMIT;

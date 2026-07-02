ALTER TABLE gps_telemetry
  ADD COLUMN IF NOT EXISTS telegram_message TEXT;

CREATE INDEX IF NOT EXISTS idx_gps_telemetry_event_created
  ON gps_telemetry (event_type, created_at DESC);

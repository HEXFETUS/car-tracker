ALTER TABLE gps_telemetry
  ADD COLUMN IF NOT EXISTS driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL;

ALTER TABLE gps_telemetry
  ADD COLUMN IF NOT EXISTS to_number TEXT;

ALTER TABLE gps_telemetry
  ADD COLUMN IF NOT EXISTS telegram_message TEXT;

ALTER TABLE gps_telemetry
  ADD COLUMN IF NOT EXISTS active_trip_id UUID;

CREATE INDEX IF NOT EXISTS idx_gps_telemetry_active_trip
  ON gps_telemetry (vehicle_id, active_trip_id, recorded_at DESC)
  WHERE active_trip_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gps_telemetry_event_created
  ON gps_telemetry (event_type, created_at DESC);

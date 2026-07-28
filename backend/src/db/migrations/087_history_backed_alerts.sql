ALTER TABLE gps_telemetry
  ADD COLUMN IF NOT EXISTS source_event_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS gps_telemetry_source_event_key_uidx
  ON gps_telemetry (source_event_key)
  WHERE source_event_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS gps_history_alert_cursors (
  vehicle_id UUID PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  last_event_at TIMESTAMPTZ,
  last_ignition BOOLEAN,
  last_speed_kmh NUMERIC,
  last_fuel_liters NUMERIC,
  last_location_name TEXT,
  idle_started_at TIMESTAMPTZ,
  last_idling_threshold_minutes INTEGER NOT NULL DEFAULT 0,
  active_trip_id UUID,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gps_history_alert_delivery_retry_idx
  ON gps_telemetry (telegram_status, recorded_at)
  WHERE source_event_key IS NOT NULL
    AND telegram_status IS DISTINCT FROM 'sent';

-- Logical Travel Order / business-trip lifecycle support.
-- A single gps_trip_logs row can span multiple physical active_trip_id sessions.

CREATE TABLE IF NOT EXISTS gps_trip_log_active_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gps_trip_log_id UUID NOT NULL REFERENCES gps_trip_logs(id) ON DELETE CASCADE,
  active_trip_id UUID NOT NULL,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gps_trip_log_id, active_trip_id)
);

CREATE INDEX IF NOT EXISTS idx_gps_trip_log_active_trips_log
  ON gps_trip_log_active_trips (gps_trip_log_id);

CREATE INDEX IF NOT EXISTS idx_gps_trip_log_active_trips_active_trip
  ON gps_trip_log_active_trips (active_trip_id);

ALTER TABLE gps_trip_logs
  ADD COLUMN IF NOT EXISTS business_trip_status TEXT NOT NULL DEFAULT 'WAITING_AT_BASE',
  ADD COLUMN IF NOT EXISTS destination_reached_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returned_to_base_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pause_location TEXT,
  ADD COLUMN IF NOT EXISTS resumed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrived_location_name TEXT,
  ADD COLUMN IF NOT EXISTS arrived_coordinates TEXT,
  ADD COLUMN IF NOT EXISTS matched_destination_distance_m NUMERIC,
  ADD COLUMN IF NOT EXISTS matched_origin_distance_m NUMERIC;

ALTER TABLE gps_trip_logs
  DROP CONSTRAINT IF EXISTS gps_trip_logs_business_trip_status_check;

ALTER TABLE gps_trip_logs
  ADD CONSTRAINT gps_trip_logs_business_trip_status_check
    CHECK (business_trip_status IN (
      'WAITING_AT_BASE',
      'OUTBOUND',
      'ARRIVED_AT_DESTINATION',
      'RETURNING',
      'PAUSED_AWAY_FROM_BASE',
      'COMPLETED'
    ));

CREATE INDEX IF NOT EXISTS idx_gps_trip_logs_business_status
  ON gps_trip_logs (vehicle_id, business_trip_status, departure_time_gps);

CREATE INDEX IF NOT EXISTS idx_gps_trip_logs_open_business_trips
  ON gps_trip_logs (vehicle_id, departure_time_gps DESC)
  WHERE business_trip_status <> 'COMPLETED';

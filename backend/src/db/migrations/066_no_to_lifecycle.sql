-- Add lifecycle columns to gps_no_to_logs, mirroring gps_trip_logs lifecycle.
-- This allows No-TO trips to track the same lifecycle state machine as TO trips.

ALTER TABLE gps_no_to_logs
  ADD COLUMN IF NOT EXISTS business_trip_status TEXT NOT NULL DEFAULT 'OUTBOUND',
  ADD COLUMN IF NOT EXISTS arrived_location_name TEXT,
  ADD COLUMN IF NOT EXISTS arrived_coordinates TEXT,
  ADD COLUMN IF NOT EXISTS destination_reached_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returned_to_base_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pause_location TEXT,
  ADD COLUMN IF NOT EXISTS resumed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_address TEXT,
  ADD COLUMN IF NOT EXISTS end_coordinates TEXT,
  ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS farthest_distance_m NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS candidate_destination_address TEXT,
  ADD COLUMN IF NOT EXISTS candidate_destination_coordinates TEXT;

ALTER TABLE gps_no_to_logs
  DROP CONSTRAINT IF EXISTS gps_no_to_logs_business_trip_status_check;

ALTER TABLE gps_no_to_logs
  ADD CONSTRAINT gps_no_to_logs_business_trip_status_check
    CHECK (business_trip_status IN (
      'WAITING_AT_BASE',
      'OUTBOUND',
      'ARRIVED_AT_DESTINATION',
      'RETURNING',
      'PAUSED_AWAY_FROM_BASE',
      'COMPLETED'
    ));

CREATE INDEX IF NOT EXISTS idx_gps_no_to_logs_business_status
  ON gps_no_to_logs (vehicle_id, business_trip_status, departure_time);

CREATE INDEX IF NOT EXISTS idx_gps_no_to_logs_open_trips
  ON gps_no_to_logs (vehicle_id, departure_time DESC)
  WHERE business_trip_status <> 'COMPLETED';
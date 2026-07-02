-- Add active_trip_id column to gps_trip_logs for telemetry-based trip grouping.
-- This allows upserting by active_trip_id when syncing from gps_telemetry.

ALTER TABLE gps_trip_logs
  ADD COLUMN IF NOT EXISTS active_trip_id UUID;

CREATE INDEX IF NOT EXISTS idx_gps_trip_logs_active_trip_id
  ON gps_trip_logs(active_trip_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gps_trip_logs_active_trip_id
  ON gps_trip_logs(active_trip_id)
  WHERE active_trip_id IS NOT NULL;
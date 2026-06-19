-- Migration 024: trip_type CHECK constraint + perf indexes
--
-- 1. Enforce allowed trip_type values on gps_trip_logs
-- 2. Add indexes used by the tracking-history sync service:
--    - vehicle + departure/arrival trip_type for dedup
--    - trip_type + departure_time_gps for return-trip lookups
--    - vehicle_id + trip_date + trip_type for date-range scans

-- NOTE: Migration 023 already created idx_gps_trip_logs_parent_trip_id
-- and idx_gps_trip_logs_trip_type. This migration adds more specific
-- composite indexes.

ALTER TABLE gps_trip_logs
  ADD COLUMN IF NOT EXISTS trip_type TEXT NOT NULL DEFAULT 'OUTBOUND';

ALTER TABLE gps_trip_logs
  DROP CONSTRAINT IF EXISTS gps_trip_logs_trip_type_check;

ALTER TABLE gps_trip_logs
  ADD CONSTRAINT gps_trip_logs_trip_type_check
    CHECK (trip_type IN ('OUTBOUND', 'RETURN'));

CREATE INDEX IF NOT EXISTS idx_gps_trip_logs_vehicle_trip_type_departure
  ON gps_trip_logs (vehicle_id, trip_type, departure_time_gps);

CREATE INDEX IF NOT EXISTS idx_gps_trip_logs_vehicle_trip_type_arrival
  ON gps_trip_logs (vehicle_id, trip_type, arrival_time_gps);

CREATE INDEX IF NOT EXISTS idx_gps_trip_logs_vehicle_date_trip_type
  ON gps_trip_logs (vehicle_id, trip_date, trip_type);

-- If destination_verified / location_name were added in 023 but the
-- CHECK was missing, ensure it's also present:
ALTER TABLE gps_trip_logs
  ADD COLUMN IF NOT EXISTS destination_verified BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE gps_trip_logs
  ADD COLUMN IF NOT EXISTS location_name TEXT DEFAULT NULL;
-- Migration 025: Add missing columns to gps_trip_logs that were
-- introduced in migrations 023 and 024 but never applied.

-- Trip type (for OUTBOUND / RETURN tracking)
ALTER TABLE gps_trip_logs
  ADD COLUMN IF NOT EXISTS trip_type TEXT NOT NULL DEFAULT 'OUTBOUND';

ALTER TABLE gps_trip_logs
  DROP CONSTRAINT IF EXISTS gps_trip_logs_trip_type_check;

ALTER TABLE gps_trip_logs
  ADD CONSTRAINT gps_trip_logs_trip_type_check
    CHECK (trip_type IN ('OUTBOUND', 'RETURN'));

-- Parent trip reference (for round-trip tracking)
ALTER TABLE gps_trip_logs
  ADD COLUMN IF NOT EXISTS parent_trip_id UUID REFERENCES gps_trip_logs(id) ON DELETE SET NULL;

-- Destination verification flag
ALTER TABLE gps_trip_logs
  ADD COLUMN IF NOT EXISTS destination_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Auto-populated location name
ALTER TABLE gps_trip_logs
  ADD COLUMN IF NOT EXISTS location_name TEXT DEFAULT NULL;

-- Coordinates (origin & destination)
ALTER TABLE gps_trip_logs
  ADD COLUMN IF NOT EXISTS coordinates_origin VARCHAR,
  ADD COLUMN IF NOT EXISTS coordinates_destination VARCHAR;

-- Indexes for return trip lookups
CREATE INDEX IF NOT EXISTS idx_gps_trip_logs_parent_trip_id
  ON gps_trip_logs (parent_trip_id);

CREATE INDEX IF NOT EXISTS idx_gps_trip_logs_trip_type
  ON gps_trip_logs (trip_type);

CREATE INDEX IF NOT EXISTS idx_gps_trip_logs_vehicle_trip_type_departure
  ON gps_trip_logs (vehicle_id, trip_type, departure_time_gps);

CREATE INDEX IF NOT EXISTS idx_gps_trip_logs_vehicle_trip_type_arrival
  ON gps_trip_logs (vehicle_id, trip_type, arrival_time_gps);

CREATE INDEX IF NOT EXISTS idx_gps_trip_logs_vehicle_date_trip_type
  ON gps_trip_logs (vehicle_id, trip_date, trip_type);

-- Comments
COMMENT ON COLUMN gps_trip_logs.trip_type IS 'OUTBOUND for forward trip, RETURN for return trip';
COMMENT ON COLUMN gps_trip_logs.parent_trip_id IS 'References the parent OUTBOUND trip for a RETURN trip';
COMMENT ON COLUMN gps_trip_logs.destination_verified IS 'Whether the destination was verified against the travel order';
COMMENT ON COLUMN gps_trip_logs.location_name IS 'Auto-populated location name from destination verification';
COMMENT ON COLUMN gps_trip_logs.coordinates_origin IS 'Origin coordinates in "latitude,longitude" format';
COMMENT ON COLUMN gps_trip_logs.coordinates_destination IS 'Destination coordinates in "latitude,longitude" format';
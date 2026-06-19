-- Migration 023: Enhanced trip detection fields for gps_trip_logs
-- Supports idling-based arrival detection, destination verification,
-- return trip detection, and location auto-population.

-- Trip type and parent relationship for round-trip tracking
ALTER TABLE gps_trip_logs
  ADD COLUMN IF NOT EXISTS trip_type TEXT NOT NULL DEFAULT 'OUTBOUND'
    CHECK (trip_type IN ('OUTBOUND', 'RETURN'));

ALTER TABLE gps_trip_logs
  ADD COLUMN IF NOT EXISTS parent_trip_id UUID REFERENCES gps_trip_logs(id) ON DELETE SET NULL;

-- Destination verification flag
ALTER TABLE gps_trip_logs
  ADD COLUMN IF NOT EXISTS destination_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Auto-populated location name (from destination verification fallback)
ALTER TABLE gps_trip_logs
  ADD COLUMN IF NOT EXISTS location_name TEXT DEFAULT NULL;

-- Indexes for return trip lookups
CREATE INDEX IF NOT EXISTS idx_gps_trip_logs_parent_trip_id
  ON gps_trip_logs (parent_trip_id);

CREATE INDEX IF NOT EXISTS idx_gps_trip_logs_trip_type
  ON gps_trip_logs (trip_type);
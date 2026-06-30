-- ── GPS Telemetry Trip Cycle Tracking ──────────────────────────
--
-- Links raw telemetry rows to one ignition cycle:
--   1 IGNITION ON + many LOCATION_UPDATE + 1 IGNITION OFF.
--
-- The partial unique index prevents duplicate ignition boundary
-- events inside the same active trip while still allowing many
-- location updates.

ALTER TABLE gps_telemetry
  ADD COLUMN IF NOT EXISTS active_trip_id UUID;

CREATE INDEX IF NOT EXISTS idx_gps_telemetry_active_trip
  ON gps_telemetry (vehicle_id, active_trip_id, recorded_at DESC)
  WHERE active_trip_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_gps_telemetry_unique_trip_event
  ON gps_telemetry (vehicle_id, active_trip_id, event_type)
  WHERE event_type IN ('IGNITION ON', 'IGNITION OFF')
    AND active_trip_id IS NOT NULL;

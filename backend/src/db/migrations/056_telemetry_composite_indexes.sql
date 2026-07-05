-- Composite indexes for telemetry query performance
-- Speeds up scheduler and dashboard queries that filter by vehicle + time + event type

-- Primary telemetry lookup: vehicle + recorded_at + event_type
CREATE INDEX IF NOT EXISTS idx_gps_telemetry_vehicle_recorded_event
  ON gps_telemetry (vehicle_id, recorded_at DESC, event_type);

-- Location update deduplication: vehicle + trip + location_name
CREATE INDEX IF NOT EXISTS idx_gps_telemetry_vehicle_trip_location
  ON gps_telemetry (vehicle_id, active_trip_id, event_type)
  WHERE active_trip_id IS NOT NULL;

-- Latest event lookup for ignition/trip tracking
CREATE INDEX IF NOT EXISTS idx_gps_telemetry_vehicle_latest
  ON gps_telemetry (vehicle_id, recorded_at DESC)
  WHERE active_trip_id IS NOT NULL;

-- Idling dedup lookup (already exists in scheduler code, but ensure consistent naming)
CREATE INDEX IF NOT EXISTS idx_gps_idling_dedup_vehicle_trip_active
  ON gps_idling_dedup (vehicle_id, active_trip_id, is_active)
  WHERE is_active = true;

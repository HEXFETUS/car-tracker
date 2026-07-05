-- Child records for telemetry-first GPS trip destinations/stops.

CREATE TABLE IF NOT EXISTS gps_trip_log_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gps_trip_log_id UUID NOT NULL REFERENCES gps_trip_logs(id) ON DELETE CASCADE,
  active_trip_id UUID,
  vehicle_id UUID NOT NULL,
  stop_order INTEGER NOT NULL,
  stop_type TEXT NOT NULL DEFAULT 'DESTINATION',
  location_name TEXT NOT NULL,
  coordinates TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  arrived_at TIMESTAMPTZ NOT NULL,
  idle_minutes NUMERIC,
  telemetry_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gps_trip_log_id, stop_order)
);

CREATE INDEX IF NOT EXISTS idx_gps_trip_log_stops_log_order
  ON gps_trip_log_stops (gps_trip_log_id, stop_order);

CREATE INDEX IF NOT EXISTS idx_gps_trip_log_stops_vehicle_active_trip
  ON gps_trip_log_stops (vehicle_id, active_trip_id);

-- ── Dashboard Performance Indexes ─────────────────────────────
--
-- Supports split dashboard endpoints and latest-telemetry lookups.

CREATE INDEX IF NOT EXISTS idx_gps_telemetry_vehicle_recorded_desc
  ON gps_telemetry (vehicle_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_gps_telemetry_recorded_vehicle_desc
  ON gps_telemetry (recorded_at DESC, vehicle_id);

CREATE INDEX IF NOT EXISTS idx_gps_trip_logs_driver_id
  ON gps_trip_logs (driver_id);

CREATE INDEX IF NOT EXISTS idx_gps_trip_logs_arrival_time
  ON gps_trip_logs (arrival_time_gps DESC);

CREATE INDEX IF NOT EXISTS idx_travel_orders_status_departure
  ON travel_orders (status, scheduled_departure DESC);

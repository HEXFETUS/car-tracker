-- Link active-trip telemetry directly to Travel Orders once a confident match exists.

ALTER TABLE gps_telemetry
  ADD COLUMN IF NOT EXISTS travel_order_id UUID REFERENCES travel_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gps_telemetry_active_trip_travel_order
  ON gps_telemetry (active_trip_id, travel_order_id)
  WHERE active_trip_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gps_trip_logs_vehicle_active_unlinked
  ON gps_trip_logs (vehicle_id, departure_time_gps DESC)
  WHERE active_trip_id IS NOT NULL
    AND travel_order_id IS NULL;

-- Supabase PostgreSQL Migration: GPS Trip Logs Table
-- Upstream: car-tracker backend
--
-- Ingested tracking metrics capturing route deviations and
-- telemetry snapshots.  Each log can optionally link back to
-- a travel_order via travel_order_id.

CREATE TABLE IF NOT EXISTS gps_trip_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gps_record_no         TEXT NOT NULL UNIQUE,
  trip_date             DATE NOT NULL,
  vehicle_id            UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  driver_id             UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  origin_gps_start_point     TEXT NOT NULL DEFAULT '',
  destination_gps_end_point  TEXT NOT NULL DEFAULT '',
  actual_route_road_taken    TEXT NOT NULL DEFAULT '',
  departure_time_gps         TIMESTAMPTZ,
  arrival_time_gps           TIMESTAMPTZ,
  gps_distance_km            NUMERIC(10,2) DEFAULT 0,
  engine_hours               NUMERIC(8,2) DEFAULT 0,
  max_speed_kph              NUMERIC(6,2) DEFAULT 0,
  trip_status_gps            TEXT NOT NULL DEFAULT 'departed'
                              CHECK (trip_status_gps IN ('departed','en-route','arrived','cancelled','completed')),
  travel_order_id            UUID REFERENCES travel_orders(id) ON DELETE SET NULL,
  to_status_auto             TEXT,
  anomaly_flag               BOOLEAN NOT NULL DEFAULT FALSE,
  notes_remarks              TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger function to auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_gps_trip_logs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_gps_trip_logs_updated_at
  BEFORE UPDATE ON gps_trip_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_gps_trip_logs_updated_at();

-- Indexes for common filters
CREATE INDEX idx_gps_trip_logs_trip_date     ON gps_trip_logs (trip_date);
CREATE INDEX idx_gps_trip_logs_vehicle_id    ON gps_trip_logs (vehicle_id);
CREATE INDEX idx_gps_trip_logs_driver_id     ON gps_trip_logs (driver_id);
CREATE INDEX idx_gps_trip_logs_anomaly_flag  ON gps_trip_logs (anomaly_flag);
CREATE INDEX idx_gps_trip_logs_travel_order_id ON gps_trip_logs (travel_order_id);
-- Separate GPS movement logs that completed without a matched Travel Order.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS gps_no_to_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  no_to_record_no TEXT UNIQUE NOT NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
  travel_order_id UUID REFERENCES travel_orders(id) ON DELETE SET NULL,
  linked_to_number TEXT,
  trip_date DATE NOT NULL,
  origin_address TEXT,
  origin_coordinates TEXT,
  destination_address TEXT,
  destination_coordinates TEXT,
  departure_time TIMESTAMP WITHOUT TIME ZONE,
  arrival_time TIMESTAMP WITHOUT TIME ZONE,
  distance_km NUMERIC(10,2),
  engine_hours NUMERIC(10,2),
  moving_hours NUMERIC(10,2),
  max_speed_kph NUMERIC(5,2),
  status TEXT NOT NULL DEFAULT 'unmatched',
  anomaly_flag BOOLEAN NOT NULL DEFAULT true,
  anomaly_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT current_timestamp,
  linked_at TIMESTAMPTZ,
  converted_gps_trip_log_id UUID REFERENCES gps_trip_logs(id) ON DELETE SET NULL
);

ALTER TABLE gps_no_to_logs
  DROP CONSTRAINT IF EXISTS gps_no_to_logs_status_check;

ALTER TABLE gps_no_to_logs
  ADD CONSTRAINT gps_no_to_logs_status_check
    CHECK (status IN ('unmatched', 'linked', 'converted', 'dismissed'));

CREATE INDEX IF NOT EXISTS idx_gps_no_to_logs_vehicle_date
  ON gps_no_to_logs (vehicle_id, trip_date DESC);

CREATE INDEX IF NOT EXISTS idx_gps_no_to_logs_status
  ON gps_no_to_logs (status, trip_date DESC);

CREATE TABLE IF NOT EXISTS gps_no_to_log_active_trips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gps_no_to_log_id UUID NOT NULL REFERENCES gps_no_to_logs(id) ON DELETE CASCADE,
  active_trip_id UUID NOT NULL,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT current_timestamp,
  UNIQUE (gps_no_to_log_id, active_trip_id)
);

CREATE INDEX IF NOT EXISTS idx_gps_no_to_log_active_trips_log
  ON gps_no_to_log_active_trips (gps_no_to_log_id);

CREATE INDEX IF NOT EXISTS idx_gps_no_to_log_active_trips_active_trip
  ON gps_no_to_log_active_trips (active_trip_id);

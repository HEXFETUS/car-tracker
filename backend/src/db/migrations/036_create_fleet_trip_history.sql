-- ───────────────────────────────────────────────────────────────
-- Create fleet_trip_history table
-- Stores meaningful Fleet GPS trip history events after intelligent filtering
-- ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet_trip_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  travel_order_id UUID NULL,
  vehicle_id UUID NULL,
  driver_id UUID NULL,
  fleet_trip_id TEXT NULL,
  event_time TIMESTAMP NOT NULL,
  trip_date DATE,
  status TEXT NOT NULL,
  event TEXT,
  road_speed NUMERIC,
  location TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  fuel NUMERIC,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ── Indexes ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fleet_trip_history_travel_order_id ON fleet_trip_history (travel_order_id);
CREATE INDEX IF NOT EXISTS idx_fleet_trip_history_vehicle_id ON fleet_trip_history (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fleet_trip_history_event_time ON fleet_trip_history (event_time);
CREATE INDEX IF NOT EXISTS idx_fleet_trip_history_status ON fleet_trip_history (status);
CREATE INDEX IF NOT EXISTS idx_fleet_trip_history_trip_date ON fleet_trip_history (trip_date);

-- Composite unique constraint to prevent duplicate synchronization
CREATE UNIQUE INDEX IF NOT EXISTS idx_fleet_trip_history_dedup
  ON fleet_trip_history (vehicle_id, event_time, latitude, longitude, status);
-- Supabase PostgreSQL Migration: Vehicles Table
-- Upstream: car-tracker backend

CREATE TABLE IF NOT EXISTS vehicles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number TEXT NOT NULL UNIQUE,
  make         TEXT NOT NULL,
  model        TEXT NOT NULL,
  year         INTEGER NOT NULL,
  color        TEXT,
  vehicle_type TEXT,
  fuel_type    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger function to auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_vehicles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_vehicles_updated_at
  BEFORE UPDATE ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicles_updated_at();

-- Index on plate_number (unique constraint already indexed)
CREATE INDEX idx_vehicles_make ON vehicles (make);
CREATE INDEX idx_vehicles_year ON vehicles (year);
CREATE INDEX idx_vehicles_fuel_type ON vehicles (fuel_type);
-- Supabase PostgreSQL Migration: Maintenance Table
-- Upstream: car-tracker backend

CREATE TABLE IF NOT EXISTS maintenance (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id   UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  service_type TEXT NOT NULL,
  cost         NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  date         DATE NOT NULL,
  remarks      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger function to auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_maintenance_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_maintenance_updated_at
  BEFORE UPDATE ON maintenance
  FOR EACH ROW
  EXECUTE FUNCTION update_maintenance_updated_at();

-- Indexes for common lookups
CREATE INDEX idx_maintenance_vehicle_id ON maintenance (vehicle_id);
CREATE INDEX idx_maintenance_date      ON maintenance (date);
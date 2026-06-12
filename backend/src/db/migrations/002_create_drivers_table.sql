-- Supabase PostgreSQL Migration: Drivers Table
-- Upstream: car-tracker backend

CREATE TABLE IF NOT EXISTS drivers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       TEXT NOT NULL,
  phone           TEXT NOT NULL,
  email           TEXT NOT NULL,
  address         TEXT,
  license_number  TEXT NOT NULL,
  expiry_date     DATE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger function to auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_drivers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_drivers_updated_at
  BEFORE UPDATE ON drivers
  FOR EACH ROW
  EXECUTE FUNCTION update_drivers_updated_at();

-- Indexes for commonly queried fields
CREATE INDEX idx_drivers_full_name ON drivers (full_name);
CREATE INDEX idx_drivers_license_number ON drivers (license_number);
CREATE INDEX idx_drivers_email ON drivers (email);
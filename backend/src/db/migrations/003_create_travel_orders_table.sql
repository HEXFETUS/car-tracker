-- Supabase PostgreSQL Migration: Travel Orders Table
-- Upstream: car-tracker backend
--
-- Core workflow tracker: each row represents a dispatch order
-- assigning a vehicle + driver to a specific route with schedule
-- timelines and approval status.

CREATE TABLE IF NOT EXISTS travel_orders (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_number                 TEXT NOT NULL,
  vehicle_id                UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  driver_id                 UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  origin_location           TEXT NOT NULL DEFAULT '',
  destination_location      TEXT NOT NULL DEFAULT '',
  scheduled_departure_at    TIMESTAMPTZ,
  scheduled_arrival_at      TIMESTAMPTZ,
  actual_departure_at       TIMESTAMPTZ,
  actual_arrival_at         TIMESTAMPTZ,
  status                    TEXT NOT NULL DEFAULT 'PENDING'
                              CHECK (status IN ('PENDING','APPROVED','ACTIVE','COMPLETED','CANCELLED')),
  purpose                   TEXT,
  notes                     TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint on the human-readable travel order number
CREATE UNIQUE INDEX IF NOT EXISTS idx_travel_orders_to_number ON travel_orders (to_number);

-- Trigger function to auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_travel_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_travel_orders_updated_at
  BEFORE UPDATE ON travel_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_travel_orders_updated_at();

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_travel_orders_vehicle_id   ON travel_orders (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_travel_orders_driver_id    ON travel_orders (driver_id);
CREATE INDEX IF NOT EXISTS idx_travel_orders_status       ON travel_orders (status);
CREATE INDEX IF NOT EXISTS idx_travel_orders_scheduled_departure ON travel_orders (scheduled_departure_at);

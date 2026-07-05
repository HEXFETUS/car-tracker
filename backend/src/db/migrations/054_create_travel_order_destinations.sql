-- Migration 054: Create travel_order_destinations table
-- Supports multiple destination stops per travel order
-- The last destination (highest stop_order) is the final destination
-- and is synced to travel_orders.destination_target / lat_long_destination / location_name

CREATE TABLE IF NOT EXISTS travel_order_destinations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  travel_order_id   UUID NOT NULL REFERENCES travel_orders(id) ON DELETE CASCADE,
  stop_order        INTEGER NOT NULL,
  location_name     TEXT NOT NULL,
  address           TEXT,
  lat_long          TEXT,
  notes             TEXT,
  estimated_arrival TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforce unique stop_order per travel order
CREATE UNIQUE INDEX IF NOT EXISTS idx_tod_travel_order_stop_order
  ON travel_order_destinations (travel_order_id, stop_order);

-- Index for fetching destinations by travel order
CREATE INDEX IF NOT EXISTS idx_tod_travel_order_id
  ON travel_order_destinations (travel_order_id);

-- Index for ordering stops
CREATE INDEX IF NOT EXISTS idx_tod_stop_order
  ON travel_order_destinations (travel_order_id, stop_order);
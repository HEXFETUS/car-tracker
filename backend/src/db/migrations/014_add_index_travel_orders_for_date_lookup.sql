-- Migration 014: Add composite index for faster travel order date-range lookups
-- This supports querying multiple travel orders for the same vehicle/date combination
-- when matching GPS trips to the correct travel order based on ignition timing.

CREATE INDEX IF NOT EXISTS idx_travel_orders_vehicle_date_range
  ON travel_orders (vehicle_id, scheduled_departure_at, scheduled_arrival_at);

CREATE INDEX IF NOT EXISTS idx_travel_orders_driver_date_range
  ON travel_orders (driver_id, scheduled_departure_at, scheduled_arrival_at);
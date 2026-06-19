-- Migration 028: Convert scheduled_departure and scheduled_arrival
-- from `timestamp with time zone` to `timestamp without time zone`
-- so Philippine wall-clock time is stored and returned exactly.

-- Convert existing UTC instants into Philippine local time first,
-- then change the column type so future inserts are treated as local time.
ALTER TABLE travel_orders
  ALTER COLUMN scheduled_departure TYPE timestamp without time zone
  USING scheduled_departure AT TIME ZONE 'Asia/Manila';

ALTER TABLE travel_orders
  ALTER COLUMN scheduled_arrival TYPE timestamp without time zone
  USING scheduled_arrival AT TIME ZONE 'Asia/Manila';
-- Migration 014: Add composite index for faster travel order date-range lookups
-- This supports querying multiple travel orders for the same vehicle/date combination
-- when matching GPS trips to the correct travel order based on ignition timing.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'travel_orders'
       AND column_name = 'scheduled_departure_at'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_travel_orders_vehicle_date_range
      ON travel_orders (vehicle_id, scheduled_departure_at, scheduled_arrival_at);

    CREATE INDEX IF NOT EXISTS idx_travel_orders_driver_date_range
      ON travel_orders (driver_id, scheduled_departure_at, scheduled_arrival_at);
  ELSE
    CREATE INDEX IF NOT EXISTS idx_travel_orders_vehicle_date_range
      ON travel_orders (vehicle_id, scheduled_departure, scheduled_arrival);

    CREATE INDEX IF NOT EXISTS idx_travel_orders_driver_date_range
      ON travel_orders (driver_id, scheduled_departure, scheduled_arrival);
  END IF;
END $$;

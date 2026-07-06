-- Drop travel_order_no column from gps_telemetry.
-- travel_order_id (UUID) is the single source of truth.
-- The TO number is obtained by JOINing to travel_orders.to_number.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'gps_telemetry'
       AND column_name = 'travel_order_no'
  ) THEN
    ALTER TABLE gps_telemetry DROP COLUMN travel_order_no;
  END IF;
END $$;

-- Also drop any leftover to_number column that may have existed before 064
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'gps_telemetry'
       AND column_name = 'to_number'
  ) THEN
    ALTER TABLE gps_telemetry DROP COLUMN to_number;
  END IF;
END $$;
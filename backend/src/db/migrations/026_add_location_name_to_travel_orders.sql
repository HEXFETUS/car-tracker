-- Migration 026: Add location_name to travel_orders for GPS trip matching.
-- Existing databases may have destination_target instead of the newer
-- destination/location naming used by the sync service.

ALTER TABLE travel_orders
  ADD COLUMN IF NOT EXISTS location_name TEXT DEFAULT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'travel_orders'
       AND column_name = 'destination_location'
  ) THEN
    UPDATE travel_orders
       SET location_name = COALESCE(NULLIF(location_name, ''), NULLIF(destination_location, ''))
     WHERE location_name IS NULL OR location_name = '';
  ELSIF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'travel_orders'
       AND column_name = 'destination_target'
  ) THEN
    UPDATE travel_orders
       SET location_name = COALESCE(NULLIF(location_name, ''), NULLIF(destination_target, ''))
     WHERE location_name IS NULL OR location_name = '';
  END IF;
END $$;

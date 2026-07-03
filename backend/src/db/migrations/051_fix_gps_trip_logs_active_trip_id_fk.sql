-- ── Fix FK Constraint on gps_trip_logs.active_trip_id ──────────
--
-- The gps_trip_logs.active_trip_id column stores a trip/session UUID
-- from gps_telemetry.active_trip_id (e.g. "3cbaaf32-818a-47a3-a281-fe42a6a2d4d2").
-- It should NOT reference gps_telemetry.id, because one active_trip_id
-- spans many gps_telemetry rows (one full IGNITION_ON→OFF cycle).
--
-- This migration:
--   1. Drops the wrong FK constraint gps_trip_logs_active_trip_id_fkey
--      if it references gps_telemetry.id (or any other table).
--   2. Keeps gps_trip_logs.active_trip_id as UUID nullable.
--   3. Adds an index on active_trip_id.
--   4. Adds a unique partial index on active_trip_id WHERE NOT NULL
--      to prevent duplicate trip log rows for the same active trip.
--   5. Does NOT add a FK constraint — active_trip_id is a value copy,
--      not a relational pointer.
--
-- Migration 046 already added the column + indexes, but if a FK
-- was added later (e.g. via Supabase UI or a previous migration),
-- we drop it here.

-- 1. Drop the wrong FK if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = 'gps_trip_logs'
      AND kcu.column_name = 'active_trip_id'
  ) THEN
    ALTER TABLE gps_trip_logs
      DROP CONSTRAINT gps_trip_logs_active_trip_id_fkey;
    RAISE NOTICE 'Dropped FK constraint gps_trip_logs_active_trip_id_fkey';
  ELSE
    RAISE NOTICE 'FK constraint gps_trip_logs_active_trip_id_fkey does not exist, skipping drop';
  END IF;
END $$;

-- 2. Ensure column is UUID nullable (migration 046 already does this,
--    but IF NOT EXISTS makes it idempotent)
ALTER TABLE gps_trip_logs
  ADD COLUMN IF NOT EXISTS active_trip_id UUID;

-- 3. Ensure index on active_trip_id exists
CREATE INDEX IF NOT EXISTS idx_gps_trip_logs_active_trip_id
  ON gps_trip_logs(active_trip_id);

-- 4. Ensure unique partial index on active_trip_id WHERE NOT NULL
--    (prevents duplicate trip log rows for the same active trip)
CREATE UNIQUE INDEX IF NOT EXISTS uq_gps_trip_logs_active_trip_id
  ON gps_trip_logs(active_trip_id)
  WHERE active_trip_id IS NOT NULL;

-- 5. Verify there is NO FK on active_trip_id
DO $$
DECLARE
  fk_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO fk_count
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name = 'gps_trip_logs'
    AND kcu.column_name = 'active_trip_id';

  IF fk_count > 0 THEN
    RAISE EXCEPTION 'FK constraint still exists on gps_trip_logs.active_trip_id after migration — manual intervention required';
  END IF;

  RAISE NOTICE 'Verified: no FK constraint on gps_trip_logs.active_trip_id';
END $$;
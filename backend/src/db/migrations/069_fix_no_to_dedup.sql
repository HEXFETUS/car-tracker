-- ── Fix: Prevent duplicate gps_no_to_logs for the same active trip ──
--
-- Problem:
--   gps_no_to_logs was creating duplicate records for the same active trip
--   because the upsert lookup relied on the gps_no_to_log_active_trips
--   junction table. When a trip had multiple active_trip_id values (e.g.,
--   from PAUSED/RESUMED cycles), the lookup searched for the *new*
--   active_trip_id in the junction table, but the existing row only had
--   the *original* active_trip_id. This caused a new row to be inserted
--   instead of updating the existing one.
--
-- Fix:
--   1. Add active_trip_id directly to gps_no_to_logs for direct lookup
--   2. Backfill from gps_no_to_log_active_trips
--   3. Add unique index to prevent duplicates at DB level
--   4. Clean up existing duplicates

-- ── Step 1: Add active_trip_id and updated_at columns ──
ALTER TABLE gps_no_to_logs
  ADD COLUMN IF NOT EXISTS active_trip_id UUID;

ALTER TABLE gps_no_to_logs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT current_timestamp;

-- Populate updated_at with created_at for existing rows (used for dedup ordering)
UPDATE gps_no_to_logs SET updated_at = created_at WHERE updated_at IS NULL;

-- ── Step 2: Backfill from junction table ──
-- Prefer the earliest (first) active_trip_id associated with each no-TO log
UPDATE gps_no_to_logs n
SET active_trip_id = sub.first_active_trip_id
FROM (
  SELECT DISTINCT ON (nat.gps_no_to_log_id)
    nat.gps_no_to_log_id,
    nat.active_trip_id AS first_active_trip_id
  FROM gps_no_to_log_active_trips nat
  ORDER BY nat.gps_no_to_log_id, nat.created_at ASC, nat.id ASC
) sub
WHERE n.id = sub.gps_no_to_log_id
  AND n.active_trip_id IS NULL;

-- ── Step 3: Cleanup duplicate gps_no_to_logs ──
-- Strategy:
--   For duplicates grouped by active_trip_id:
--     - Keep the COMPLETED row if one exists
--     - Otherwise keep the latest updated/created row
--     - Preserve the lowest/original no_to_record_no if possible
--   For duplicates without active_trip_id:
--     - Group by vehicle_id + departure_time + origin_coordinates + candidate_destination_coordinates

-- 3a: Delete duplicates grouped by active_trip_id
WITH duplicates AS (
  SELECT
    id,
    active_trip_id,
    no_to_record_no,
    business_trip_status,
    created_at,
    updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY active_trip_id
      ORDER BY
        -- Prefer COMPLETED rows
        CASE WHEN business_trip_status = 'COMPLETED' THEN 0 ELSE 1 END,
        -- Then prefer the latest updated/created
        COALESCE(updated_at, created_at) DESC,
        -- Then prefer the lowest no_to_record_no
        no_to_record_no ASC
    ) AS rn
  FROM gps_no_to_logs
  WHERE active_trip_id IS NOT NULL
),
to_delete AS (
  SELECT id FROM duplicates WHERE rn > 1
)
DELETE FROM gps_no_to_logs n
USING to_delete d
WHERE n.id = d.id;

-- 3b: Delete duplicates without active_trip_id, grouped by fallback fields
WITH duplicates AS (
  SELECT
    id,
    vehicle_id,
    departure_time,
    origin_coordinates,
    candidate_destination_coordinates,
    no_to_record_no,
    business_trip_status,
    created_at,
    updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY vehicle_id, departure_time, origin_coordinates, candidate_destination_coordinates
      ORDER BY
        CASE WHEN business_trip_status = 'COMPLETED' THEN 0 ELSE 1 END,
        COALESCE(updated_at, created_at) DESC,
        no_to_record_no ASC
    ) AS rn
  FROM gps_no_to_logs
  WHERE active_trip_id IS NULL
    AND vehicle_id IS NOT NULL
    AND departure_time IS NOT NULL
    AND origin_coordinates IS NOT NULL
    AND candidate_destination_coordinates IS NOT NULL
),
to_delete AS (
  SELECT id FROM duplicates WHERE rn > 1
)
DELETE FROM gps_no_to_logs n
USING to_delete d
WHERE n.id = d.id;

-- ── Step 4: Add unique index ──
-- This prevents future duplicates at the database level
CREATE UNIQUE INDEX IF NOT EXISTS uq_gps_no_to_logs_active_trip
  ON gps_no_to_logs(active_trip_id)
  WHERE active_trip_id IS NOT NULL;

-- ── Step 5: Add index for fallback dedup lookup ──
CREATE INDEX IF NOT EXISTS idx_gps_no_to_logs_dedup_fallback
  ON gps_no_to_logs(vehicle_id, departure_time, origin_coordinates, candidate_destination_coordinates)
  WHERE active_trip_id IS NULL;
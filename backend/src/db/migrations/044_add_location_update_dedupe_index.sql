-- ── GPS Telemetry LOCATION UPDATE Deduplication ──────────────
--
-- Adds a partial unique index on gps_telemetry to prevent duplicate
-- LOCATION UPDATE rows for the same vehicle at the same rounded
-- coordinates within the same minute.
--
-- Uses trunc() with multiplication instead of ROUND(numeric) because
-- ROUND(numeric) is not IMMUTABLE (numeric cast depends on session).
-- trunc(float8) IS immutable.
--
-- Run this migration manually:
--   psql -f 044_add_location_update_dedupe_index.sql

-- Step 1: Clean up existing duplicates (keep only the newest row per minute/coords)
DELETE FROM gps_telemetry a
USING gps_telemetry b
WHERE a.event_type = 'LOCATION_UPDATE'
  AND b.event_type = 'LOCATION_UPDATE'
  AND a.vehicle_id = b.vehicle_id
  AND trunc(a.latitude * 100000) = trunc(b.latitude * 100000)
  AND trunc(a.longitude * 100000) = trunc(b.longitude * 100000)
  AND date_trunc('minute', a.recorded_at) = date_trunc('minute', b.recorded_at)
  AND a.created_at < b.created_at;

-- Step 2: Create the partial unique index using immutable expressions
CREATE UNIQUE INDEX IF NOT EXISTS gps_telemetry_location_update_dedupe_idx
ON gps_telemetry (
  vehicle_id,
  event_type,
  trunc(latitude * 100000),
  trunc(longitude * 100000),
  floor(extract(epoch from recorded_at AT TIME ZONE 'UTC') / 60)
)
WHERE event_type = 'LOCATION_UPDATE';

-- Step 3: Verify no duplicates remain
SELECT vehicle_id, plate_number, trunc(latitude * 100000) AS lat_r5, trunc(longitude * 100000) AS lng_r5, date_trunc('minute', recorded_at) AS minute_bucket, COUNT(*)
FROM gps_telemetry
WHERE event_type = 'LOCATION_UPDATE'
GROUP BY vehicle_id, plate_number, trunc(latitude * 100000), trunc(longitude * 100000), date_trunc('minute', recorded_at)
HAVING COUNT(*) > 1;

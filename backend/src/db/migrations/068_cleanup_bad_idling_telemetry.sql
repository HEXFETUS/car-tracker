-- ── Cleanup: Remove non-threshold IDLING_TOO_LONG rows ──────────
--
-- Problem:
--   Due to the dedup bug, IDLING_TOO_LONG rows were saved at every
--   polling cycle (e.g., 12, 13, 14, 15... minutes) instead of only
--   at valid thresholds (10, 25, 55, 85, 115...).
--
-- Fix:
--   Delete IDLING_TOO_LONG rows where the calculated threshold does
--   not match any valid threshold, for the same vehicle_id + active_trip_id.
--   Keep the first occurrence at each threshold (the one with the
--   earliest recorded_at for each vehicle_id + active_trip_id + threshold).

-- Valid idling thresholds: 10, 25, then every +30: 55, 85, 115, 145...
-- We'll calculate what the threshold *should* have been and only keep
-- rows that match a valid threshold.

WITH bad_rows AS (
  SELECT id, vehicle_id, active_trip_id, recorded_at, event_type, speed_kmh,
    -- Calculate nearest valid threshold based on relative position
    CASE
      WHEN speed_kmh = 10 THEN 10
      WHEN speed_kmh = 25 THEN 25
      WHEN speed_kmh >= 55 AND ((speed_kmh - 25)::integer) % 30 = 0 THEN speed_kmh
      ELSE NULL
    END as valid_threshold
  FROM gps_telemetry
  WHERE event_type IN ('IDLING_TOO_LONG', 'IDLING', 'IDLING ALERT', 'IDLING TOO LONG ALERT')
    AND speed_kmh IS NOT NULL
    AND speed_kmh > 0
)
DELETE FROM gps_telemetry g
USING bad_rows b
WHERE g.id = b.id
  AND b.valid_threshold IS NULL
  AND b.speed_kmh NOT IN (10, 25, 55, 85, 115, 145, 175, 205, 235, 265, 295, 325, 355, 385, 415, 445, 475, 505, 535, 565);

-- Keep only the first (earliest recorded_at) IDLING_TOO_LONG per
-- (vehicle_id, active_trip_id, valid_threshold) to remove intra-cycle duplicates
-- that slipped through due to race conditions.
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY vehicle_id, active_trip_id,
        CASE
          WHEN speed_kmh = 10 THEN 10
          WHEN speed_kmh = 25 THEN 25
          WHEN speed_kmh >= 55 AND ((speed_kmh - 25)::integer) % 30 = 0 THEN speed_kmh
          ELSE speed_kmh  -- keep non-thresholds that weren't deleted above
        END
      ORDER BY recorded_at ASC, created_at ASC
    ) as rn
  FROM gps_telemetry
  WHERE event_type IN ('IDLING_TOO_LONG', 'IDLING', 'IDLING ALERT', 'IDLING TOO LONG ALERT')
    AND speed_kmh IN (10, 25, 55, 85, 115, 145, 175, 205, 235, 265, 295, 325, 355, 385, 415, 445, 475, 505, 535, 565)
)
DELETE FROM gps_telemetry g
USING ranked r
WHERE g.id = r.id
  AND r.rn > 1;
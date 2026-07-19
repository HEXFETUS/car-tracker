-- A tracker active_trip_id may cover more than one origin-to-return journey.
-- Identify No-TO rows by the vehicle and the first telemetry timestamp instead.

DROP INDEX IF EXISTS uq_gps_no_to_logs_active_trip;

-- Parent links created from a shared active_trip_id can hide separate journeys.
UPDATE gps_no_to_logs
   SET parent_trip_id = NULL,
       updated_at = current_timestamp
 WHERE parent_trip_id IS NOT NULL;

-- Retain one canonical row for any exact journey duplicates. The normal No-TO
-- sync repopulates its active-trip sessions and telemetry-derived fields.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY vehicle_id, departure_time
           ORDER BY
             CASE WHEN status IN ('linked', 'converted') THEN 0 ELSE 1 END,
             CASE WHEN business_trip_status = 'COMPLETED' THEN 0 ELSE 1 END,
             COALESCE(updated_at, created_at) DESC,
             no_to_record_no ASC,
             id
         ) AS row_rank
    FROM gps_no_to_logs
   WHERE vehicle_id IS NOT NULL
     AND departure_time IS NOT NULL
)
DELETE FROM gps_no_to_logs log
 USING ranked duplicate
 WHERE log.id = duplicate.id
   AND duplicate.row_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gps_no_to_logs_journey_start
  ON gps_no_to_logs(vehicle_id, departure_time)
  WHERE vehicle_id IS NOT NULL AND departure_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gps_no_to_logs_active_trip
  ON gps_no_to_logs(active_trip_id)
  WHERE active_trip_id IS NOT NULL;

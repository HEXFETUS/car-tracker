-- Repair only strongly identified historical sessions that lifecycle matching
-- attached to an older travel order. The original "No TO" message proves the
-- device packet was not directly linked; manual/direct assignments are left
-- untouched.

CREATE TEMP TABLE gps_session_travel_order_repairs ON COMMIT DROP AS
WITH session_stats AS (
  SELECT
    gla.gps_trip_log_id AS source_log_id,
    gla.active_trip_id,
    source_log.vehicle_id,
    source_log.travel_order_id AS source_travel_order_id,
    source_order.scheduled_departure::date AS source_travel_date,
    MIN(gt.recorded_at) AS start_time,
    MAX(gt.recorded_at) AS end_time,
    (ARRAY_AGG(CONCAT(gt.latitude, ',', gt.longitude) ORDER BY gt.recorded_at))[1] AS start_coordinates,
    BOOL_OR(COALESCE(gt.telegram_message, '') ILIKE '%No TO%') AS originally_unlinked
  FROM gps_trip_log_active_trips gla
  JOIN gps_trip_logs source_log ON source_log.id = gla.gps_trip_log_id
  JOIN travel_orders source_order ON source_order.id = source_log.travel_order_id
  JOIN gps_telemetry gt
    ON gt.vehicle_id = source_log.vehicle_id
   AND gt.active_trip_id = gla.active_trip_id
  WHERE source_log.travel_order_id IS NOT NULL
    AND COALESCE(source_log.to_status_auto, '') <> 'manual'
  GROUP BY gla.gps_trip_log_id, gla.active_trip_id, source_log.vehicle_id,
           source_log.travel_order_id, source_order.scheduled_departure
), strong_candidates AS (
  SELECT
    stats.*,
    target_order.id AS target_travel_order_id,
    target_order.driver_id AS target_driver_id,
    target_log.id AS target_log_id,
    target_order.scheduled_departure::date AS target_travel_date,
    MIN(gt.recorded_at) FILTER (
      WHERE haversine_distance(
        target_order.lat_long_destination,
        CONCAT(gt.latitude, ',', gt.longitude)
      ) <= 250
    ) AS destination_reached_at,
    COUNT(*) OVER (PARTITION BY stats.active_trip_id) AS candidate_count
  FROM session_stats stats
  JOIN travel_orders target_order
    ON target_order.vehicle_id = stats.vehicle_id
   AND target_order.id <> stats.source_travel_order_id
   AND target_order.status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
   AND target_order.driver_id IS NOT NULL
   AND target_order.scheduled_departure::date = (stats.start_time AT TIME ZONE 'Asia/Manila')::date
   AND target_order.lat_long_origin IS NOT NULL
   AND target_order.lat_long_destination IS NOT NULL
  JOIN gps_trip_logs target_log
    ON target_log.travel_order_id = target_order.id
   AND COALESCE(target_log.to_status_auto, '') <> 'manual'
  JOIN gps_telemetry gt
    ON gt.vehicle_id = stats.vehicle_id
   AND gt.active_trip_id = stats.active_trip_id
  WHERE stats.originally_unlinked
    AND (stats.start_time AT TIME ZONE 'Asia/Manila')::date
        = (stats.end_time AT TIME ZONE 'Asia/Manila')::date
    AND stats.source_travel_date <> (stats.start_time AT TIME ZONE 'Asia/Manila')::date
    AND haversine_distance(target_order.lat_long_origin, stats.start_coordinates) <= 1500
  GROUP BY
    stats.source_log_id,
    stats.active_trip_id,
    stats.vehicle_id,
    stats.source_travel_order_id,
    stats.source_travel_date,
    stats.start_time,
    stats.end_time,
    stats.start_coordinates,
    stats.originally_unlinked,
    target_order.id,
    target_order.driver_id,
    target_order.scheduled_departure,
    target_log.id
  HAVING MIN(haversine_distance(
    target_order.lat_long_destination,
    CONCAT(gt.latitude, ',', gt.longitude)
  )) <= 250
)
SELECT
  source_log_id,
  target_log_id,
  active_trip_id,
  vehicle_id,
  target_travel_order_id,
  target_driver_id,
  target_travel_date,
  start_time,
  end_time,
  destination_reached_at
FROM strong_candidates
WHERE candidate_count = 1;

DELETE FROM gps_trip_log_active_trips gla
USING gps_session_travel_order_repairs repair
WHERE gla.gps_trip_log_id = repair.source_log_id
  AND gla.active_trip_id = repair.active_trip_id;

INSERT INTO gps_trip_log_active_trips
  (gps_trip_log_id, active_trip_id, start_time, end_time)
SELECT target_log_id, active_trip_id, start_time, end_time
FROM gps_session_travel_order_repairs
ON CONFLICT (gps_trip_log_id, active_trip_id)
DO UPDATE SET
  start_time = LEAST(gps_trip_log_active_trips.start_time, EXCLUDED.start_time),
  end_time = GREATEST(gps_trip_log_active_trips.end_time, EXCLUDED.end_time);

UPDATE gps_telemetry gt
SET travel_order_id = repair.target_travel_order_id,
    driver_id = repair.target_driver_id
FROM gps_session_travel_order_repairs repair
WHERE gt.vehicle_id = repair.vehicle_id
  AND gt.active_trip_id = repair.active_trip_id;

UPDATE gps_trip_logs target_log
SET driver_id = repair.target_driver_id,
    trip_date = repair.target_travel_date,
    departure_time_gps = repair.start_time,
    arrival_time_gps = repair.end_time,
    trip_status_gps = 'completed',
    business_trip_status = 'COMPLETED',
    destination_verified = TRUE,
    destination_reached_at = repair.destination_reached_at,
    returned_to_base_at = repair.end_time,
    anomaly_flag = FALSE,
    notes_remarks = NULL
FROM gps_session_travel_order_repairs repair
WHERE target_log.id = repair.target_log_id;

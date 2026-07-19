-- Move short base-only sessions that immediately precede a strongly repaired
-- route. They inherit the route's unambiguous travel-order match but cannot
-- qualify independently because they never leave the origin.

CREATE TEMP TABLE gps_companion_session_repairs ON COMMIT DROP AS
WITH target_routes AS (
  SELECT
    target_log.id AS target_log_id,
    target_log.vehicle_id,
    target_log.travel_order_id AS target_travel_order_id,
    target_order.driver_id AS target_driver_id,
    target_order.scheduled_departure::date AS target_travel_date,
    target_order.lat_long_origin,
    MIN(route_point.recorded_at) AS route_start,
    MAX(route_point.recorded_at) AS route_end
  FROM gps_trip_logs target_log
  JOIN travel_orders target_order ON target_order.id = target_log.travel_order_id
  JOIN gps_trip_log_active_trips target_session ON target_session.gps_trip_log_id = target_log.id
  JOIN gps_telemetry route_point
    ON route_point.vehicle_id = target_log.vehicle_id
   AND route_point.active_trip_id = target_session.active_trip_id
  WHERE target_order.status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
    AND COALESCE(target_log.to_status_auto, '') <> 'manual'
    AND target_order.lat_long_origin IS NOT NULL
    AND target_order.lat_long_destination IS NOT NULL
    AND COALESCE(route_point.telegram_message, '') ILIKE '%No TO%'
  GROUP BY target_log.id, target_order.id
  HAVING MIN(haversine_distance(
    target_order.lat_long_destination,
    CONCAT(route_point.latitude, ',', route_point.longitude)
  )) <= 250
), companion_stats AS (
  SELECT
    source_session.gps_trip_log_id AS source_log_id,
    source_session.active_trip_id,
    source_log.vehicle_id,
    source_order.scheduled_departure::date AS source_travel_date,
    MIN(companion_point.recorded_at) AS start_time,
    MAX(companion_point.recorded_at) AS end_time,
    BOOL_OR(COALESCE(companion_point.telegram_message, '') ILIKE '%No TO%') AS originally_unlinked,
    ARRAY_AGG(CONCAT(companion_point.latitude, ',', companion_point.longitude)) AS coordinates
  FROM gps_trip_log_active_trips source_session
  JOIN gps_trip_logs source_log ON source_log.id = source_session.gps_trip_log_id
  JOIN travel_orders source_order ON source_order.id = source_log.travel_order_id
  JOIN gps_telemetry companion_point
    ON companion_point.vehicle_id = source_log.vehicle_id
   AND companion_point.active_trip_id = source_session.active_trip_id
  WHERE COALESCE(source_log.to_status_auto, '') <> 'manual'
  GROUP BY source_session.gps_trip_log_id, source_session.active_trip_id,
           source_log.vehicle_id, source_order.scheduled_departure
), candidates AS (
  SELECT
    companion.*,
    target.target_log_id,
    target.target_travel_order_id,
    target.target_driver_id,
    target.target_travel_date,
    COUNT(*) OVER (PARTITION BY companion.active_trip_id) AS candidate_count
  FROM companion_stats companion
  JOIN target_routes target
    ON target.vehicle_id = companion.vehicle_id
   AND target.target_travel_date = (companion.start_time AT TIME ZONE 'Asia/Manila')::date
   AND target.target_travel_date <> companion.source_travel_date
   AND companion.source_log_id <> target.target_log_id
   AND companion.end_time BETWEEN target.route_start - INTERVAL '30 minutes' AND target.route_start
  WHERE companion.originally_unlinked
    AND (companion.start_time AT TIME ZONE 'Asia/Manila')::date
        = (companion.end_time AT TIME ZONE 'Asia/Manila')::date
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(companion.coordinates) coordinate
      WHERE haversine_distance(target.lat_long_origin, coordinate) > 1500
    )
)
SELECT
  source_log_id,
  target_log_id,
  active_trip_id,
  vehicle_id,
  target_travel_order_id,
  target_driver_id,
  start_time,
  end_time
FROM candidates
WHERE candidate_count = 1;

DELETE FROM gps_trip_log_active_trips source_session
USING gps_companion_session_repairs repair
WHERE source_session.gps_trip_log_id = repair.source_log_id
  AND source_session.active_trip_id = repair.active_trip_id;

INSERT INTO gps_trip_log_active_trips
  (gps_trip_log_id, active_trip_id, start_time, end_time)
SELECT target_log_id, active_trip_id, start_time, end_time
FROM gps_companion_session_repairs
ON CONFLICT (gps_trip_log_id, active_trip_id)
DO UPDATE SET
  start_time = LEAST(gps_trip_log_active_trips.start_time, EXCLUDED.start_time),
  end_time = GREATEST(gps_trip_log_active_trips.end_time, EXCLUDED.end_time);

UPDATE gps_telemetry telemetry
SET travel_order_id = repair.target_travel_order_id,
    driver_id = repair.target_driver_id
FROM gps_companion_session_repairs repair
WHERE telemetry.vehicle_id = repair.vehicle_id
  AND telemetry.active_trip_id = repair.active_trip_id;

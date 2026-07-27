-- Expand partially linked ignition sessions when one unique, validated travel
-- order owns the session. Conflicting, manual, overnight, wrong-date, and
-- ambiguous sessions are intentionally excluded.

CREATE TEMP TABLE gps_complete_session_backfills ON COMMIT DROP AS
WITH session_stats AS (
  SELECT
    gt.vehicle_id,
    gt.active_trip_id,
    MIN(gt.recorded_at) AS session_start,
    MAX(gt.recorded_at) AS session_end,
    (ARRAY_AGG(CONCAT(gt.latitude, ',', gt.longitude) ORDER BY gt.recorded_at ASC))[1] AS start_coordinates,
    COUNT(*) FILTER (WHERE gt.travel_order_id IS NULL) AS unlinked_points,
    COUNT(DISTINCT gt.travel_order_id) FILTER (WHERE gt.travel_order_id IS NOT NULL) AS linked_order_count,
    (ARRAY_AGG(DISTINCT gt.travel_order_id) FILTER (WHERE gt.travel_order_id IS NOT NULL))[1] AS linked_travel_order_id
  FROM gps_telemetry gt
  WHERE gt.active_trip_id IS NOT NULL
    AND gt.latitude IS NOT NULL
    AND gt.longitude IS NOT NULL
  GROUP BY gt.vehicle_id, gt.active_trip_id
), validated AS (
  SELECT
    stats.vehicle_id,
    stats.active_trip_id,
    stats.session_start,
    stats.session_end,
    stats.linked_travel_order_id AS travel_order_id,
    target_order.driver_id,
    target_log.id AS gps_trip_log_id
  FROM session_stats stats
  JOIN travel_orders target_order
    ON target_order.id = stats.linked_travel_order_id
   AND target_order.vehicle_id = stats.vehicle_id
   AND target_order.status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
   AND target_order.driver_id IS NOT NULL
   AND target_order.scheduled_departure IS NOT NULL
   AND target_order.lat_long_origin IS NOT NULL
  JOIN gps_trip_logs target_log
    ON target_log.travel_order_id = target_order.id
   AND target_log.vehicle_id = stats.vehicle_id
   AND COALESCE(target_log.to_status_auto, '') <> 'manual'
  JOIN gps_trip_log_active_trips target_session
    ON target_session.gps_trip_log_id = target_log.id
   AND target_session.active_trip_id = stats.active_trip_id
  WHERE stats.unlinked_points > 0
    AND stats.linked_order_count = 1
    AND (stats.session_start AT TIME ZONE 'Asia/Manila')::date
        = (stats.session_end AT TIME ZONE 'Asia/Manila')::date
    AND target_order.scheduled_departure::date
        = (stats.session_start AT TIME ZONE 'Asia/Manila')::date
    AND stats.session_start BETWEEN
        (target_order.scheduled_departure AT TIME ZONE 'Asia/Manila') - INTERVAL '2 hours'
        AND COALESCE(
          target_order.scheduled_arrival AT TIME ZONE 'Asia/Manila',
          (target_order.scheduled_departure AT TIME ZONE 'Asia/Manila') + INTERVAL '12 hours'
        )
    AND haversine_distance(target_order.lat_long_origin, stats.start_coordinates) <= 300
    AND NOT EXISTS (
      SELECT 1
      FROM travel_orders competing_order
      WHERE competing_order.id <> target_order.id
        AND competing_order.vehicle_id = stats.vehicle_id
        AND competing_order.status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
        AND competing_order.scheduled_departure::date = target_order.scheduled_departure::date
        AND competing_order.lat_long_origin IS NOT NULL
        AND haversine_distance(competing_order.lat_long_origin, stats.start_coordinates) <= 300
    )
)
SELECT DISTINCT * FROM validated;

UPDATE gps_telemetry telemetry
SET travel_order_id = backfill.travel_order_id,
    driver_id = COALESCE(telemetry.driver_id, backfill.driver_id)
FROM gps_complete_session_backfills backfill
WHERE telemetry.vehicle_id = backfill.vehicle_id
  AND telemetry.active_trip_id = backfill.active_trip_id
  AND telemetry.travel_order_id IS NULL;

UPDATE gps_trip_log_active_trips session
SET start_time = LEAST(COALESCE(session.start_time, backfill.session_start), backfill.session_start),
    end_time = GREATEST(COALESCE(session.end_time, backfill.session_end), backfill.session_end)
FROM gps_complete_session_backfills backfill
WHERE session.gps_trip_log_id = backfill.gps_trip_log_id
  AND session.active_trip_id = backfill.active_trip_id;

WITH affected_logs AS (
  SELECT DISTINCT gps_trip_log_id FROM gps_complete_session_backfills
), bounded_route AS MATERIALIZED (
  SELECT
    g.id AS gps_trip_log_id,
    g.trip_status_gps,
    to_.lat_long_origin AS planned_origin_coordinates,
    (ARRAY_AGG(gt.recorded_at ORDER BY gt.recorded_at ASC))[1] AS first_at,
    (ARRAY_AGG(gt.location_name ORDER BY gt.recorded_at ASC))[1] AS first_address,
    (ARRAY_AGG(CONCAT(gt.latitude, ',', gt.longitude) ORDER BY gt.recorded_at ASC))[1] AS first_coordinates,
    (ARRAY_AGG(gt.recorded_at ORDER BY gt.recorded_at DESC))[1] AS last_at,
    (ARRAY_AGG(gt.location_name ORDER BY gt.recorded_at DESC))[1] AS last_address,
    (ARRAY_AGG(CONCAT(gt.latitude, ',', gt.longitude) ORDER BY gt.recorded_at DESC))[1] AS last_coordinates
  FROM affected_logs affected
  JOIN gps_trip_logs g ON g.id = affected.gps_trip_log_id
  JOIN travel_orders to_ ON to_.id = g.travel_order_id
  JOIN gps_trip_log_active_trips session ON session.gps_trip_log_id = g.id
  JOIN gps_telemetry gt
    ON gt.vehicle_id = g.vehicle_id
   AND gt.active_trip_id = session.active_trip_id
   AND (session.start_time IS NULL OR gt.recorded_at >= session.start_time)
   AND (session.end_time IS NULL OR gt.recorded_at <= session.end_time)
  WHERE gt.latitude IS NOT NULL
    AND gt.longitude IS NOT NULL
  GROUP BY g.id, to_.lat_long_origin
), canonical AS (
  SELECT
    route.*,
    CASE
      WHEN route.planned_origin_coordinates IS NULL THEN NULL
      ELSE haversine_distance(route.planned_origin_coordinates, route.last_coordinates)
    END AS end_distance_from_origin_m
  FROM bounded_route route
)
UPDATE gps_trip_logs g
SET origin_gps_start_point = COALESCE(canonical.first_address, g.origin_gps_start_point),
    coordinates_origin = canonical.first_coordinates,
    departure_time_gps = canonical.first_at,
    destination_gps_end_point = COALESCE(canonical.last_address, g.destination_gps_end_point),
    coordinates_destination = canonical.last_coordinates,
    arrival_time_gps = CASE
      WHEN LOWER(canonical.trip_status_gps) = 'completed' THEN canonical.last_at
      ELSE g.arrival_time_gps
    END,
    returned_to_base_at = CASE
      WHEN LOWER(canonical.trip_status_gps) = 'completed'
       AND canonical.end_distance_from_origin_m <= 300
      THEN canonical.last_at
      ELSE g.returned_to_base_at
    END,
    matched_origin_distance_m = canonical.end_distance_from_origin_m
FROM canonical
WHERE g.id = canonical.gps_trip_log_id;

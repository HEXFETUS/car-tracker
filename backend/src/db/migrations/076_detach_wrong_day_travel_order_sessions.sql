-- Remove automatically matched ignition sessions that began on a different
-- Manila calendar date from their travel order. A continuous active_trip_id
-- may cross midnight; only the session's first point is used for this check.

CREATE TEMP TABLE gps_wrong_day_session_repairs ON COMMIT DROP AS
WITH session_stats AS MATERIALIZED (
  SELECT
    gt.vehicle_id,
    gt.active_trip_id,
    MIN(gt.recorded_at) AS session_start,
    MAX(gt.recorded_at) AS session_end,
    COUNT(*) FILTER (WHERE gt.travel_order_id IS NOT NULL) AS linked_points,
    COUNT(DISTINCT gt.travel_order_id) FILTER (WHERE gt.travel_order_id IS NOT NULL) AS linked_order_count,
    (ARRAY_AGG(DISTINCT gt.travel_order_id) FILTER (WHERE gt.travel_order_id IS NOT NULL))[1] AS linked_order_id
  FROM gps_telemetry gt
  WHERE gt.active_trip_id IS NOT NULL
  GROUP BY gt.vehicle_id, gt.active_trip_id
), candidates AS (
  SELECT stats.*,
         g.id AS gps_trip_log_id,
         g.travel_order_id
  FROM session_stats stats
  JOIN gps_trip_logs g
    ON g.vehicle_id = stats.vehicle_id
   AND g.travel_order_id = stats.linked_order_id
  JOIN travel_orders target_order ON target_order.id = g.travel_order_id
  WHERE COALESCE(g.to_status_auto, '') <> 'manual'
    AND target_order.status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
    AND target_order.scheduled_departure IS NOT NULL
    AND stats.linked_points > 0
    AND stats.linked_order_count = 1
    AND stats.linked_order_id = g.travel_order_id
    AND (stats.session_start AT TIME ZONE 'Asia/Manila')::date
        <> target_order.scheduled_departure::date
    -- A valid same-day order makes the intended assignment ambiguous.
    AND NOT EXISTS (
      SELECT 1
      FROM travel_orders same_day_order
      WHERE same_day_order.vehicle_id = stats.vehicle_id
        AND same_day_order.status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
        AND same_day_order.scheduled_departure::date
            = (stats.session_start AT TIME ZONE 'Asia/Manila')::date
    )
    -- Keep at least one correctly dated session on the GPS log. Placeholder
    -- logs with no remaining route require manual review instead.
    AND EXISTS (
      SELECT 1
      FROM gps_trip_log_active_trips valid_session
      JOIN session_stats valid_stats
        ON valid_stats.vehicle_id = stats.vehicle_id
       AND valid_stats.active_trip_id = valid_session.active_trip_id
      WHERE valid_session.gps_trip_log_id = g.id
        AND valid_stats.active_trip_id <> stats.active_trip_id
        AND (valid_stats.session_start AT TIME ZONE 'Asia/Manila')::date
            = target_order.scheduled_departure::date
    )
)
SELECT DISTINCT * FROM candidates;

-- Clear only the stale TO association. Driver and Telegram audit fields are
-- intentionally preserved.
UPDATE gps_telemetry telemetry
SET travel_order_id = NULL
FROM gps_wrong_day_session_repairs repair
WHERE telemetry.vehicle_id = repair.vehicle_id
  AND telemetry.active_trip_id = repair.active_trip_id
  AND telemetry.travel_order_id = repair.travel_order_id;

DELETE FROM gps_trip_log_active_trips session
USING gps_wrong_day_session_repairs repair
WHERE session.gps_trip_log_id = repair.gps_trip_log_id
  AND session.active_trip_id = repair.active_trip_id;

WITH affected_logs AS (
  SELECT DISTINCT gps_trip_log_id FROM gps_wrong_day_session_repairs
), bounded_route AS MATERIALIZED (
  SELECT
    g.id AS gps_trip_log_id,
    g.trip_status_gps,
    target_order.lat_long_origin AS planned_origin_coordinates,
    (ARRAY_AGG(gt.recorded_at ORDER BY gt.recorded_at ASC))[1] AS first_at,
    (ARRAY_AGG(gt.location_name ORDER BY gt.recorded_at ASC))[1] AS first_address,
    (ARRAY_AGG(CONCAT(gt.latitude, ',', gt.longitude) ORDER BY gt.recorded_at ASC))[1] AS first_coordinates,
    (ARRAY_AGG(gt.recorded_at ORDER BY gt.recorded_at DESC))[1] AS last_at,
    (ARRAY_AGG(gt.location_name ORDER BY gt.recorded_at DESC))[1] AS last_address,
    (ARRAY_AGG(CONCAT(gt.latitude, ',', gt.longitude) ORDER BY gt.recorded_at DESC))[1] AS last_coordinates
  FROM affected_logs affected
  JOIN gps_trip_logs g ON g.id = affected.gps_trip_log_id
  JOIN travel_orders target_order ON target_order.id = g.travel_order_id
  JOIN gps_trip_log_active_trips session ON session.gps_trip_log_id = g.id
  JOIN gps_telemetry gt
    ON gt.vehicle_id = g.vehicle_id
   AND gt.active_trip_id = session.active_trip_id
   AND (session.start_time IS NULL OR gt.recorded_at >= session.start_time)
   AND (session.end_time IS NULL OR gt.recorded_at <= session.end_time)
  WHERE gt.latitude IS NOT NULL
    AND gt.longitude IS NOT NULL
  GROUP BY g.id, target_order.lat_long_origin
), canonical AS (
  SELECT route.*,
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
      ELSE NULL
    END,
    matched_origin_distance_m = canonical.end_distance_from_origin_m
FROM canonical
WHERE g.id = canonical.gps_trip_log_id;

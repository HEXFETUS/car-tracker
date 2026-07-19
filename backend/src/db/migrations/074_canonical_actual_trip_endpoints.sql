-- Canonical GPS trip origin/end fields come from the first and last telemetry
-- points inside the log's linked session boundaries. Planned TO locations stay
-- on travel_orders and are displayed separately.

WITH bounded_route AS MATERIALIZED (
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
  FROM gps_trip_logs g
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

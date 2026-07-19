-- Use the Travel Order scheduled departure date as the canonical GPS trip date.
-- Backfill missing due logs, then repair GPS numbers in chronological order.

ALTER TABLE gps_trip_logs
  DROP CONSTRAINT IF EXISTS gps_trip_logs_trip_status_gps_check;

ALTER TABLE gps_trip_logs
  DROP CONSTRAINT IF EXISTS gps_trip_logs_trip_status_check;

UPDATE gps_trip_logs g
   SET trip_date = to_.scheduled_departure::date,
       trip_status_gps = CASE
         WHEN to_.status = 'CANCELLED' AND g.trip_status_gps = 'pending' THEN 'cancelled'
         ELSE g.trip_status_gps
       END
  FROM travel_orders to_
 WHERE to_.id = g.travel_order_id
   AND to_.scheduled_departure IS NOT NULL;

INSERT INTO gps_trip_logs (
  gps_record_no,
  trip_date,
  vehicle_id,
  driver_id,
  origin_gps_start_point,
  destination_gps_end_point,
  coordinates_origin,
  coordinates_destination,
  actual_route_road_taken,
  departure_time_gps,
  arrival_time_gps,
  gps_distance_km,
  engine_hours,
  max_speed_kph,
  trip_status_gps,
  travel_order_id,
  to_status_auto,
  anomaly_flag,
  notes_remarks,
  active_trip_id,
  trip_type,
  destination_verified,
  business_trip_status
)
SELECT
  'TMP-TO-' || to_.id::text,
  to_.scheduled_departure::date,
  to_.vehicle_id,
  to_.driver_id,
  COALESCE(to_.origin_location, ''),
  COALESCE(to_.destination_target, ''),
  to_.lat_long_origin,
  to_.lat_long_destination,
  '',
  NULL,
  NULL,
  0,
  0,
  0,
  'pending',
  to_.id,
  'matched',
  FALSE,
  NULL,
  NULL,
  'OUTBOUND',
  FALSE,
  'WAITING_AT_BASE'
FROM travel_orders to_
WHERE to_.status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
  AND to_.scheduled_departure IS NOT NULL
  AND to_.scheduled_departure::date <= (NOW() AT TIME ZONE 'Asia/Manila')::date
  AND to_.vehicle_id IS NOT NULL
  AND to_.driver_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
      FROM gps_trip_logs g
     WHERE g.travel_order_id = to_.id
  )
ON CONFLICT DO NOTHING;

CREATE TEMP TABLE gps_trip_log_renumber ON COMMIT DROP AS
WITH canonical AS (
  SELECT
    g.id,
    COALESCE(to_.scheduled_departure::date, g.trip_date) AS canonical_date,
    to_.scheduled_departure,
    g.departure_time_gps,
    g.created_at
  FROM gps_trip_logs g
  LEFT JOIN travel_orders to_ ON to_.id = g.travel_order_id
), numbered AS (
  SELECT
    id,
    EXTRACT(YEAR FROM canonical_date)::integer AS record_year,
    ROW_NUMBER() OVER (
      PARTITION BY EXTRACT(YEAR FROM canonical_date)::integer
      ORDER BY canonical_date ASC,
               scheduled_departure ASC NULLS LAST,
               departure_time_gps ASC NULLS LAST,
               created_at ASC,
               id ASC
    ) AS record_sequence
  FROM canonical
)
SELECT
  id,
  'GPS-' || record_year || '-' || LPAD(record_sequence::text, 4, '0') AS gps_record_no
FROM numbered;

-- Move every identifier out of the final namespace first so swaps cannot
-- violate the unique gps_record_no constraint.
UPDATE gps_trip_logs
   SET gps_record_no = 'TMP-RENUMBER-' || id::text;

UPDATE gps_trip_logs g
   SET gps_record_no = r.gps_record_no
  FROM gps_trip_log_renumber r
 WHERE r.id = g.id;

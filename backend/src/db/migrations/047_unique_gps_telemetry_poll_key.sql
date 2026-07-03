-- Canonicalize gps_telemetry event names and enforce one row per vehicle/event/minute/location poll key.

UPDATE gps_telemetry
SET event_type = CASE event_type
  WHEN 'LOCATION UPDATE' THEN 'LOCATION_UPDATE'
  WHEN 'LOCATION UPDATE ALERT' THEN 'LOCATION_UPDATE'
  WHEN 'IGNITION ON' THEN 'IGNITION_ON'
  WHEN 'IGNITION ON ALERT' THEN 'IGNITION_ON'
  WHEN 'IGNITION OFF' THEN 'IGNITION_OFF'
  WHEN 'IGNITION OFF ALERT' THEN 'IGNITION_OFF'
  WHEN 'MOVING ALERT' THEN 'MOTION_STARTED'
  WHEN 'IDLING ALERT' THEN 'IDLING'
  WHEN 'IDLING TOO LONG ALERT' THEN 'IDLING'
  WHEN 'IDLING_TOO_LONG' THEN 'IDLING'
  ELSE event_type
END
WHERE event_type IN (
  'LOCATION UPDATE',
  'LOCATION UPDATE ALERT',
  'IGNITION ON',
  'IGNITION ON ALERT',
  'IGNITION OFF',
  'IGNITION OFF ALERT',
  'MOVING ALERT',
  'IDLING ALERT',
  'IDLING TOO LONG ALERT'
);

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY
        vehicle_id,
        event_type,
        date_trunc('minute', recorded_at AT TIME ZONE 'UTC'),
        lower(trim(regexp_replace(regexp_replace(coalesce(location_name, ''), ',+$', ''), '\s+', ' ', 'g')))
      ORDER BY
        CASE WHEN telegram_message IS NOT NULL THEN 0 ELSE 1 END,
        recorded_at ASC,
        created_at ASC
    ) AS rn
  FROM gps_telemetry
)
DELETE FROM gps_telemetry gt
USING ranked r
WHERE gt.id = r.id
  AND r.rn > 1;

DROP INDEX IF EXISTS gps_telemetry_location_update_dedupe_idx;
DROP INDEX IF EXISTS gps_telemetry_poll_unique_idx;

CREATE UNIQUE INDEX gps_telemetry_poll_unique_idx
ON gps_telemetry (
  vehicle_id,
  event_type,
  date_trunc('minute', recorded_at AT TIME ZONE 'UTC'),
  lower(trim(regexp_replace(regexp_replace(coalesce(location_name, ''), ',+$', ''), '\s+', ' ', 'g')))
);

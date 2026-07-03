-- Ensure legacy spaced location event names cannot remain or be reinserted.

UPDATE gps_telemetry
SET event_type = 'LOCATION_UPDATE'
WHERE event_type IN ('LOCATION UPDATE', 'LOCATION UPDATE ALERT');

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
  WHERE event_type = 'LOCATION_UPDATE'
)
DELETE FROM gps_telemetry gt
USING ranked r
WHERE gt.id = r.id
  AND r.rn > 1;

ALTER TABLE gps_telemetry
  DROP CONSTRAINT IF EXISTS gps_telemetry_no_legacy_location_update_event_type;

ALTER TABLE gps_telemetry
  ADD CONSTRAINT gps_telemetry_no_legacy_location_update_event_type
  CHECK (event_type <> 'LOCATION UPDATE' AND event_type <> 'LOCATION UPDATE ALERT');

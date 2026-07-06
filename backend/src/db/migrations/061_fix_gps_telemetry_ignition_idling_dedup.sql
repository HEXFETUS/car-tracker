-- Align gps_telemetry uniqueness with trip-scoped IGNITION_ON semantics.
-- IGNITION_ON is unique only per vehicle + active_trip_id + event_type.
-- Other events keep the existing poll-key uniqueness.

DROP INDEX IF EXISTS gps_telemetry_poll_unique_idx;

CREATE UNIQUE INDEX IF NOT EXISTS gps_telemetry_poll_unique_idx
ON gps_telemetry (
  vehicle_id,
  event_type,
  date_trunc('minute', recorded_at AT TIME ZONE 'UTC'),
  lower(trim(regexp_replace(regexp_replace(coalesce(location_name, ''), ',+$', ''), '\s+', ' ', 'g')))
)
WHERE event_type <> 'IGNITION_ON';

CREATE UNIQUE INDEX IF NOT EXISTS gps_telemetry_ignition_on_trip_unique_idx
ON gps_telemetry (vehicle_id, active_trip_id, event_type)
WHERE event_type = 'IGNITION_ON'
  AND active_trip_id IS NOT NULL;

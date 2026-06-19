-- ── Cleanup Bad GPS Records ──────────────────────────────────────
--
-- Deletes GPS trip log records that were incorrectly created from
-- current fleet status / live telemetry (which lack travel_order_id,
-- proper departure/arrival times, and valid coordinates).
--
-- These records were created BEFORE the hard validation rules were
-- added that now prevent such records from being created.
--
-- Affected records: GPS-2026-0001 through GPS-2026-0003 (and any
-- others matching the criteria below).

BEGIN;

-- Delete records with no travel_order_id (created from fleet status)
-- that also lack proper GPS timestamps or have zero/null distance.
DELETE FROM gps_trip_logs
WHERE travel_order_id IS NULL
  AND (
    departure_time_gps IS NULL
    OR arrival_time_gps IS NULL
    OR gps_distance_km IS NULL
    OR gps_distance_km = 0
    OR departure_time_gps = arrival_time_gps
  );

-- Delete specific bad records by GPS record number if they still exist.
DELETE FROM gps_trip_logs WHERE gps_record_no IN ('GPS-2026-0001', 'GPS-2026-0002', 'GPS-2026-0003');

COMMIT;
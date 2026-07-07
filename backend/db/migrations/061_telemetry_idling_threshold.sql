-- Add idling_threshold_minutes to gps_telemetry so we can deduplicate
-- IDLING_TOO_LONG telemetry rows against the exact threshold that was
-- alerted, instead of parsing the Telegram message text.
ALTER TABLE gps_telemetry
  ADD COLUMN IF NOT EXISTS idling_threshold_minutes INTEGER;

-- Index supporting the per-trip + threshold duplicate guard:
-- WHERE active_trip_id IS NOT NULL keeps the index small and matches
-- the lookups performed inside the idling transaction.
CREATE INDEX IF NOT EXISTS idx_gps_telemetry_trip_idling_threshold
  ON gps_telemetry (vehicle_id, active_trip_id, event_type, idling_threshold_minutes)
  WHERE active_trip_id IS NOT NULL;
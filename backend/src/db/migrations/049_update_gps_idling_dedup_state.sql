-- Convert gps_idling_dedup from per-threshold rows to active idling state.

ALTER TABLE gps_idling_dedup
  ALTER COLUMN threshold_minutes DROP NOT NULL;

ALTER TABLE gps_idling_dedup
  ADD COLUMN IF NOT EXISTS idling_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_alerted_duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS last_alerted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

UPDATE gps_idling_dedup
SET
  idling_started_at = COALESCE(idling_started_at, created_at),
  last_alerted_duration_minutes = COALESCE(last_alerted_duration_minutes, threshold_minutes),
  last_alerted_at = COALESCE(last_alerted_at, created_at),
  is_active = true
WHERE last_alerted_duration_minutes IS NULL
   OR idling_started_at IS NULL
   OR last_alerted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_gps_idling_dedup_active_trip
  ON gps_idling_dedup (vehicle_id, active_trip_id, is_active);

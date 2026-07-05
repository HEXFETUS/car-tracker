-- Support telemetry-first trip logs with delayed return-direction detection.

ALTER TABLE gps_trip_logs
  ADD COLUMN IF NOT EXISTS pending_return_detection BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS motion_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_detected_at TIMESTAMPTZ;

DROP INDEX IF EXISTS uq_gps_trip_logs_active_trip_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gps_trip_logs_vehicle_active_trip_type
  ON gps_trip_logs (vehicle_id, active_trip_id, trip_type)
  WHERE active_trip_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gps_trip_logs_pending_return_detection
  ON gps_trip_logs (vehicle_id, active_trip_id, pending_return_detection)
  WHERE pending_return_detection = TRUE;

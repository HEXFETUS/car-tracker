ALTER TABLE gps_telemetry
  ADD COLUMN IF NOT EXISTS telegram_status TEXT;

ALTER TABLE gps_telemetry
  ADD COLUMN IF NOT EXISTS telegram_error TEXT;

ALTER TABLE gps_telemetry
  ADD COLUMN IF NOT EXISTS telegram_attempted_at TIMESTAMPTZ;

ALTER TABLE gps_telemetry
  DROP CONSTRAINT IF EXISTS chk_gps_telemetry_telegram_status;

ALTER TABLE gps_telemetry
  ADD CONSTRAINT chk_gps_telemetry_telegram_status
    CHECK (telegram_status IS NULL OR telegram_status IN ('sent', 'failed', 'skipped'));

CREATE INDEX IF NOT EXISTS idx_gps_telemetry_telegram_failed
  ON gps_telemetry (telegram_attempted_at DESC)
  WHERE telegram_status = 'failed';

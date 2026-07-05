ALTER TABLE scheduler_runs
  ADD COLUMN IF NOT EXISTS vehicles_processed INTEGER NOT NULL DEFAULT 0;

ALTER TABLE scheduler_runs
  ADD COLUMN IF NOT EXISTS telemetry_saved INTEGER NOT NULL DEFAULT 0;

ALTER TABLE scheduler_runs
  ADD COLUMN IF NOT EXISTS telegram_sent INTEGER NOT NULL DEFAULT 0;

ALTER TABLE scheduler_runs
  ADD COLUMN IF NOT EXISTS telegram_failed INTEGER NOT NULL DEFAULT 0;

ALTER TABLE scheduler_runs
  ADD COLUMN IF NOT EXISTS skip_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_scheduler_runs_telegram_failed
  ON scheduler_runs (started_at DESC)
  WHERE telegram_failed > 0;

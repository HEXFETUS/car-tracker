ALTER TABLE cron_scheduler_progress
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_result TEXT,
  ADD COLUMN IF NOT EXISTS last_skip_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS last_batch_offset INTEGER,
  ADD COLUMN IF NOT EXISTS last_vehicles_examined INTEGER;

ALTER TABLE cron_scheduler_progress
  DROP CONSTRAINT IF EXISTS cron_scheduler_progress_last_batch_offset_check,
  ADD CONSTRAINT cron_scheduler_progress_last_batch_offset_check
    CHECK (last_batch_offset IS NULL OR last_batch_offset >= 0),
  DROP CONSTRAINT IF EXISTS cron_scheduler_progress_last_vehicles_examined_check,
  ADD CONSTRAINT cron_scheduler_progress_last_vehicles_examined_check
    CHECK (last_vehicles_examined IS NULL OR last_vehicles_examined >= 0);

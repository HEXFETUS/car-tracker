-- Add ended_at column to gps_idling_dedup for tracking when idling sessions end

ALTER TABLE gps_idling_dedup
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

-- Update existing active records to have ended_at = null (they're still active)
UPDATE gps_idling_dedup
SET ended_at = NULL
WHERE is_active = true AND ended_at IS NULL;

-- Update existing inactive records to have ended_at = last_alerted_at
UPDATE gps_idling_dedup
SET ended_at = COALESCE(ended_at, last_alerted_at, created_at)
WHERE is_active = false AND ended_at IS NULL;
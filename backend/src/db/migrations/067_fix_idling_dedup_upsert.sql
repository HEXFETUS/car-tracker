-- ── Fix: Idling dedup UPSERT + partial unique index ────────────
--
-- Problem:
--   `markIdlingAlertDb` used UPDATE-then-INSERT with ON CONFLICT DO NOTHING.
--   When a new idling session started for the same trip (after MOTION_STARTED),
--   the UPDATE found `is_active = false` and updated 0 rows. The subsequent INSERT
--   conflicted on the existing (vehicle_id, active_trip_id, threshold_minutes) row
--   and silently failed. This caused `last_alerted_duration_minutes` to never be
--   updated for the new session, so every poll cycle passed the dedup check and
--   saved a new IDLING_TOO_LONG row.
--
-- Fix:
--   1. Drop the old unique constraint (vehicle_id, active_trip_id, threshold_minutes)
--      which prevented session reactivation.
--   2. Add a partial unique index: one active row per (vehicle_id, active_trip_id).
--   3. Change markIdlingAlertDb to use INSERT ... ON CONFLICT DO UPDATE (UPSERT).
--   4. Add a cleanup migration for existing bad non-threshold rows.

-- ── Step 1: Drop the old unique constraint ─────────────────────
ALTER TABLE gps_idling_dedup
  DROP CONSTRAINT IF EXISTS uq_gps_idling_dedup;

-- ── Step 2: Add partial unique index for one active row per trip ──
CREATE UNIQUE INDEX IF NOT EXISTS uq_gps_idling_dedup_active
  ON gps_idling_dedup (vehicle_id, active_trip_id)
  WHERE is_active = true;

-- ── Step 3: Add non-active-unique index for lookups ────────────
-- Used by getActiveIdlingDedupDb() to find the highest threshold for an active session
DROP INDEX IF EXISTS idx_gps_idling_dedup_active_trip;
CREATE INDEX IF NOT EXISTS idx_gps_idling_dedup_active_trip
  ON gps_idling_dedup (vehicle_id, active_trip_id, COALESCE(last_alerted_duration_minutes, threshold_minutes, 0) DESC)
  WHERE is_active = true;

-- ── Step 4: Track dedup schema version for code migration ──────
-- Remove old foreign key if any
ALTER TABLE gps_idling_dedup
  DROP CONSTRAINT IF EXISTS gps_idling_dedup_active_trip_id_fkey;
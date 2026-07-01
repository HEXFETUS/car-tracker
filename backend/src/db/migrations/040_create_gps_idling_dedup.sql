-- ── GPS Idling Milestone Deduplication Table ───────────────────
--
-- Tracks which idling milestones have been persisted per vehicle
-- per trip to prevent duplicate saves across scheduler cycles.
--
-- This is a helper/dedup table, NOT a relational entity. There is
-- NO foreign key constraint on active_trip_id because the dedup
-- record may need to be inserted before the telemetry record that
-- creates the active_trip_id reference.
--
-- The UNIQUE constraint on (vehicle_id, active_trip_id, threshold_minutes)
-- ensures that the same idling milestone is never saved twice for
-- the same trip, even across backend restarts.

CREATE TABLE IF NOT EXISTS gps_idling_dedup (
  id                SERIAL PRIMARY KEY,
  vehicle_id        UUID NOT NULL,
  active_trip_id    UUID NOT NULL,
  threshold_minutes INTEGER NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Prevent duplicate entries for the same vehicle/trip/milestone
  CONSTRAINT uq_gps_idling_dedup UNIQUE (vehicle_id, active_trip_id, threshold_minutes)
);

-- Drop any auto-created FK constraint (PostgreSQL may add one if
-- active_trip_id references another table's UUID column)
ALTER TABLE gps_idling_dedup
  DROP CONSTRAINT IF EXISTS gps_idling_dedup_active_trip_id_fkey;

-- Index for fast lookup by the scheduler
CREATE INDEX IF NOT EXISTS idx_gps_idling_dedup_lookup
  ON gps_idling_dedup (vehicle_id, active_trip_id, threshold_minutes);

-- Auto-cleanup entries older than 7 days to prevent table bloat
-- (idling milestones are only relevant within the same trip day)
CREATE INDEX IF NOT EXISTS idx_gps_idling_dedup_cleanup
  ON gps_idling_dedup (created_at);
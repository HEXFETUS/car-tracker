-- ───────────────────────────────────────────────────────────────
-- Drop fleet_trip_history table
--
-- Removes the entire Fleet Trip History feature.
-- Drops indexes, constraints, and the table itself.
-- ───────────────────────────────────────────────────────────────

-- ── Step 1: Drop indexes ───────────────────────────────────────
DROP INDEX IF EXISTS idx_fleet_trip_history_unique_event;
DROP INDEX IF EXISTS idx_fleet_trip_history_dedup;
DROP INDEX IF EXISTS idx_fleet_trip_history_event_time;
DROP INDEX IF EXISTS idx_fleet_trip_history_vehicle_id;
DROP INDEX IF EXISTS idx_fleet_trip_history_trip_date;

-- ── Step 2: Drop any remaining triggers ────────────────────────
DROP TRIGGER IF EXISTS trg_fleet_trip_history_updated_at ON fleet_trip_history;
DROP FUNCTION IF EXISTS fn_fleet_trip_history_updated_at();

-- ── Step 3: Drop the table ─────────────────────────────────────
DROP TABLE IF EXISTS fleet_trip_history;
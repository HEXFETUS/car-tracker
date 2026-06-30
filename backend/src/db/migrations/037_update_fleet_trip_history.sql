-- ───────────────────────────────────────────────────────────────
-- Update fleet_trip_history table
-- 
-- Changes:
-- 1. Add telemetry columns for all available Fleet History fields
-- 2. Replace the old unique index (based on lat/lng) with a new one
--    based on (vehicle_id, event_time, status, COALESCE(location, ''))
--    since lat/lng are optional and location name is used for dedup
-- ───────────────────────────────────────────────────────────────

-- ── Step 1: Add telemetry columns if they don't exist ─────────
ALTER TABLE IF EXISTS fleet_trip_history
  ADD COLUMN IF NOT EXISTS gps_signal TEXT,
  ADD COLUMN IF NOT EXISTS rpm NUMERIC,
  ADD COLUMN IF NOT EXISTS odometer NUMERIC,
  ADD COLUMN IF NOT EXISTS geofence TEXT,
  ADD COLUMN IF NOT EXISTS x_accel DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS y_accel DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS z_accel DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS unit_temp DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS water_temp DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS oil_temp DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS oil_pressure DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS manifold_pressure DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS temp_1 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS temp_2 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS temp_3 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS temp_4 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS clock DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS clock_minute DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS clock_raw DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS fuel_used DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS vision TEXT,
  ADD COLUMN IF NOT EXISTS actions TEXT,
  ADD COLUMN IF NOT EXISTS driver TEXT;

-- ── Step 2: Drop old unique index (used lat/lng as key) ───────
DROP INDEX IF EXISTS idx_fleet_trip_history_dedup;

-- ── Step 3: Create new unique index using location name instead ──
-- Duplicate key: vehicle_id + event_time + status + location
-- COALESCE handles NULL locations by treating them as empty string
CREATE UNIQUE INDEX IF NOT EXISTS idx_fleet_trip_history_dedup
  ON fleet_trip_history (vehicle_id, event_time, status, COALESCE(location, ''));
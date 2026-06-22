-- ── Composite Index for GPS Telemetry Queries ───────────────────
--
-- Optimizes the common filter pattern used in fetchTelemetry():
--   WHERE vehicle_id = ? AND event_type = ? AND recorded_at BETWEEN ? AND ?
--
-- This index enables Index Scans instead of Sequential Scans,
-- dramatically improving query performance as the table grows.
--
-- The DESC order on recorded_at matches the typical ORDER BY clause,
-- allowing PostgreSQL to skip an additional sort step.

CREATE INDEX IF NOT EXISTS idx_telemetry_query
    ON gps_telemetry (vehicle_id, event_type, recorded_at DESC);

-- Optional: Add a comment for documentation
COMMENT ON INDEX idx_telemetry_query IS 
    'Composite index for efficient telemetry filtering by vehicle, event type, and time range';
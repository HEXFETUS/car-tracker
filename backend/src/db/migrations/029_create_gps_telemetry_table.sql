-- ── GPS Telemetry Data Table ───────────────────────────────────
--
-- Stores raw vehicle telemetry snapshots captured on each
-- fleet sync cycle (every ~120s). Each row represents a single
-- data point with location, speed, fuel, and ignition status.
--
-- This is the "at rest" record of what the vehicle was doing
-- at a given moment, enabling historical playback and analysis.
--
-- See also: gps_trip_logs (aggregated trip records)

CREATE TABLE IF NOT EXISTS gps_telemetry (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id      UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    plate_number    TEXT NOT NULL,
    event_type      TEXT NOT NULL DEFAULT 'LOCATION_UPDATE',
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    speed_kmh       DOUBLE PRECISION DEFAULT 0,
    fuel_liters     DOUBLE PRECISION,
    ignition        BOOLEAN NOT NULL DEFAULT false,
    location_name   TEXT,
    driver_name     TEXT,
    to_number       TEXT,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for efficient vehicle-history queries
CREATE INDEX IF NOT EXISTS idx_gps_telemetry_vehicle_time
    ON gps_telemetry (vehicle_id, recorded_at DESC);

-- Index for date-range filtering
CREATE INDEX IF NOT EXISTS idx_gps_telemetry_recorded_at
    ON gps_telemetry (recorded_at DESC);
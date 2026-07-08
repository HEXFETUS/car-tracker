-- ── Migration 040: GPS Vehicle State Table ─────────────────────
--
-- Creates the gps_vehicle_state table used by the vehicle state
-- machine for ignition debouncing and state tracking.
--
-- This table is the SINGLE source of truth for per-vehicle
-- ignition state, replacing the previous in-memory + telemetry
-- comparison approach that caused duplicate ignition events.

CREATE TABLE IF NOT EXISTS gps_vehicle_state (
  vehicle_id UUID PRIMARY KEY,
  ignition_state TEXT NOT NULL DEFAULT 'OFF',
  last_confirmed_ignition BOOLEAN NOT NULL DEFAULT false,
  last_confirmed_ignition_at TIMESTAMPTZ,
  pending_ignition BOOLEAN,
  pending_since TIMESTAMPTZ,
  active_trip_id UUID,
  last_packet_time TIMESTAMPTZ,
  last_speed DOUBLE PRECISION NOT NULL DEFAULT 0,
  last_latitude DOUBLE PRECISION,
  last_longitude DOUBLE PRECISION,
  last_location_name TEXT,
  last_event_type TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE gps_vehicle_state IS 'Per-vehicle state machine for ignition debouncing and trip tracking';
COMMENT ON COLUMN gps_vehicle_state.ignition_state IS 'Current state: OFF, PENDING_ON, ON, PENDING_OFF';
COMMENT ON COLUMN gps_vehicle_state.last_confirmed_ignition IS 'Last confirmed ignition value (after debounce)';
COMMENT ON COLUMN gps_vehicle_state.pending_ignition IS 'Pending ignition value during debounce period';
COMMENT ON COLUMN gps_vehicle_state.pending_since IS 'When the pending state started (for debounce timing)';
COMMENT ON COLUMN gps_vehicle_state.active_trip_id IS 'Current active trip UUID (null when ignition is OFF)';

-- ── Performance Index ─────────────────────────────────────────
-- Index for deduplication queries that filter by vehicle_id,
-- event_type, and recorded_at time window.
-- This is critical for the time-window dedup in insertTelemetry().
CREATE INDEX IF NOT EXISTS idx_gps_telemetry_vehicle_event_recorded
  ON gps_telemetry (vehicle_id, event_type, recorded_at DESC);

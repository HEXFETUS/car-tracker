-- Migration 055: Add destination status tracking for route progress
-- Enables GPS arrival detection per stop and route progress visualization

ALTER TABLE travel_order_destinations
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING';

ALTER TABLE travel_order_destinations
  ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ;

ALTER TABLE travel_order_destinations
  ADD COLUMN IF NOT EXISTS arrival_distance_meters NUMERIC;

ALTER TABLE travel_order_destinations
  ADD COLUMN IF NOT EXISTS gps_trip_log_id UUID;

-- Constraint to ensure valid status values
ALTER TABLE travel_order_destinations
  DROP CONSTRAINT IF EXISTS chk_tod_status;

ALTER TABLE travel_order_destinations
  ADD CONSTRAINT chk_tod_status
    CHECK (status IN ('PENDING', 'IN_PROGRESS', 'ARRIVED', 'SKIPPED'));

-- Index for finding the next pending destination quickly
CREATE INDEX IF NOT EXISTS idx_tod_next_pending
  ON travel_order_destinations (travel_order_id, status, stop_order)
  WHERE status = 'PENDING';
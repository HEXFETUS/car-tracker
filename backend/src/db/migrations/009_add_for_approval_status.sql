-- Migration 009: Add 'FOR_APPROVAL' status to travel_orders
-- The new workflow requires a FOR_APPROVAL state when a vehicle/driver
-- has been assigned but the order hasn't been fully approved yet.

-- Drop the old CHECK constraint and add a new one that includes FOR_APPROVAL
ALTER TABLE travel_orders
  DROP CONSTRAINT IF EXISTS travel_orders_status_check;

ALTER TABLE travel_orders
  ADD CONSTRAINT travel_orders_status_check
    CHECK (status IN ('PENDING','FOR_APPROVAL','APPROVED','ACTIVE','COMPLETED','CANCELLED'));
-- Migration 011: Add 'FOR_REQUEST' status to travel_orders
-- FOR_REQUEST represents orders that have been marked for request
-- but haven't had vehicle/driver assigned yet.

ALTER TABLE travel_orders
  DROP CONSTRAINT IF EXISTS travel_orders_status_check;

ALTER TABLE travel_orders
  ADD CONSTRAINT travel_orders_status_check
    CHECK (status IN ('PENDING','FOR_REQUEST','FOR_APPROVAL','APPROVED','ACTIVE','COMPLETED','CANCELLED'));
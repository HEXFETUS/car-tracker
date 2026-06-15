-- Migration 013: Add approved_by to travel_orders
-- Track which user approved or rejected a travel order.

ALTER TABLE travel_orders
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_travel_orders_approved_by ON travel_orders (approved_by);
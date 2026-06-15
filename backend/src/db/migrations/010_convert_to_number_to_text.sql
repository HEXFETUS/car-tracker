-- Migration: Convert travel_orders.to_number from INTEGER to TEXT
-- This allows storing the full TO number string (e.g. "TO-2026-0001")
-- instead of just the auto-incremented integer.

-- 1. Drop the unique index that references the old integer column
DROP INDEX IF EXISTS idx_travel_orders_to_number;

-- 2. Drop the identity/serial behavior by altering the column
ALTER TABLE travel_orders
  ALTER COLUMN to_number DROP DEFAULT,
  ALTER COLUMN to_number TYPE TEXT USING ('TO-' || EXTRACT(YEAR FROM created_at)::TEXT || '-' || LPAD(to_number::TEXT, 4, '0')),
  ALTER COLUMN to_number SET NOT NULL;

-- 3. Re-create the unique index on the text column
CREATE UNIQUE INDEX IF NOT EXISTS idx_travel_orders_to_number ON travel_orders (to_number);
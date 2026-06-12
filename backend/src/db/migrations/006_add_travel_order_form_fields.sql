-- Migration 006: Add form fields to travel_orders
-- The new travel order modal collects department, traveler name, etc.
-- but these weren't persisted. Also, vehicle/driver assignment happens later.

-- vehicle_id and driver_id are already nullable in the actual DB

-- Add form-specific columns
ALTER TABLE travel_orders ADD COLUMN IF NOT EXISTS department TEXT DEFAULT '';
ALTER TABLE travel_orders ADD COLUMN IF NOT EXISTS traveler_name TEXT DEFAULT '';
ALTER TABLE travel_orders ADD COLUMN IF NOT EXISTS request_vehicle BOOLEAN DEFAULT FALSE;
ALTER TABLE travel_orders ADD COLUMN IF NOT EXISTS request_driver BOOLEAN DEFAULT FALSE;
ALTER TABLE travel_orders ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
-- Persist the last whole-liter low-fuel bucket alerted for each vehicle.
-- This prevents repeated alerts across scheduler process restarts.
ALTER TABLE gps_vehicle_state
  ADD COLUMN IF NOT EXISTS last_low_fuel_alert_liter INTEGER;


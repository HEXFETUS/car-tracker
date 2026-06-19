-- Migration 016: Add lat/long columns to travel_orders
-- Stores coordinates for origin (lat_long_origin) and destination (lat_long_destination)
-- Format: "latitude,longitude" (e.g. "14.5995,120.9842")

ALTER TABLE travel_orders ADD COLUMN IF NOT EXISTS lat_long_origin TEXT DEFAULT NULL;
ALTER TABLE travel_orders ADD COLUMN IF NOT EXISTS lat_long_destination TEXT DEFAULT NULL;
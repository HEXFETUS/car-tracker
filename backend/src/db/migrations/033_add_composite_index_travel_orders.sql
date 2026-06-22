-- Composite Index for Travel Orders LATERAL JOIN
--
-- Optimizes the LATERAL JOIN in fetchTelemetry() that retrieves
-- the active travel order for each telemetry record

CREATE INDEX IF NOT EXISTS idx_to_vehicle_status_date
    ON travel_orders (vehicle_id, status, scheduled_departure DESC);

COMMENT ON INDEX idx_to_vehicle_status_date IS 
    'Composite covering index for efficient travel order lookups by vehicle, status, and departure date';
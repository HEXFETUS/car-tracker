-- Unique index to prevent duplicate gps_trip_logs per TO/vehicle/date
CREATE UNIQUE INDEX IF NOT EXISTS idx_gps_trip_logs_unique_to_vehicle_date
ON gps_trip_logs (travel_order_id, vehicle_id, trip_date);
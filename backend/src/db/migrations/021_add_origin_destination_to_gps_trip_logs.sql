-- Add coordinates_origin and coordinates_destination to gps_trip_logs
ALTER TABLE gps_trip_logs
  ADD COLUMN IF NOT EXISTS coordinates_origin VARCHAR,
  ADD COLUMN IF NOT EXISTS coordinates_destination VARCHAR;

COMMENT ON COLUMN gps_trip_logs.coordinates_origin IS 'Origin coordinates in "latitude,longitude" format';
COMMENT ON COLUMN gps_trip_logs.coordinates_destination IS 'Destination coordinates in "latitude,longitude" format';
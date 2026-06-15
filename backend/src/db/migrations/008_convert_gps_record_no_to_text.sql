-- Ensure existing GPS trip log tables accept generated record numbers
-- such as GPS-KAR6412-1781419050117.

ALTER TABLE gps_trip_logs
  ALTER COLUMN gps_record_no TYPE TEXT
  USING gps_record_no::TEXT;

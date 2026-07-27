-- A completed unmatched No-TO journey is terminal. This protects the exact
-- telemetry-derived End from stale or overlapping lifecycle writers that try
-- to downgrade the same journey to an ongoing/paused state.
CREATE OR REPLACE FUNCTION keep_no_to_completion_terminal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'unmatched'
     AND OLD.business_trip_status = 'COMPLETED'
     AND OLD.end_time IS NOT NULL
     AND NEW.business_trip_status IS DISTINCT FROM 'COMPLETED'
  THEN
    NEW.business_trip_status := OLD.business_trip_status;
    NEW.returned_to_base_at := OLD.returned_to_base_at;
    NEW.end_address := OLD.end_address;
    NEW.end_coordinates := OLD.end_coordinates;
    NEW.end_time := OLD.end_time;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_keep_no_to_completion_terminal ON gps_no_to_logs;

CREATE TRIGGER trg_keep_no_to_completion_terminal
BEFORE UPDATE ON gps_no_to_logs
FOR EACH ROW
EXECUTE FUNCTION keep_no_to_completion_terminal();

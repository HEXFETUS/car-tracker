-- Let reconciliation remove obsolete parent links, but never let a stale
-- writer attach a new parent to a terminal journey.
CREATE OR REPLACE FUNCTION keep_no_to_completion_terminal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'unmatched'
     AND NEW.status = 'unmatched'
     AND OLD.business_trip_status = 'COMPLETED'
     AND OLD.end_time IS NOT NULL
  THEN
    NEW.trip_date := OLD.trip_date;
    NEW.origin_address := OLD.origin_address;
    NEW.origin_coordinates := OLD.origin_coordinates;
    NEW.destination_address := OLD.destination_address;
    NEW.destination_coordinates := OLD.destination_coordinates;
    NEW.departure_time := OLD.departure_time;
    NEW.arrival_time := OLD.arrival_time;
    NEW.distance_km := OLD.distance_km;
    NEW.engine_hours := OLD.engine_hours;
    NEW.moving_hours := OLD.moving_hours;
    NEW.max_speed_kph := OLD.max_speed_kph;
    NEW.business_trip_status := OLD.business_trip_status;
    NEW.arrived_location_name := OLD.arrived_location_name;
    NEW.arrived_coordinates := OLD.arrived_coordinates;
    NEW.destination_reached_at := OLD.destination_reached_at;
    NEW.returned_to_base_at := OLD.returned_to_base_at;
    NEW.paused_at := OLD.paused_at;
    NEW.pause_location := OLD.pause_location;
    NEW.resumed_at := OLD.resumed_at;
    NEW.end_address := OLD.end_address;
    NEW.end_coordinates := OLD.end_coordinates;
    NEW.end_time := OLD.end_time;
    NEW.farthest_distance_m := OLD.farthest_distance_m;
    NEW.candidate_destination_address := OLD.candidate_destination_address;
    NEW.candidate_destination_coordinates := OLD.candidate_destination_coordinates;
    NEW.active_trip_id := OLD.active_trip_id;

    IF OLD.parent_trip_id IS NULL THEN
      NEW.parent_trip_id := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- A tracker session that has telemetry but never leaves Trade Street's 300 m
-- radius is not a No-TO trip. Reject legacy inserts of those base-only rows.
CREATE OR REPLACE FUNCTION reject_stationary_no_to_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'unmatched'
     AND NEW.active_trip_id IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM gps_telemetry telemetry
        WHERE telemetry.vehicle_id = NEW.vehicle_id
          AND telemetry.active_trip_id = NEW.active_trip_id
     )
     AND NOT EXISTS (
       SELECT 1
         FROM gps_telemetry telemetry
        WHERE telemetry.vehicle_id = NEW.vehicle_id
          AND telemetry.active_trip_id = NEW.active_trip_id
          AND telemetry.latitude IS NOT NULL
          AND telemetry.longitude IS NOT NULL
          AND haversine_distance(
            '8.453993,124.6229589',
            telemetry.latitude::text || ',' || telemetry.longitude::text
          ) > 300
     )
  THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_stationary_no_to_insert ON gps_no_to_logs;

CREATE TRIGGER trg_reject_stationary_no_to_insert
BEFORE INSERT ON gps_no_to_logs
FOR EACH ROW
EXECUTE FUNCTION reject_stationary_no_to_insert();

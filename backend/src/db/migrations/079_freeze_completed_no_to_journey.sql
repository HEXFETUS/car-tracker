-- Once an unmatched No-TO journey has a telemetry-derived End, its journey
-- identity and metrics are immutable. A later link/conversion may still
-- change status because NEW.status will no longer be 'unmatched'.
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
    NEW.parent_trip_id := OLD.parent_trip_id;
  END IF;

  RETURN NEW;
END;
$$;

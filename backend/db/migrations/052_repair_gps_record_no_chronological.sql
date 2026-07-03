-- Repair GPS record numbers to follow chronological order
-- This migration recalculates gps_record_no based on departure_time_gps ASC
-- Newest trips get higher numbers, oldest get lower numbers
-- Format: GPS-YYYY-XXXX (year from departure_time_gps, sequential per year)

DO $$
DECLARE
  affected_rows INTEGER;
BEGIN
  -- Create a temporary table with the new ordered sequence
  CREATE TEMP TABLE gps_repair AS
  WITH ordered_gps AS (
    SELECT 
      id,
      gps_record_no,
      trip_date,
      departure_time_gps,
      created_at,
      -- Extract year from departure_time_gps (fallback to trip_date or created_at)
      COALESCE(
        EXTRACT(YEAR FROM departure_time_gps)::INTEGER,
        EXTRACT(YEAR FROM trip_date::DATE)::INTEGER,
        EXTRACT(YEAR FROM created_at)::INTEGER
      ) AS calc_year,
      -- Assign sequential number ordered by departure_time_gps ASC, created_at ASC, id ASC
      ROW_NUMBER() OVER (
        PARTITION BY 
          COALESCE(
            EXTRACT(YEAR FROM departure_time_gps)::INTEGER,
            EXTRACT(YEAR FROM trip_date::DATE)::INTEGER,
            EXTRACT(YEAR FROM created_at)::INTEGER
          )
        ORDER BY 
          departure_time_gps ASC NULLS LAST,
          created_at ASC,
          id ASC
      ) AS new_seq
    FROM gps_trip_logs
    WHERE gps_record_no IS NOT NULL
  )
  SELECT 
    id,
    'GPS-' || calc_year || '-' || LPAD(new_seq::TEXT, 4, '0') AS new_gps_record_no
  FROM ordered_gps;

  -- Get count of affected rows
  GET DIAGNOSTICS affected_rows = ROW_COUNT;

  -- Update gps_trip_logs with the new sequence
  UPDATE gps_trip_logs g
  SET gps_record_no = r.new_gps_record_no
  FROM gps_repair r
  WHERE g.id = r.id;

  -- Log the result
  RAISE NOTICE 'Repaired % GPS record numbers to chronological order', affected_rows;

  -- Clean up
  DROP TABLE gps_repair;
END $$;

-- Verification query (run this after to check results)
-- SELECT 
--   gps_record_no, 
--   trip_date, 
--   departure_time_gps,
--   CAST(SUBSTRING(gps_record_no FROM '[0-9]+$') AS INTEGER) AS seq
-- FROM gps_trip_logs
-- ORDER BY 
--   CAST(SUBSTRING(gps_record_no FROM '[0-9]+$') AS INTEGER) DESC
-- LIMIT 20;
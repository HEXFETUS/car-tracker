-- Create haversine_distance function for calculating distance between two coordinates
CREATE OR REPLACE FUNCTION haversine_distance(
  coord1 TEXT,
  coord2 TEXT
)
RETURNS FLOAT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  lat1 FLOAT;
  lon1 FLOAT;
  lat2 FLOAT;
  lon2 FLOAT;
  R FLOAT := 6371000; -- Earth's radius in meters
  dLat FLOAT;
  dLon FLOAT;
  a FLOAT;
  c FLOAT;
  d FLOAT;
BEGIN
  -- Parse coordinates (format: "latitude,longitude")
  lat1 := CAST(split_part(coord1, ',', 1) AS FLOAT);
  lon1 := CAST(split_part(coord1, ',', 2) AS FLOAT);
  lat2 := CAST(split_part(coord2, ',', 1) AS FLOAT);
  lon2 := CAST(split_part(coord2, ',', 2) AS FLOAT);
  
  -- Convert to radians
  lat1 := radians(lat1);
  lon1 := radians(lon1);
  lat2 := radians(lat2);
  lon2 := radians(lon2);
  
  -- Haversine formula
  dLat := lat2 - lat1;
  dLon := lon2 - lon1;
  
  a := sin(dLat/2) * sin(dLat/2) + 
       cos(lat1) * cos(lat2) * 
       sin(dLon/2) * sin(dLon/2);
  
  c := 2 * atan2(sqrt(a), sqrt(1-a));
  
  d := R * c;
  
  RETURN d;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION haversine_distance(TEXT, TEXT) TO PUBLIC;
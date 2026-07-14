-- Connect legacy/continuation No-TO fragments to one canonical logical trip.

ALTER TABLE gps_no_to_logs
  ADD COLUMN IF NOT EXISTS parent_trip_id UUID;

ALTER TABLE gps_no_to_logs
  DROP CONSTRAINT IF EXISTS gps_no_to_logs_parent_trip_id_fkey;

ALTER TABLE gps_no_to_logs
  ADD CONSTRAINT gps_no_to_logs_parent_trip_id_fkey
  FOREIGN KEY (parent_trip_id) REFERENCES gps_no_to_logs(id) ON DELETE SET NULL;

ALTER TABLE gps_no_to_logs
  DROP CONSTRAINT IF EXISTS gps_no_to_logs_parent_not_self;

ALTER TABLE gps_no_to_logs
  ADD CONSTRAINT gps_no_to_logs_parent_not_self
  CHECK (parent_trip_id IS NULL OR parent_trip_id <> id);

CREATE INDEX IF NOT EXISTS idx_gps_no_to_logs_parent_trip
  ON gps_no_to_logs(parent_trip_id);

-- A record covering more tracker sessions is the canonical logical journey.
-- Backfill smaller overlapping fragments as children of that record.
WITH coverage AS (
  SELECT n.id,
         COUNT(DISTINCT nat.active_trip_id) AS session_count,
         n.departure_time,
         n.created_at
    FROM gps_no_to_logs n
    LEFT JOIN gps_no_to_log_active_trips nat ON nat.gps_no_to_log_id = n.id
   GROUP BY n.id
), candidates AS (
  SELECT child.id AS child_id,
         parent.id AS parent_id,
         ROW_NUMBER() OVER (
           PARTITION BY child.id
           ORDER BY parent.session_count DESC,
                    parent.departure_time ASC NULLS LAST,
                    parent.created_at ASC,
                    parent.id
         ) AS choice
    FROM coverage child
    JOIN gps_no_to_log_active_trips child_session
      ON child_session.gps_no_to_log_id = child.id
    JOIN gps_no_to_log_active_trips parent_session
      ON parent_session.active_trip_id = child_session.active_trip_id
    JOIN coverage parent ON parent.id = parent_session.gps_no_to_log_id
   WHERE parent.id <> child.id
     AND parent.session_count > child.session_count
)
UPDATE gps_no_to_logs child
   SET parent_trip_id = candidate.parent_id,
       updated_at = current_timestamp
  FROM candidates candidate
 WHERE child.id = candidate.child_id
   AND candidate.choice = 1
   AND child.parent_trip_id IS NULL;

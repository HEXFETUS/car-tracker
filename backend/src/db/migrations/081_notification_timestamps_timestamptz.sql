ALTER TABLE notifications
  ALTER COLUMN created_at TYPE timestamptz
    USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN read_at TYPE timestamptz
    USING read_at AT TIME ZONE 'UTC';

ALTER TABLE notifications
  ALTER COLUMN created_at SET DEFAULT NOW();

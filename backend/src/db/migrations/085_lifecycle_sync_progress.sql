CREATE TABLE IF NOT EXISTS lifecycle_sync_progress (
  job_name TEXT PRIMARY KEY,
  last_created_at TIMESTAMPTZ,
  last_started_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  last_rows_examined INTEGER NOT NULL DEFAULT 0 CHECK (last_rows_examined >= 0),
  last_result TEXT,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO lifecycle_sync_progress (job_name, last_created_at)
VALUES
  ('business-trip-lifecycle', now() - interval '24 hours'),
  ('no-to-lifecycle', now() - interval '24 hours')
ON CONFLICT (job_name) DO NOTHING;

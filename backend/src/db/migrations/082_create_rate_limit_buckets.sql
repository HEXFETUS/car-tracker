CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key        TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_count     INTEGER NOT NULL DEFAULT 1 CHECK (request_count > 0),
  expires_at        TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_expires_at
  ON rate_limit_buckets (expires_at);

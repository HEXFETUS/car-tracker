-- Supabase PostgreSQL Migration: Users Table
-- For User Management (admin, dispatcher, driver, viewer accounts)

CREATE TABLE IF NOT EXISTS users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  username   TEXT NOT NULL UNIQUE,
  password   TEXT NOT NULL,
  user_type  TEXT NOT NULL DEFAULT 'VIEWER',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger function to auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_users_updated_at();

-- Index on username (unique constraint already indexed)
CREATE INDEX idx_users_user_type ON users (user_type);
-- ── Scheduler / Cron Run History Table ─────────────────────────
--
-- Stores the execution history of the Vercel Cron-based scheduler
-- (or any external cron trigger). Each row records one run cycle.
--
-- This replaces the in-memory scheduler state from scheduler.ts
-- for durable status tracking across serverless function invocations.
--
-- Used by:
--   - /api/cron/sync-tracker  (writes a row after each run)
--   - /api/settings/scheduler-runs  (returns last N runs)
--   - /api/settings/connection-status  (reads latest run for dashboard)
--
-- The dashboard reads the most recent run from this table to display:
--   - last cron run time
--   - last cron status (success/error)
--   - last error message
--   - cycles_completed (total count of successful runs)
--   - cron mode: Vercel Cron

CREATE TABLE IF NOT EXISTS scheduler_runs (
  id                SERIAL PRIMARY KEY,
  started_at        TIMESTAMPTZ NOT NULL,
  finished_at       TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'running',  -- 'running', 'success', 'error'
  cycles_completed  INTEGER NOT NULL DEFAULT 0,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast "latest run" lookups
CREATE INDEX IF NOT EXISTS idx_scheduler_runs_started_at
  ON scheduler_runs (started_at DESC);

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_scheduler_runs_status
  ON scheduler_runs (status);
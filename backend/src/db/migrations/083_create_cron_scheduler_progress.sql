CREATE TABLE IF NOT EXISTS cron_scheduler_progress (
  scheduler_name TEXT PRIMARY KEY,
  next_vehicle_offset INTEGER NOT NULL DEFAULT 0 CHECK (next_vehicle_offset >= 0),
  fleet_pass BIGINT NOT NULL DEFAULT 1 CHECK (fleet_pass >= 1),
  last_started_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO cron_scheduler_progress (scheduler_name)
VALUES ('fleet-telemetry')
ON CONFLICT (scheduler_name) DO NOTHING;

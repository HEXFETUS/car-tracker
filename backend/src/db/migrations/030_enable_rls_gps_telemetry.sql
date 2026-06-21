-- ── Enable RLS on gps_telemetry ───────────────────────────────
--
-- Fixes the "UNRESTRICTED" warning by enabling Row Level Security
-- and adding proper access policies:
--   - Service role: can INSERT (for scheduler)
--   - Authenticated users: can SELECT (for API)
--   - Anonymous/public: no access

-- Enable RLS
ALTER TABLE gps_telemetry ENABLE ROW LEVEL SECURITY;

-- Policy: Allow service role to INSERT (used by scheduler)
CREATE POLICY "Allow service role insert"
  ON gps_telemetry
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Policy: Allow authenticated users to SELECT (used by API)
CREATE POLICY "Allow authenticated select"
  ON gps_telemetry
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Block anonymous access (no policy = denied)
-- This is the default behavior when RLS is enabled, but we're
-- being explicit for clarity.
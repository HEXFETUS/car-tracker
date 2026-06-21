-- ── Add SELECT policy for service_role on gps_telemetry ──────
--
-- The backend uses service_role to query gps_telemetry data,
-- but the current RLS policies only allow service_role to INSERT.
-- This migration adds SELECT permission for service_role.

CREATE POLICY "Allow service role select"
  ON gps_telemetry
  FOR SELECT
  TO service_role
  USING (true);
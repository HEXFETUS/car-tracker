-- Create gps_alerts table
CREATE TABLE IF NOT EXISTS gps_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  gps_log_id UUID REFERENCES gps_trip_logs(id) ON DELETE SET NULL,
  alert_type VARCHAR(50) NOT NULL,
  alert_message TEXT NOT NULL,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gps_alerts_vehicle_id ON gps_alerts(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_gps_alerts_created_at ON gps_alerts(created_at DESC);

COMMENT ON TABLE gps_alerts IS 'GPS vehicle alerts generated from telemetry events';
COMMENT ON COLUMN gps_alerts.alert_type IS 'IGNITION_ON, IGNITION_OFF, or IDLING';
COMMENT ON COLUMN gps_alerts.gps_log_id IS 'Optional link to a gps_trip_logs record';
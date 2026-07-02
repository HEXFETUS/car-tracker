-- Make driver_id nullable in gps_trip_logs to support trips without a matched driver or travel order.
-- GPS trips with no matched Travel Order should still be saved; the driver may also be unknown.

ALTER TABLE gps_trip_logs
  ALTER COLUMN driver_id DROP NOT NULL;
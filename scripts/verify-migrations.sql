-- Migration verification script
-- Run this against a fresh database to confirm all migrations apply in sequence

-- Expected migrations in order:
-- 039_gps_trip_logs_unique_index.sql
-- 052_repair_gps_record_no_chronological.sql
-- 056_telemetry_composite_indexes.sql

-- Verify 039
SELECT COUNT(*) AS idx_039_exists
FROM pg_indexes 
WHERE indexname = 'idx_gps_trip_logs_unique_to_vehicle_date';

-- Verify 052 (no direct check - it's a data migration)
-- Check if gps_record_no values are populated
SELECT 
  COUNT(*) FILTER (WHERE gps_record_no IS NOT NULL) AS has_record_nos,
  COUNT(*) FILTER (WHERE gps_record_no IS NULL) AS missing_record_nos
FROM gps_trip_logs;

-- Verify 056
SELECT indexname, tablename
FROM pg_indexes 
WHERE indexname IN (
  'idx_gps_telemetry_vehicle_recorded_event',
  'idx_gps_telemetry_vehicle_trip_location',
  'idx_gps_telemetry_vehicle_latest',
  'idx_gps_idling_dedup_vehicle_trip_active'
)
ORDER BY indexname;

-- Verify 057
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'gps_telemetry'
  AND column_name IN ('telegram_status', 'telegram_error', 'telegram_attempted_at')
ORDER BY column_name;

-- Verify 058
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'scheduler_runs'
  AND column_name IN (
    'vehicles_processed',
    'telemetry_saved',
    'telegram_sent',
    'telegram_failed',
    'skip_reason'
  )
ORDER BY column_name;

-- Summary
SELECT 
  COUNT(DISTINCT indexname) AS indexes_created,
  COUNT(DISTINCT schemaname) AS schemas
FROM pg_indexes 
WHERE indexname LIKE 'idx_gps_telemetry_%' 
   OR indexname LIKE 'idx_gps_idling_dedup_%';

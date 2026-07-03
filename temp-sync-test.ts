import { syncGpsTripLogsFromTelemetry } from './backend/src/services/gpsLogService.js';

async function main() {
  console.log('Starting syncGpsTripLogsFromTelemetry...');
  const result = await syncGpsTripLogsFromTelemetry();
  console.log('Sync result:', JSON.stringify(result));
  process.exit(0);
}

main().catch(err => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
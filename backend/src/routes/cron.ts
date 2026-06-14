// ── Cron / Scheduled Sync Endpoint ────────────────────────────
//
// GET /api/cron/sync-tracker
//
// Protected endpoint that triggers one fleet telemetry sync cycle.
// Authentication is performed by matching the X-Cron-Secret header
// (or ?secret= query parameter) against the CRON_SECRET env variable.
//
// Usage (external cron service — e.g. cron-job.org):
//   GET https://your-api.example.com/api/cron/sync-tracker
//   Headers: { "X-Cron-Secret": "your-cron-secret-here" }

import { Router, Request, Response } from 'express';
import { CRON_SECRET } from '../config/env.js';
import { syncFleetAndAlert } from '@car-tracker/tracker';
import {
  saveGpsTripLog,
  resolveGpsLogRelations,
} from '../services/gpsLogService.js';

const router: Router = Router();

/**
 * Validate the cron request by checking the secret.
 * Accepts the secret via:
 *   - X-Cron-Secret header
 *   - ?secret= query parameter
 */
function isAuthorized(req: Request): boolean {
  if (!CRON_SECRET) return false;
  const headerSecret = req.headers['x-cron-secret'] as string | undefined;
  if (headerSecret === CRON_SECRET) return true;
  const querySecret = req.query.secret as string | undefined;
  if (querySecret === CRON_SECRET) return true;
  return false;
}

/**
 * GET /api/cron/sync-tracker
 *
 * Triggers a single fleet sync & alert cycle.
 * Returns a JSON summary of what happened.
 */
router.get('/sync-tracker', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized — missing or invalid cron secret',
    });
    return;
  }

  const startTime = Date.now();

  try {
    const result = await syncFleetAndAlert();

    // ── GPS Trip Log Persistence ─────────────────────────────
    // Loop through processed vehicle structures and save trip
    // log records to the gps_trip_logs table.
    let gpsLogsSaved = 0;
    let gpsLogsFailed = 0;

    if (result.tripLogs && result.tripLogs.length > 0) {
      for (const tripLog of result.tripLogs) {
        try {
          // Resolve relational IDs (vehicle, driver, travel order)
          const relations = await resolveGpsLogRelations({
            plateNumber: tripLog.plateNumber,
            driverName: tripLog.driverName || null,
          });

          // Skip vehicles not found in our database
          if (!relations.vehicleId) {
            gpsLogsFailed += 1;
            continue;
          }

          // Generate unique GPS record number: GPS-{PLATE}-{TIMESTAMP}
          const timestamp = Date.now();
          const gpsRecordNo = `GPS-${tripLog.plateNumber}-${timestamp}`;

          // Build the anomaly flag — TRUE if speeding, low fuel,
          // or if vehicle is active but has no linked travel order
          const unauthorizedMovement =
            !relations.travelOrderId &&
            tripLog.tripStatus === 'Moving';
          const anomalyFlag =
            tripLog.anomalyFlag || unauthorizedMovement;

          // Determine trip status for the database constraint
          const validStatuses = [
            'departed',
            'en-route',
            'arrived',
            'cancelled',
            'completed',
          ];
          let tripStatusGps = 'en-route';
          if (tripLog.tripStatus === 'Moving') tripStatusGps = 'en-route';
          else if (tripLog.tripStatus === 'Parked') tripStatusGps = 'arrived';
          else if (tripLog.tripStatus === 'Idling') tripStatusGps = 'en-route';
          if (!validStatuses.includes(tripStatusGps)) {
            tripStatusGps = 'en-route';
          }

          await saveGpsTripLog({
            gpsRecordNo,
            tripDate: tripLog.tripDate,
            vehicleId: relations.vehicleId,
            driverId:
              relations.driverId || '00000000-0000-0000-0000-000000000000',
            originGpsStartPoint: tripLog.originGpsStartPoint || '',
            destinationGpsEndPoint: tripLog.destinationGpsEndPoint || '',
            actualRouteRoadTaken: tripLog.actualRouteRoadTaken || '',
            departureTimeGps: tripLog.departureTimeGps || null,
            arrivalTimeGps: tripLog.arrivalTimeGps || null,
            gpsDistanceKm: Number(tripLog.gpsDistanceKm) || 0,
            engineHours: Number(tripLog.engineHours) || 0,
            maxSpeedKph: Number(tripLog.maxSpeedKph) || 0,
            tripStatusGps,
            travelOrderId: relations.travelOrderId,
            toStatusAuto: relations.toStatusAuto,
            anomalyFlag,
            notesRemarks: null,
          });

          gpsLogsSaved += 1;
        } catch (logError) {
          console.error(
            'GPS log save error for vehicle',
            tripLog.plateNumber,
            ':',
            (logError as Error).message,
          );
          gpsLogsFailed += 1;
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    res.json({
      success: true,
      elapsed_seconds: parseFloat(elapsed),
      total_active_units: result.vehicles,
      alerts_dispatched: result.alerts.sent,
      alerts_skipped: result.alerts.skipped,
      alerts_failed: result.alerts.failed,
      alerts_persisted: result.alerts.persisted,
      gps_logs_saved: gpsLogsSaved,
      gps_logs_failed: gpsLogsFailed,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const message = error instanceof Error ? error.message : String(error);

    console.error('Cron sync error:', message);

    res.status(500).json({
      success: false,
      error: message,
      elapsed_seconds: parseFloat(elapsed),
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
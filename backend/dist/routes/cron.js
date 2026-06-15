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
import { Router } from 'express';
import { CRON_SECRET } from '../config/env.js';
import { syncFleetAndAlert } from '@car-tracker/tracker';
import { getPool } from '../db/db.js';
import { saveGpsTripLog, findActiveTravelOrder, findDriverByName, } from '../services/gpsLogService.js';
/**
 * Clamp a numeric value to fit within a PostgreSQL NUMERIC(p,s) column.
 * Returns a string to avoid JS floating-point precision loss.
 */
function clampNumeric(value, max) {
    if (!Number.isFinite(value) || value < 0)
        return '0';
    return Math.min(value, max).toFixed(2);
}
const router = Router();
/**
 * Generate a GPS record number in the format GPS-{YEAR}-{SEQUENTIAL}
 * by querying the max existing sequence number for the current year.
 */
async function generateGpsRecordNo() {
    const pool = getPool();
    const year = new Date().getFullYear();
    const result = await pool.query(`SELECT MAX(CAST(SPLIT_PART(gps_record_no, '-', 3) AS INTEGER)) AS max_seq
       FROM gps_trip_logs
      WHERE gps_record_no LIKE $1`, [`GPS-${year}-%`]);
    const nextSeq = (parseInt(result.rows[0]?.max_seq || '0', 10)) + 1;
    return `GPS-${year}-${String(nextSeq).padStart(4, '0')}`;
}
/**
 * Validate the cron request by checking the secret.
 * Accepts the secret via:
 *   - X-Cron-Secret header
 *   - ?secret= query parameter
 */
function isAuthorized(req) {
    if (!CRON_SECRET)
        return false;
    const headerSecret = req.headers['x-cron-secret'];
    if (headerSecret === CRON_SECRET)
        return true;
    const querySecret = req.query.secret;
    if (querySecret === CRON_SECRET)
        return true;
    return false;
}
/**
 * GET /api/cron/sync-tracker
 *
 * Triggers a single fleet sync & alert cycle.
 * Returns a JSON summary of what happened.
 */
router.get('/sync-tracker', async (req, res) => {
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
                    // The tracker has already validated the plate number against
                    // the vehicles table and assigned a resolved database vehicle_id.
                    const vehicleId = tripLog.vehicleId;
                    if (!vehicleId) {
                        // Safety guard: trip log without a resolved vehicle_id should
                        // never reach here, but skip if it does.
                        gpsLogsFailed += 1;
                        continue;
                    }
                    // Resolve travel order and driver in parallel
                    const [travelOrder, directDriverId] = await Promise.all([
                        findActiveTravelOrder(vehicleId),
                        tripLog.driverName ? findDriverByName(tripLog.driverName) : Promise.resolve(null),
                    ]);
                    const driverId = travelOrder?.driver_id ?? directDriverId ?? null;
                    const travelOrderId = travelOrder?.id ?? null;
                    const toStatusAuto = travelOrder?.status ?? null;
                    // ── Strict driver validation ──────────────────────────
                    // driver_id on gps_trip_logs is NOT NULL with a FK constraint
                    // to the drivers table. If no valid driver resolves, skip.
                    const resolvedDriverId = driverId || null;
                    if (!resolvedDriverId) {
                        console.log('Skipping GPS log for vehicle', tripLog.plateNumber, '— no driver resolved');
                        gpsLogsFailed += 1;
                        continue;
                    }
                    // ── Clamp numeric fields ──────────────────────────────
                    // PostgreSQL NUMERIC(10,2) for gps_distance_km
                    // PostgreSQL NUMERIC(8,2) for engine_hours
                    // PostgreSQL NUMERIC(6,2) for max_speed_kph
                    const clampedGpsDistanceKm = Number(clampNumeric(Number(tripLog.gpsDistanceKm) || 0, 99999999.99));
                    const clampedEngineHours = Number(clampNumeric(Number(tripLog.engineHours) || 0, 999999.99));
                    const clampedMaxSpeedKph = Number(clampNumeric(Number(tripLog.maxSpeedKph) || 0, 9999.99));
                    // Generate unique GPS record number: GPS-{YEAR}-{SEQUENTIAL}
                    const gpsRecordNo = await generateGpsRecordNo();
                    // Build the anomaly flag — TRUE if speeding, low fuel,
                    // or if vehicle is active but has no linked travel order
                    const unauthorizedMovement = !travelOrderId &&
                        tripLog.tripStatus === 'Moving';
                    const anomalyFlag = tripLog.anomalyFlag || unauthorizedMovement;
                    // Determine trip status for the database constraint
                    const validStatuses = [
                        'departed',
                        'en-route',
                        'arrived',
                        'cancelled',
                        'completed',
                    ];
                    let tripStatusGps = 'en-route';
                    if (tripLog.tripStatus === 'Moving')
                        tripStatusGps = 'en-route';
                    else if (tripLog.tripStatus === 'Parked')
                        tripStatusGps = 'arrived';
                    else if (tripLog.tripStatus === 'Idling')
                        tripStatusGps = 'en-route';
                    if (!validStatuses.includes(tripStatusGps)) {
                        tripStatusGps = 'en-route';
                    }
                    await saveGpsTripLog({
                        gpsRecordNo,
                        tripDate: tripLog.tripDate,
                        vehicleId,
                        driverId: resolvedDriverId,
                        originGpsStartPoint: tripLog.originGpsStartPoint || '',
                        destinationGpsEndPoint: tripLog.destinationGpsEndPoint || '',
                        actualRouteRoadTaken: tripLog.actualRouteRoadTaken || '',
                        departureTimeGps: tripLog.departureTimeGps || null,
                        arrivalTimeGps: tripLog.arrivalTimeGps || null,
                        gpsDistanceKm: clampedGpsDistanceKm,
                        engineHours: clampedEngineHours,
                        maxSpeedKph: clampedMaxSpeedKph,
                        tripStatusGps,
                        travelOrderId,
                        toStatusAuto,
                        anomalyFlag,
                        notesRemarks: null,
                    });
                    gpsLogsSaved += 1;
                }
                catch (logError) {
                    console.error('GPS log save error for vehicle', tripLog.plateNumber, ':', logError.message);
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
    }
    catch (error) {
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
//# sourceMappingURL=cron.js.map
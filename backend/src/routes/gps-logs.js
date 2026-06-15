import express from 'express';
import { getPool } from '../db/db.js';
import { syncFleetAndAlert } from '@car-tracker/tracker';
import { saveGpsTripLog, findVehicleByPlate, findActiveTravelOrder, findDriverByName, findApprovedTravelOrderForDate, } from '../services/gpsLogService.js';
import { resolveCartrackUnitId, fetchCartrackVehicleHistory, transformHistoryToTrips, } from '../services/cartrackHistoryService.js';
/**
 * Clamp a numeric value to fit within a PostgreSQL NUMERIC(p,s) column.
 * Returns a string to avoid JS floating-point precision loss.
 */
function clampNumeric(value, max) {
    if (!Number.isFinite(value) || value < 0)
        return '0';
    return Math.min(value, max).toFixed(2);
}
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
const router = express.Router();
// GET /api/gps-logs — List all with LEFT JOINs for enrichment
router.get('/', async (req, res) => {
    try {
        const pool = getPool();
        const page = Math.max(1, Number(req.query.page) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
        const offset = (page - 1) * pageSize;
        // Build WHERE clause from optional filters
        const conditions = [];
        const params = [];
        if (req.query.vehicleId) {
            conditions.push(`g.vehicle_id = $${params.length + 1}`);
            params.push(req.query.vehicleId);
        }
        if (req.query.driverId) {
            conditions.push(`g.driver_id = $${params.length + 1}`);
            params.push(req.query.driverId);
        }
        if (req.query.tripDate) {
            conditions.push(`g.trip_date = $${params.length + 1}`);
            params.push(req.query.tripDate);
        }
        if (req.query.anomalyFlag !== undefined) {
            conditions.push(`g.anomaly_flag = $${params.length + 1}`);
            params.push(req.query.anomalyFlag === 'true');
        }
        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        // Count total matching rows
        const countResult = await pool.query(`SELECT COUNT(*) AS total FROM gps_trip_logs g ${whereClause}`, params);
        const total = parseInt(countResult.rows[0]?.total || '0', 10);
        // Fetch paginated data with joins
        const dataParams = [...params, pageSize, offset];
        const dataResult = await pool.query(`SELECT
        g.*,
        v.plate_number,
        d.full_name AS driver_full_name,
        t_o.to_number AS travel_order_to_number
      FROM gps_trip_logs g
      LEFT JOIN vehicles      v   ON v.id = g.vehicle_id
      LEFT JOIN drivers       d   ON d.id = g.driver_id
      LEFT JOIN travel_orders t_o ON t_o.id = g.travel_order_id
      ${whereClause}
      ORDER BY g.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, dataParams);
        const data = dataResult.rows.map(mapRow);
        const response = {
            success: true,
            data,
            total,
            page,
            pageSize,
            message: 'GPS logs retrieved successfully',
        };
        res.json(response);
    }
    catch (error) {
        console.error('GET /api/gps-logs error:', error.message);
        res.status(500).json({ success: false, data: null, error: 'Database error' });
    }
});
// POST /api/gps-logs — Create a new GPS log
router.post('/', async (req, res) => {
    const body = req.body;
    const requiredFields = ['gpsRecordNo', 'tripDate', 'vehicleId', 'driverId', 'originGpsStartPoint', 'destinationGpsEndPoint', 'tripStatusGps'];
    for (const field of requiredFields) {
        if (!body[field]) {
            res.status(400).json({
                success: false,
                data: null,
                error: `Missing required field: ${field}`,
            });
            return;
        }
    }
    const validStatuses = ['departed', 'en-route', 'arrived', 'cancelled', 'completed'];
    if (!validStatuses.includes(body.tripStatusGps)) {
        res.status(400).json({
            success: false,
            data: null,
            error: `Invalid tripStatusGps. Must be one of: ${validStatuses.join(', ')}`,
        });
        return;
    }
    try {
        const pool = getPool();
        const result = await pool.query(`INSERT INTO gps_trip_logs
        (gps_record_no, trip_date, vehicle_id, driver_id,
         origin_gps_start_point, destination_gps_end_point,
         actual_route_road_taken, departure_time_gps, arrival_time_gps,
         gps_distance_km, engine_hours, max_speed_kph,
         trip_status_gps, travel_order_id, to_status_auto,
         anomaly_flag, notes_remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING *`, [
            body.gpsRecordNo, body.tripDate, body.vehicleId, body.driverId,
            body.originGpsStartPoint, body.destinationGpsEndPoint,
            body.actualRouteRoadTaken || '', body.departureTimeGps || null, body.arrivalTimeGps || null,
            Number(body.gpsDistanceKm) || 0, Number(body.engineHours) || 0, Number(body.maxSpeedKph) || 0,
            body.tripStatusGps, body.travelOrderId || null, body.toStatusAuto || null,
            Boolean(body.anomalyFlag), body.notesRemarks || null,
        ]);
        res.status(201).json({
            success: true,
            data: mapRow(result.rows[0]),
            message: 'GPS log created successfully',
        });
    }
    catch (error) {
        console.error('POST /api/gps-logs error:', error.message);
        res.status(500).json({ success: false, data: null, error: 'Database error' });
    }
});
// POST /api/gps-logs/sync — Trigger fleet sync for the selected date
router.post('/sync', async (req, res) => {
    const startTime = Date.now();
    try {
        // Use the backend's direct PostgreSQL pool for plate validation
        // instead of Supabase REST API (which may not be configured).
        const result = await syncFleetAndAlert({
            resolveVehicleId: (plateNumber) => findVehicleByPlate(plateNumber),
        });
        // ── GPS Trip Log Persistence ─────────────────────────────
        let gpsLogsSaved = 0;
        let gpsLogsFailed = 0;
        if (result.tripLogs && result.tripLogs.length > 0) {
            for (const tripLog of result.tripLogs) {
                try {
                    const vehicleId = tripLog.vehicleId;
                    if (!vehicleId) {
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
                    const resolvedDriverId = driverId || null;
                    if (!resolvedDriverId) {
                        console.log('Skipping GPS log for vehicle', tripLog.plateNumber, '— no driver resolved');
                        gpsLogsFailed += 1;
                        continue;
                    }
                    // ── Clamp numeric fields ──────────────────────────────
                    const clampedGpsDistanceKm = Number(clampNumeric(Number(tripLog.gpsDistanceKm) || 0, 99999999.99));
                    const clampedEngineHours = Number(clampNumeric(Number(tripLog.engineHours) || 0, 999999.99));
                    const clampedMaxSpeedKph = Number(clampNumeric(Number(tripLog.maxSpeedKph) || 0, 9999.99));
                    const timestamp = Date.now();
                    const gpsRecordNo = await generateGpsRecordNo();
                    const unauthorizedMovement = !travelOrderId && tripLog.tripStatus === 'Moving';
                    const anomalyFlag = tripLog.anomalyFlag || unauthorizedMovement;
                    const validStatuses = ['departed', 'en-route', 'arrived', 'cancelled', 'completed'];
                    let tripStatusGps = 'en-route';
                    if (tripLog.tripStatus === 'Moving')
                        tripStatusGps = 'en-route';
                    else if (tripLog.tripStatus === 'Parked')
                        tripStatusGps = 'arrived';
                    else if (tripLog.tripStatus === 'Idling')
                        tripStatusGps = 'en-route';
                    if (!validStatuses.includes(tripStatusGps))
                        tripStatusGps = 'en-route';
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
        console.error('GPS logs sync error:', message);
        res.status(500).json({ success: false, error: message, elapsed_seconds: parseFloat(elapsed) });
    }
});
// ─────────────────────────────────────────────────────────────────
// Targeted Historical Sync Endpoint
// GET /api/gps-logs/sync-history?vehicle_id=...&date=2026-06-14
//
// Before fetching historical telemetry from Cartrack, this endpoint
// validates that an approved/active/completed travel order exists
// for the specified vehicle on the specified date. If no matching
// travel order is found, the sync is aborted.
// ─────────────────────────────────────────────────────────────────
router.get('/sync-history', async (req, res) => {
    const startTime = Date.now();
    try {
        const vehicleId = req.query.vehicle_id;
        const dateStr = req.query.date;
        // ── Validate parameters ──────────────────────────────────
        if (!vehicleId) {
            res.status(400).json({ success: false, error: 'Missing required query parameter: vehicle_id' });
            return;
        }
        if (!dateStr) {
            res.status(400).json({ success: false, error: 'Missing required query parameter: date' });
            return;
        }
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(dateStr)) {
            res.status(400).json({ success: false, error: 'Invalid date format. Expected YYYY-MM-DD.' });
            return;
        }
        // ── Step 1: Resolve plate number from vehicle_id ─────────
        const pool = getPool();
        const vehicleResult = await pool.query(`SELECT plate_number FROM vehicles WHERE id = $1 LIMIT 1`, [vehicleId]);
        const plateNumber = vehicleResult.rows[0]?.plate_number;
        if (!plateNumber) {
            res.status(400).json({ success: false, error: 'Vehicle not found for the given vehicle_id' });
            return;
        }
        // ── Step 2: Strict Sync Guard ────────────────────────────
        const approvedOrder = await findApprovedTravelOrderForDate(vehicleId, dateStr);
        if (!approvedOrder) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`Sync history aborted for vehicle ${plateNumber} on ${dateStr}: no approved travel order found`);
            res.json({
                success: true,
                synced: false,
                elapsed_seconds: parseFloat(elapsed),
                message: 'No approved travel order found for this vehicle on the specified date. Sync aborted.',
                timestamp: new Date().toISOString(),
            });
            return;
        }
        console.log(`Approved travel order ${approvedOrder.id} (${approvedOrder.status}) found for ${plateNumber} on ${dateStr}. Proceeding with sync.`);
        // ── Step 3: Resolve Cartrack unit ID ─────────────────────
        const unitInfo = await resolveCartrackUnitId(plateNumber);
        if (!unitInfo) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            res.json({
                success: true,
                synced: false,
                elapsed_seconds: parseFloat(elapsed),
                message: `Could not resolve Cartrack unit ID for plate ${plateNumber}. Sync skipped.`,
                timestamp: new Date().toISOString(),
            });
            return;
        }
        // ── Step 4: Fetch historical tracking data from Cartrack ──
        const historyPoints = await fetchCartrackVehicleHistory(unitInfo.unitId, dateStr, plateNumber);
        console.log(`Fetched ${historyPoints.length} history points from Cartrack for ${plateNumber} on ${dateStr}`);
        // ── Step 5: Transform into trip data ──────────────────────
        const trips = transformHistoryToTrips(historyPoints, plateNumber, dateStr);
        // ── Step 6: Strict driver validation ──────────────────────
        const travelOrderId = approvedOrder.id;
        const resolvedDriverId = approvedOrder.driver_id || null;
        if (!resolvedDriverId) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log('Sync-history aborted — no driver assigned to travel order');
            res.json({
                success: true,
                synced: false,
                elapsed_seconds: parseFloat(elapsed),
                message: 'Approved travel order found but no driver is assigned. Sync aborted.',
                timestamp: new Date().toISOString(),
            });
            return;
        }
        // ── Step 7: Save the GPS trip log ─────────────────────────
        let gpsLogsSaved = 0;
        let gpsLogsFailed = 0;
        for (const [index, tripData] of trips.entries()) {
            const gpsRecordNo = await generateGpsRecordNo();
            try {
                await saveGpsTripLog({
                    gpsRecordNo,
                    tripDate: dateStr,
                    vehicleId,
                    driverId: resolvedDriverId,
                    originGpsStartPoint: tripData.originGpsStartPoint,
                    destinationGpsEndPoint: tripData.destinationGpsEndPoint,
                    actualRouteRoadTaken: tripData.actualRouteRoadTaken || '',
                    departureTimeGps: tripData.departureTimeGps || null,
                    arrivalTimeGps: tripData.arrivalTimeGps || null,
                    gpsDistanceKm: tripData.gpsDistanceKm,
                    engineHours: tripData.engineHours,
                    maxSpeedKph: tripData.maxSpeedKph,
                    tripStatusGps: tripData.tripStatus,
                    travelOrderId,
                    toStatusAuto: approvedOrder.status,
                    anomalyFlag: tripData.maxSpeedKph > 120,
                    notesRemarks: null, // editable via edit button
                });
                gpsLogsSaved += 1;
            }
            catch (logError) {
                console.error('Sync-history save error:', logError.message);
                gpsLogsFailed += 1;
            }
        }
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        res.json({
            success: true,
            synced: true,
            elapsed_seconds: parseFloat(elapsed),
            travel_order_id: travelOrderId,
            travel_order_status: approvedOrder.status,
            total_records_found: historyPoints.length,
            trips_found: trips.length,
            gps_logs_saved: gpsLogsSaved,
            gps_logs_failed: gpsLogsFailed,
            message: `Historical sync completed for vehicle on ${dateStr} under approved travel order.`,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        const message = error instanceof Error ? error.message : String(error);
        console.error('GPS logs sync-history error:', message);
        res.status(500).json({ success: false, error: message, elapsed_seconds: parseFloat(elapsed) });
    }
});
// PATCH /api/gps-logs/:id — Update allowed fields
router.patch('/:id', async (req, res) => {
    const allowedFields = [
        'anomaly_flag', 'notes_remarks', 'trip_status_gps', 'actual_route_road_taken',
        'arrival_time_gps', 'gps_distance_km', 'engine_hours', 'max_speed_kph',
        'to_status_auto', 'travel_order_id',
    ];
    const updates = [];
    const values = [];
    let idx = 1;
    for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
            updates.push(`${field} = $${idx++}`);
            values.push(req.body[field]);
        }
    }
    if (updates.length === 0) {
        res.status(400).json({ success: false, data: null, error: 'No valid fields to update' });
        return;
    }
    try {
        const pool = getPool();
        values.push(req.params.id);
        const result = await pool.query(`UPDATE gps_trip_logs SET ${updates.join(', ')} WHERE id = $${idx}
       RETURNING *`, values);
        if (result.rows.length === 0) {
            res.status(404).json({ success: false, data: null, error: 'GPS log not found' });
            return;
        }
        res.json({ success: true, data: mapRow(result.rows[0]), message: 'GPS log updated successfully' });
    }
    catch (error) {
        console.error('PATCH /api/gps-logs/:id error:', error.message);
        res.status(500).json({ success: false, data: null, error: 'Database error' });
    }
});
// DELETE /api/gps-logs/:id — Delete a GPS log (superadmin only)
router.delete('/:id', async (req, res) => {
    try {
        const pool = getPool();
        const result = await pool.query(`DELETE FROM gps_trip_logs WHERE id = $1 RETURNING id`, [req.params.id]);
        if (result.rows.length === 0) {
            res.status(404).json({ success: false, error: 'GPS log not found' });
            return;
        }
        res.json({ success: true, message: 'GPS log deleted successfully' });
    }
    catch (error) {
        console.error('DELETE /api/gps-logs/:id error:', error.message);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});
// GET /api/gps-logs/:id — Get single GPS log by ID
router.get('/:id', async (req, res) => {
    try {
        const pool = getPool();
        const result = await pool.query(`SELECT
        g.*,
        v.plate_number,
        d.full_name AS driver_full_name,
        t_o.to_number AS travel_order_to_number
      FROM gps_trip_logs g
      LEFT JOIN vehicles      v   ON v.id = g.vehicle_id
      LEFT JOIN drivers       d   ON d.id = g.driver_id
      LEFT JOIN travel_orders t_o ON t_o.id = g.travel_order_id
      WHERE g.id = $1`, [req.params.id]);
        if (result.rows.length === 0) {
            res.status(404).json({ success: false, data: null, error: 'GPS log not found' });
            return;
        }
        res.json({ success: true, data: mapRow(result.rows[0]) });
    }
    catch (error) {
        console.error('GET /api/gps-logs/:id error:', error.message);
        res.status(500).json({ success: false, data: null, error: 'Database error' });
    }
});
function mapRow(row) {
    return {
        id: row.id,
        gpsRecordNo: row.gps_record_no,
        tripDate: row.trip_date,
        vehicleId: row.vehicle_id,
        driverId: row.driver_id,
        originGpsStartPoint: row.origin_gps_start_point,
        destinationGpsEndPoint: row.destination_gps_end_point,
        actualRouteRoadTaken: row.actual_route_road_taken,
        departureTimeGps: row.departure_time_gps,
        arrivalTimeGps: row.arrival_time_gps,
        gpsDistanceKm: row.gps_distance_km,
        engineHours: row.engine_hours,
        maxSpeedKph: row.max_speed_kph,
        tripStatusGps: row.trip_status_gps,
        travelOrderId: row.travel_order_id,
        toStatusAuto: row.to_status_auto,
        anomalyFlag: row.anomaly_flag,
        notesRemarks: row.notes_remarks,
        vehiclePlateNo: row.plate_number ?? 'Unknown',
        driverName: row.driver_full_name ?? 'Unknown',
        toNumber: row.travel_order_to_number ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
export default router;
//# sourceMappingURL=gps-logs.js.map
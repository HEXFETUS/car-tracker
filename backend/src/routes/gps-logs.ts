import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import type { ApiResponse } from '@car-tracker/shared';
import { getPool } from '../db/db.js';
import { syncFleetAndAlert } from '@car-tracker/tracker';
import {
  saveGpsTripLog,
  findVehicleByPlate,
  findActiveTravelOrder,
  findDriverByName,
  findApprovedTravelOrderForDate,
  findAllTravelOrdersForDate,
  matchTravelOrderToGpsTrip,
  persistGpsTripLogs,
  generateGpsRecordNo,
  type TravelOrderWithTimes,
} from '../services/gpsLogService.js';
import { fetchGpsAlerts, getVehiclePlate } from '../services/gpsAlertService.js';
import {
  resolveCartrackUnitId,
  fetchCartrackVehicleHistory,
  transformHistoryToTrips,
} from '../services/cartrackHistoryService.js';

const router: ExpressRouter = express.Router();

interface GpsLogRow {
  id: string;
  gps_record_no: string;
  trip_date: string;
  vehicle_id: string;
  driver_id: string;
  origin_gps_start_point: string;
  destination_gps_end_point: string;
  actual_route_road_taken: string;
  departure_time_gps: string | null;
  arrival_time_gps: string | null;
  gps_distance_km: number | null;
  engine_hours: number | null;
  max_speed_kph: number | null;
  trip_status_gps: string;
  travel_order_id: string | null;
  to_status_auto: string | null;
  anomaly_flag: boolean;
  notes_remarks: string | null;
  created_at: string;
  updated_at: string;
  // Enhanced trip detection fields
  destination_verified: boolean;
  trip_type: string;
  parent_trip_id: string | null;
  location_name: string | null;
  coordinates_origin: string | null;
  coordinates_destination: string | null;
  // Joined columns
  plate_number?: string;
  driver_full_name?: string;
  travel_order_to_number?: string | null;
}

// GET /api/gps-logs — List all with LEFT JOINs for enrichment
router.get('/', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    // Build WHERE clause from optional filters
    const conditions: string[] = [];
    const params: unknown[] = [];

    // Always filter: only show logs where the car was turned on (has departure time)
    conditions.push('g.departure_time_gps IS NOT NULL');

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
    const countResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM gps_trip_logs g ${whereClause}`,
      params,
    );
    const total = parseInt(countResult.rows[0]?.total || '0', 10);

    // Fetch paginated data with joins
    const dataParams = [...params, pageSize, offset];
    const dataResult = await pool.query<GpsLogRow>(
      `SELECT
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
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      dataParams,
    );

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
  } catch (error) {
    console.error('GET /api/gps-logs error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// POST /api/gps-logs — Create a new GPS log
router.post('/', async (req: Request, res: Response) => {
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
    const result = await pool.query<GpsLogRow>(
      `INSERT INTO gps_trip_logs
        (gps_record_no, trip_date, vehicle_id, driver_id,
         origin_gps_start_point, destination_gps_end_point,
         actual_route_road_taken, departure_time_gps, arrival_time_gps,
         gps_distance_km, engine_hours, max_speed_kph,
         trip_status_gps, travel_order_id, to_status_auto,
         anomaly_flag, notes_remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING *`,
      [
        body.gpsRecordNo, body.tripDate, body.vehicleId, body.driverId,
        body.originGpsStartPoint, body.destinationGpsEndPoint,
        body.actualRouteRoadTaken || '', body.departureTimeGps || null, body.arrivalTimeGps || null,
        Number(body.gpsDistanceKm) || 0, Number(body.engineHours) || 0, Number(body.maxSpeedKph) || 0,
        body.tripStatusGps, body.travelOrderId || null, body.toStatusAuto || null,
        Boolean(body.anomalyFlag), body.notesRemarks || null,
      ],
    );

    res.status(201).json({
      success: true,
      data: mapRow(result.rows[0]),
      message: 'GPS log created successfully',
    });
  } catch (error) {
    console.error('POST /api/gps-logs error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// POST /api/gps-logs/sync — Trigger fleet sync and persist GPS trip logs
router.post('/sync', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    // Use the backend's direct PostgreSQL pool for plate validation
    // instead of Supabase REST API (which may not be configured).
    const result = await syncFleetAndAlert({
      resolveVehicleId: (plateNumber: string) => findVehicleByPlate(plateNumber),
    });

    // ── GPS Trip Log Persistence ─────────────────────────────
    // Uses the shared persistGpsTripLogs() function which handles
    // travel order resolution, driver validation, record number
    // generation, and status mapping — same logic as the scheduler.
    let gpsLogsSaved = 0;
    let gpsLogsFailed = 0;
    if (result.tripLogs && result.tripLogs.length > 0) {
      const persistResult = await persistGpsTripLogs(result.tripLogs);
      gpsLogsSaved = persistResult.saved;
      gpsLogsFailed = persistResult.failed;
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

router.get('/sync-history', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const vehicleId = req.query.vehicle_id as string | undefined;
    const dateStr = req.query.date as string | undefined;

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
    const vehicleResult = await pool.query<{ plate_number: string }>(
      `SELECT plate_number FROM vehicles WHERE id = $1 LIMIT 1`,
      [vehicleId],
    );
    const plateNumber = vehicleResult.rows[0]?.plate_number;
    if (!plateNumber) {
      res.status(400).json({ success: false, error: 'Vehicle not found for the given vehicle_id' });
      return;
    }

    // ── Step 2: Find ALL approved/active/completed travel orders for this vehicle on this date ──
    const travelOrderCandidates = await findAllTravelOrdersForDate(vehicleId, dateStr);

    if (!travelOrderCandidates || travelOrderCandidates.length === 0) {
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

    console.log(
      `${travelOrderCandidates.length} travel order(s) found for ${plateNumber} on ${dateStr}. Proceeding with sync.`,
    );

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
    // Use the first travel order's driver for validation; each trip
    // will be matched to the best-fit TO later.
    const primaryTO = travelOrderCandidates[0];
    const resolvedDriverId = primaryTO.driver_id || null;
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

    // ── Step 7: Save the GPS trip log with smart TO matching ──
    let gpsLogsSaved = 0;
    let gpsLogsFailed = 0;
    // Track the last matched TO for response reporting
    let lastMatchedTOId: string | null = null;
    let lastMatchedTOStatus: string = primaryTO.status;

    for (const [index, tripData] of trips.entries()) {
      const gpsRecordNo = await generateGpsRecordNo();

      // Match each GPS trip to the best travel order based on departure/arrival times
      const matchedTO = matchTravelOrderToGpsTrip(
        tripData.departureTimeGps || null,
        tripData.arrivalTimeGps || null,
        null, // coordinates not available from historical Cartrack data
        travelOrderCandidates,
      );

      const matchedTOId = matchedTO?.id ?? null;
      const matchedTOStatus = matchedTO?.status ?? primaryTO.status;
      const matchedTODriverId = matchedTO?.driver_id ?? resolvedDriverId;
      lastMatchedTOId = matchedTOId;
      lastMatchedTOStatus = matchedTOStatus;

      try {
        await saveGpsTripLog({
          gpsRecordNo,
          tripDate: dateStr,
          vehicleId,
          driverId: matchedTODriverId,
          originGpsStartPoint: tripData.originGpsStartPoint,
          destinationGpsEndPoint: tripData.destinationGpsEndPoint,
          actualRouteRoadTaken: tripData.actualRouteRoadTaken || '',
          departureTimeGps: tripData.departureTimeGps || null,
          arrivalTimeGps: tripData.arrivalTimeGps || null,
          gpsDistanceKm: tripData.gpsDistanceKm,
          engineHours: tripData.engineHours,
          maxSpeedKph: tripData.maxSpeedKph,
          tripStatusGps: tripData.tripStatus,
          travelOrderId: matchedTOId,
          toStatusAuto: matchedTOStatus,
          anomalyFlag: tripData.maxSpeedKph > 120,
          notesRemarks: null, // editable via edit button
        });
        gpsLogsSaved += 1;
      } catch (logError) {
        console.error('Sync-history save error:', (logError as Error).message);
        gpsLogsFailed += 1;
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    res.json({
      success: true,
      synced: true,
      elapsed_seconds: parseFloat(elapsed),
      travel_order_id: lastMatchedTOId,
      travel_order_status: lastMatchedTOStatus,
      total_records_found: historyPoints.length,
      trips_found: trips.length,
      gps_logs_saved: gpsLogsSaved,
      gps_logs_failed: gpsLogsFailed,
      message: `Historical sync completed for vehicle on ${dateStr} with ${travelOrderCandidates.length} travel order(s).`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const message = error instanceof Error ? error.message : String(error);
    console.error('GPS logs sync-history error:', message);
    res.status(500).json({ success: false, error: message, elapsed_seconds: parseFloat(elapsed) });
  }
});

// PATCH /api/gps-logs/:id — Update allowed fields
router.patch('/:id', async (req: Request, res: Response) => {
  const allowedFields = [
    'anomaly_flag', 'notes_remarks', 'trip_status_gps', 'actual_route_road_taken',
    'arrival_time_gps', 'gps_distance_km', 'engine_hours', 'max_speed_kph',
    'to_status_auto', 'travel_order_id',
  ];

  const updates: string[] = [];
  const values: unknown[] = [];
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
    const result = await pool.query<GpsLogRow>(
      `UPDATE gps_trip_logs SET ${updates.join(', ')} WHERE id = $${idx}
       RETURNING *`,
      values,
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, data: null, error: 'GPS log not found' });
      return;
    }
    res.json({ success: true, data: mapRow(result.rows[0]), message: 'GPS log updated successfully' });
  } catch (error) {
    console.error('PATCH /api/gps-logs/:id error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// DELETE /api/gps-logs/:id — Delete a GPS log (superadmin only)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `DELETE FROM gps_trip_logs WHERE id = $1 RETURNING id`,
      [req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'GPS log not found' });
      return;
    }
    res.json({ success: true, message: 'GPS log deleted successfully' });
  } catch (error) {
    console.error('DELETE /api/gps-logs/:id error:', (error as Error).message);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

// GET /api/gps-logs/alerts — List GPS alerts
router.get('/alerts', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const vehicleId = req.query.vehicleId as string | undefined;
    const alertType = req.query.alertType as string | undefined;

    const result = await fetchGpsAlerts({ page, pageSize, vehicleId, alertType });

    // Enrich with plate numbers
    const enriched = await Promise.all(
      result.data.map(async (alert) => {
        const plate = await getVehiclePlate(alert.vehicle_id);
        return { ...alert, vehiclePlate: plate ?? 'Unknown' };
      }),
    );

    res.json({
      success: true,
      data: enriched,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      message: 'GPS alerts retrieved successfully',
    });
  } catch (error) {
    console.error('GET /api/gps-logs/alerts error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// GET /api/gps-logs/:id — Get single GPS log by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<GpsLogRow>(
      `SELECT
        g.*,
        v.plate_number,
        d.full_name AS driver_full_name,
        t_o.to_number AS travel_order_to_number
      FROM gps_trip_logs g
      LEFT JOIN vehicles      v   ON v.id = g.vehicle_id
      LEFT JOIN drivers       d   ON d.id = g.driver_id
      LEFT JOIN travel_orders t_o ON t_o.id = g.travel_order_id
      WHERE g.id = $1`,
      [req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, data: null, error: 'GPS log not found' });
      return;
    }
    res.json({ success: true, data: mapRow(result.rows[0]) });
  } catch (error) {
    console.error('GET /api/gps-logs/:id error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

function mapRow(row: GpsLogRow) {
  return {
    id: row.id,
    gpsRecordNo: row.gps_record_no,
    tripDate: row.trip_date,
    vehicleId: row.vehicle_id,
    driverId: row.driver_id,
    originGpsStartPoint: row.origin_gps_start_point,
    destinationGpsEndPoint: row.destination_gps_end_point,
    coordinatesOrigin: row.coordinates_origin,
    coordinatesDestination: row.coordinates_destination,
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
    destinationVerified: row.destination_verified,
    tripType: row.trip_type,
    parentTripId: row.parent_trip_id,
    locationName: row.location_name,
    vehiclePlateNo: row.plate_number ?? 'Unknown',
    driverName: row.driver_full_name ?? 'Unknown',
    toNumber: row.travel_order_to_number ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default router;

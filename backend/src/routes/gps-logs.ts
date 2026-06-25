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
  haversineDistance,
  type TravelOrderWithTimes,
} from '../services/gpsLogService.js';
import { fetchGpsAlerts, getVehiclePlate } from '../services/gpsAlertService.js';
import { fetchTelemetry } from '../services/gpsTelemetryService.js';
import {
  resolveCartrackUnitId,
  fetchCartrackVehicleHistory,
} from '../services/cartrackHistoryService.js';
import {
  syncSingleVehicleDate,
} from '../services/trackingHistorySyncService.js';

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
  coordinates_origin: string | null;
  coordinates_destination: string | null;
  // Joined columns
  plate_number?: string;
  driver_full_name?: string;
  travel_order_to_number?: string | null;
  to_origin?: string | null;
  to_destination?: string | null;
  // Calculated fields for moving hours and bound-to-bound distance
  moving_hours?: number | null;
  bound_to_bound_distance_km?: number | null;
  calculated_arrival_time?: string | null;
}

// GET /api/gps-logs — List telemetry data with LEFT JOINs for enrichment
router.get('/', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    // Build WHERE clause from optional filters
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (req.query.vehicleId) {
      conditions.push(`t.vehicle_id = $${params.length + 1}`);
      params.push(req.query.vehicleId);
    }
    if (req.query.tripDate) {
      conditions.push(`DATE(t.recorded_at) = $${params.length + 1}`);
      params.push(req.query.tripDate);
    }
    if (req.query.eventType) {
      conditions.push(`t.event_type = $${params.length + 1}`);
      params.push(req.query.eventType);
    }

    // Only show vehicles with active/approved travel orders
    conditions.push(`to_data.to_number IS NOT NULL`);

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Count total matching rows (must use same JOINs and deduplication as main query)
    const countResult = await pool.query<{ total: string }>(
      `WITH ranked_telemetry AS (
        SELECT
          t.id,
          t.event_type,
          t.speed_kmh,
          t.ignition,
          t.fuel_liters,
          t.location_name,
          LAG(t.event_type) OVER (PARTITION BY t.vehicle_id ORDER BY t.recorded_at) as prev_event_type,
          LAG(t.speed_kmh) OVER (PARTITION BY t.vehicle_id ORDER BY t.recorded_at) as prev_speed,
          LAG(t.ignition) OVER (PARTITION BY t.vehicle_id ORDER BY t.recorded_at) as prev_ignition,
          LAG(t.fuel_liters) OVER (PARTITION BY t.vehicle_id ORDER BY t.recorded_at) as prev_fuel,
          LAG(t.location_name) OVER (PARTITION BY t.vehicle_id ORDER BY t.recorded_at) as prev_location
        FROM gps_telemetry t
        LEFT JOIN LATERAL (
          SELECT to_number FROM travel_orders
          WHERE vehicle_id = t.vehicle_id
          AND status IN ('APPROVED', 'ACTIVE')
          AND DATE(scheduled_departure) = DATE(t.recorded_at)
          ORDER BY created_at DESC
          LIMIT 1
        ) to_data ON true
        ${whereClause}
      )
      SELECT COUNT(*) AS total FROM ranked_telemetry
      WHERE prev_event_type IS NULL
         OR prev_event_type != event_type
         OR prev_speed != speed_kmh
         OR prev_ignition != ignition
         OR (prev_fuel IS DISTINCT FROM fuel_liters)
         OR (prev_location IS DISTINCT FROM location_name)`,
      params,
    );
    const total = parseInt(countResult.rows[0]?.total || '0', 10);

    // Fetch paginated data with joins, filtering out consecutive duplicates
    // where vehicle state (event_type, speed, ignition, fuel, location) hasn't changed
    const dataParams = [...params, pageSize, offset];
    const dataResult = await pool.query(
      `WITH departure_times AS (
        SELECT
          t.vehicle_id,
          DATE(t.scheduled_departure) as travel_date,
          MIN(gt.recorded_at) as departure_time_gps
        FROM travel_orders t
        JOIN gps_telemetry gt
          ON gt.vehicle_id = t.vehicle_id
          AND DATE(gt.recorded_at) = DATE(t.scheduled_departure)
          AND t.lat_long_origin IS NOT NULL
          AND t.status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
          AND gt.speed_kmh > 0
        WHERE (
          SELECT haversine_distance(t.lat_long_origin, CONCAT(gt.latitude, ',', gt.longitude)) / 1000.0
        ) <= 2.0
        GROUP BY t.vehicle_id, DATE(t.scheduled_departure)
      ),
      ranked_telemetry AS (
        SELECT
          t.*,
          v.plate_number,
          to_data.to_number as active_to_number,
          to_data.status as active_to_status,
          to_data.lat_long_origin as to_lat_long_origin,
          to_data.lat_long_destination as to_lat_long_destination,
          d.full_name as active_driver_name,
          LAG(t.event_type) OVER (PARTITION BY t.vehicle_id ORDER BY t.recorded_at) as prev_event_type,
          LAG(t.speed_kmh) OVER (PARTITION BY t.vehicle_id ORDER BY t.recorded_at) as prev_speed,
          LAG(t.ignition) OVER (PARTITION BY t.vehicle_id ORDER BY t.recorded_at) as prev_ignition,
          LAG(t.fuel_liters) OVER (PARTITION BY t.vehicle_id ORDER BY t.recorded_at) as prev_fuel,
          LAG(t.location_name) OVER (PARTITION BY t.vehicle_id ORDER BY t.recorded_at) as prev_location,
          ROW_NUMBER() OVER (PARTITION BY t.vehicle_id ORDER BY t.recorded_at DESC) as rn
        FROM gps_telemetry t
        LEFT JOIN vehicles v ON v.id = t.vehicle_id
        LEFT JOIN LATERAL (
          SELECT to_number, status, driver_id, lat_long_origin, lat_long_destination
          FROM travel_orders
          WHERE vehicle_id = t.vehicle_id
          AND status IN ('APPROVED', 'ACTIVE')
          AND DATE(scheduled_departure) = DATE(t.recorded_at)
          ORDER BY created_at DESC
          LIMIT 1
        ) to_data ON true
        LEFT JOIN drivers d ON d.id = to_data.driver_id
        ${whereClause}
      ),
      trip_start_times AS (
        SELECT
          vehicle_id,
          DATE(recorded_at) as calc_date,
          MIN(recorded_at) as trip_start
        FROM gps_telemetry
        GROUP BY vehicle_id, DATE(recorded_at)
      ),
      cumulative_hours AS (
        SELECT
          t.vehicle_id,
          DATE(t.recorded_at) as calc_date,
          t.id,
          EXTRACT(EPOCH FROM (t.recorded_at - tst.trip_start)) / 3600.0 as engine_hours
        FROM gps_telemetry t
        JOIN trip_start_times tst
          ON t.vehicle_id = tst.vehicle_id
          AND DATE(t.recorded_at) = tst.calc_date
      ),
      time_diffs AS (
        SELECT
          t.id,
          t.vehicle_id,
          DATE(t.recorded_at) as calc_date,
          t.recorded_at,
          t.speed_kmh,
          EXTRACT(EPOCH FROM (
            t.recorded_at - LAG(t.recorded_at) OVER (
              PARTITION BY t.vehicle_id, DATE(t.recorded_at)
              ORDER BY t.recorded_at
            )
          )) as time_diff_seconds
        FROM gps_telemetry t
      ),
      cumulative_moving AS (
        SELECT
          td.vehicle_id,
          td.calc_date,
          td.recorded_at,
          td.id,
          SUM(
            CASE WHEN td.speed_kmh > 0 THEN td.time_diff_seconds ELSE 0 END
          ) OVER (
            PARTITION BY td.vehicle_id, td.calc_date
            ORDER BY td.recorded_at
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) / 3600.0 as moving_hours
        FROM time_diffs td
        WHERE td.time_diff_seconds IS NOT NULL
      )
      SELECT
        rt.*,
        dt.departure_time_gps,
        COALESCE(ch.engine_hours, 0) as engine_hours,
        COALESCE(cm.moving_hours, 0) as moving_hours
      FROM ranked_telemetry rt
      LEFT JOIN departure_times dt
        ON dt.vehicle_id = rt.vehicle_id
        AND dt.travel_date = DATE(rt.recorded_at)
      LEFT JOIN cumulative_hours ch
        ON rt.vehicle_id = ch.vehicle_id
        AND DATE(rt.recorded_at) = ch.calc_date
        AND rt.id = ch.id
      LEFT JOIN cumulative_moving cm
        ON rt.vehicle_id = cm.vehicle_id
        AND DATE(rt.recorded_at) = cm.calc_date
        AND rt.id = cm.id
      WHERE rn = 1
         OR prev_event_type IS NULL
         OR prev_event_type != event_type
         OR prev_speed != speed_kmh
         OR prev_ignition != ignition
         OR (prev_fuel IS DISTINCT FROM fuel_liters)
         OR (prev_location IS DISTINCT FROM location_name)
      ORDER BY recorded_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      dataParams,
    );

    const data = dataResult.rows.map((row: any) => {
      // Calculate distance from origin location to current telemetry location
      let distanceFromOrigin = 0;
      
      // Get origin coordinates from travel order (stored as "lat,long" text)
      const originCoord = row.to_lat_long_origin;
      
      // Get current telemetry location from separate latitude/longitude columns
      // gps_telemetry table has latitude and longitude as separate float8 columns
      if (originCoord && row.latitude != null && row.longitude != null) {
        const currentCoord = `${row.latitude},${row.longitude}`;
        const distMeters = haversineDistance(originCoord, currentCoord);
        distanceFromOrigin = distMeters / 1000; // Convert to km
      }

      return {
        id: row.id,
        gpsRecordNo: 'TEL-' + row.id.slice(0, 8),
        tripDate: new Date(row.recorded_at).toISOString().split('T')[0],
        vehicleId: row.vehicle_id,
        driverId: null,
        originGpsStartPoint: row.location_name || 'N/A',
        destinationGpsEndPoint: 'N/A',
        coordinatesOrigin: null,
        coordinatesDestination: null,
        actualRouteRoadTaken: null,
        departureTimeGps: row.departure_time_gps || row.recorded_at,
        arrivalTimeGps: null,
        gpsDistanceKm: distanceFromOrigin, // Distance from origin to current location
        engineHours: row.engine_hours ?? 0,
        maxSpeedKph: row.speed_kmh,
        tripStatusGps: row.ignition ? 'en-route' : 'arrived',
        travelOrderId: null,
        toStatusAuto: row.active_to_status || null,
        anomalyFlag: false,
        notesRemarks: row.event_type,
        destinationVerified: false,
        tripType: 'telemetry',
        parentTripId: null,
        locationName: row.location_name,
        vehiclePlateNo: row.plate_number || 'Unknown',
        driverName: row.active_driver_name || 'Unknown',
        toNumber: row.active_to_number || null,
        toOrigin: row.to_lat_long_origin || null,
        toDestination: row.to_lat_long_destination || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        movingHours: row.moving_hours ?? null,
      };
    });

    const response = {
      success: true,
      data,
      total,
      page,
      pageSize,
      message: 'GPS telemetry retrieved successfully',
    };
    res.json(response);
  } catch (error) {
    const err = error as Error;
    console.error('GET /api/gps-logs error:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({ success: false, data: null, error: err.message });
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

    // ── Step 4: Run the advanced sync (reconstructs trips from breadcrumbs
    //     using driving→idling→10min→arrival detection, return trip detection,
    //     coordinate-based destination verification, and smart TO matching). ──
    const syncResult = await syncSingleVehicleDate(vehicleId, plateNumber, dateStr);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    if (syncResult.tripsCreated === 0 && syncResult.tripsFailed === 0) {
      // No trips created — could be no GPS data or all duplicates
      res.json({
        success: true,
        synced: false,
        elapsed_seconds: parseFloat(elapsed),
        message: syncResult.debugLogs.length > 0
          ? syncResult.debugLogs[syncResult.debugLogs.length - 1]
          : 'No GPS data found for this vehicle on the specified date. Sync skipped.',
        debug_logs: syncResult.debugLogs,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.json({
      success: true,
      synced: true,
      elapsed_seconds: parseFloat(elapsed),
      travel_order_id: null, // matched internally by syncSingleVehicleDate
      travel_order_status: null,
      gps_logs_saved: syncResult.tripsCreated,
      gps_logs_failed: syncResult.tripsFailed,
      matched_to_number: syncResult.matchedToNumber,
      trips_created: syncResult.tripsCreated,
      trips_failed: syncResult.tripsFailed,
      debug_logs: syncResult.debugLogs,
      message: `Historical sync completed for vehicle ${plateNumber} on ${dateStr}: ${syncResult.tripsCreated} GPS trip(s) created, ${syncResult.tripsFailed} failed. Matched TO: ${syncResult.matchedToNumber ?? 'N/A'}.`,
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
    const alertDate = req.query.alertDate as string | undefined;

    const result = await fetchGpsAlerts({ page, pageSize, vehicleId, alertType, alertDate });

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

// GET /api/gps-logs/order-status — Travel orders with latest telemetry and arrival time
router.get('/order-status', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const offset = (page - 1) * pageSize;
    const vehicleId = req.query.vehicleId as string | undefined;
    const tripDate = req.query.tripDate as string | undefined;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (vehicleId) {
      conditions.push(`t.vehicle_id = $${params.length + 1}`);
      params.push(vehicleId);
    }
    if (tripDate) {
      conditions.push(`DATE(t.scheduled_departure) = $${params.length + 1}`);
      params.push(tripDate);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Count total
    const countResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM travel_orders t ${whereClause}`,
      params,
    );
    const total = parseInt(countResult.rows[0]?.total || '0', 10);

    // Fetch travel orders with latest telemetry and arrival time
    const dataParams = [...params, pageSize, offset];
    const dataResult = await pool.query(
      `WITH departure_times AS (
        SELECT
          t.vehicle_id,
          DATE(t.scheduled_departure) as travel_date,
          MIN(gt.recorded_at) as departure_time_gps
        FROM travel_orders t
        JOIN gps_telemetry gt
          ON gt.vehicle_id = t.vehicle_id
          AND DATE(gt.recorded_at) = DATE(t.scheduled_departure)
          AND t.lat_long_origin IS NOT NULL
          AND t.status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
        WHERE (
          SELECT haversine_distance(t.lat_long_origin, CONCAT(gt.latitude, ',', gt.longitude)) / 1000.0
        ) <= 2.0
        GROUP BY t.vehicle_id, DATE(t.scheduled_departure)
      ),
      arrival_times AS (
        SELECT
          t.vehicle_id,
          DATE(t.scheduled_departure) as travel_date,
          MIN(gt.recorded_at) as arrival_time_gps
        FROM travel_orders t
        JOIN gps_telemetry gt
          ON gt.vehicle_id = t.vehicle_id
          AND DATE(gt.recorded_at) = DATE(t.scheduled_departure)
          AND t.lat_long_destination IS NOT NULL
          AND t.status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
        WHERE (
          SELECT haversine_distance(t.lat_long_destination, CONCAT(gt.latitude, ',', gt.longitude)) / 1000.0
        ) <= 0.1
        GROUP BY t.vehicle_id, DATE(t.scheduled_departure)
      )
      SELECT
        t.id,
        t.to_number,
        DATE(t.scheduled_departure) as travel_date,
        t.origin_location as origin,
        t.destination_target as destination,
        t.status as to_status,
        t.vehicle_id,
        v.plate_number,
        d.full_name as driver_name,
        tel.id as telemetry_id,
        tel.event_type as telemetry_event,
        tel.latitude as telemetry_lat,
        tel.longitude as telemetry_lng,
        tel.speed_kmh as telemetry_speed,
        tel.fuel_liters as telemetry_fuel,
        tel.ignition as telemetry_ignition,
        tel.location_name as telemetry_location,
        tel.recorded_at as telemetry_time,
        dt.departure_time_gps,
        at.arrival_time_gps,
        (SELECT COALESCE(SUM(engine_hours), 0) FROM gps_trip_logs WHERE travel_order_id = t.id) as total_hours
      FROM travel_orders t
      LEFT JOIN vehicles v ON v.id = t.vehicle_id
      LEFT JOIN drivers d ON d.id = t.driver_id
      LEFT JOIN departure_times dt
        ON dt.vehicle_id = t.vehicle_id
        AND dt.travel_date = DATE(t.scheduled_departure)
      LEFT JOIN arrival_times at
        ON at.vehicle_id = t.vehicle_id
        AND at.travel_date = DATE(t.scheduled_departure)
      LEFT JOIN LATERAL (
        SELECT * FROM gps_telemetry 
        WHERE vehicle_id = t.vehicle_id 
        ORDER BY recorded_at DESC 
        LIMIT 1
      ) tel ON true
      ${whereClause}
      ORDER BY t.scheduled_departure DESC, t.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      dataParams,
    );

    const data = dataResult.rows.map((row: any) => ({
      id: row.id,
      toNumber: row.to_number || 'N/A',
      travelDate: row.travel_date,
      driverName: row.driver_name || 'Unassigned',
      vehiclePlate: row.plate_number || 'Unknown',
      vehicleId: row.vehicle_id,
      origin: row.origin || 'N/A',
      destination: row.destination || 'N/A',
      toStatus: row.to_status || 'N/A',
      // Latest telemetry
      lastLocation: row.telemetry_location || 'No location data',
      lastUpdate: row.telemetry_time ? new Date(row.telemetry_time).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }) : 'N/A',
      speed: row.telemetry_speed ?? 0,
      fuel: row.telemetry_fuel,
      ignition: row.telemetry_ignition ?? false,
      eventType: row.telemetry_event || 'N/A',
      totalHours: Number(row.total_hours) || 0,
      departureTime: row.departure_time_gps
        ? new Date(row.departure_time_gps).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })
        : null,
      arrivalTime: row.arrival_time_gps
        ? new Date(row.arrival_time_gps).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })
        : null,
    }));

    res.json({
      success: true,
      data,
      total,
      page,
      pageSize,
      message: 'Travel order status retrieved successfully',
    });
  } catch (error) {
    console.error('GET /api/gps-logs/order-status error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// GET /api/gps-logs/reports — Travel reports with TO, Driver, Vehicle, Travel Hours (Two-way trips)
router.get('/reports', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const offset = (page - 1) * pageSize;
    const vehicleId = req.query.vehicleId as string | undefined;
    const tripDate = req.query.tripDate as string | undefined;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (vehicleId) {
      conditions.push(`t.vehicle_id = $${params.length + 1}`);
      params.push(vehicleId);
    }
    if (tripDate) {
      conditions.push(`DATE(t.scheduled_departure) = $${params.length + 1}`);
      params.push(tripDate);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Count total (each TO can have 2 legs)
    const countResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*) * 2 AS total FROM travel_orders t ${whereClause}`,
      params,
    );
    const total = parseInt(countResult.rows[0]?.total || '0', 10);

    // Fetch reports with two-way trip calculations
    const dataParams = [...params, pageSize, offset];
    const dataResult = await pool.query(
      `WITH trip_legs AS (
        -- Trip 1: Outbound (Origin → Destination)
        SELECT
          t.id as to_id,
          t.to_number,
          t.origin_location as leg_start,
          t.destination_target as leg_end,
          t.lat_long_origin as start_coords,
          t.lat_long_destination as end_coords,
          t.vehicle_id,
          t.driver_id,
          t.scheduled_departure,
          v.plate_number,
          d.full_name as driver_name,
          1 as leg_number,
          'Outbound' as leg_description
        FROM travel_orders t
        LEFT JOIN vehicles v ON v.id = t.vehicle_id
        LEFT JOIN drivers d ON d.id = t.driver_id
        WHERE t.status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
          AND t.lat_long_origin IS NOT NULL
          AND t.lat_long_destination IS NOT NULL
        
        UNION ALL
        
        -- Trip 2: Return (Destination → Origin)
        SELECT
          t.id as to_id,
          t.to_number,
          t.destination_target as leg_start,
          t.origin_location as leg_end,
          t.lat_long_destination as start_coords,
          t.lat_long_origin as end_coords,
          t.vehicle_id,
          t.driver_id,
          t.scheduled_departure,
          v.plate_number,
          d.full_name as driver_name,
          2 as leg_number,
          'Return' as leg_description
        FROM travel_orders t
        LEFT JOIN vehicles v ON v.id = t.vehicle_id
        LEFT JOIN drivers d ON d.id = t.driver_id
        WHERE t.status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
          AND t.lat_long_origin IS NOT NULL
          AND t.lat_long_destination IS NOT NULL
      ),
      leg_telemetry AS (
        SELECT
          tl.to_id,
          tl.leg_number,
          tl.leg_start,
          tl.leg_end,
          tl.start_coords,
          tl.end_coords,
          tl.vehicle_id,
          tl.driver_id,
          tl.scheduled_departure,
          tl.plate_number,
          tl.driver_name,
          tl.to_number,
          tl.leg_description,
          -- Departure: first movement within 2km of start
          MIN(CASE 
            WHEN gt.speed_kmh > 0 
              AND (
                SELECT haversine_distance(tl.start_coords, CONCAT(gt.latitude, ',', gt.longitude)) / 1000.0
              ) <= 2.0
            THEN gt.recorded_at 
          END) as departure_time,
          -- Arrival: first point within 100m of end
          MIN(CASE 
            WHEN (
              SELECT haversine_distance(tl.end_coords, CONCAT(gt.latitude, ',', gt.longitude)) / 1000.0
            ) <= 0.1
            THEN gt.recorded_at 
          END) as arrival_time,
          -- Total time
          EXTRACT(EPOCH FROM (MAX(gt.recorded_at) - MIN(gt.recorded_at))) / 3600.0 as total_hours,
          -- Moving hours
          COALESCE(NULLIF(SUM(
            CASE WHEN gt.speed_kmh > 0 AND time_diff IS NOT NULL THEN time_diff ELSE 0 END
          ) / 3600.0, 'NaN'), 0) as moving_hours
        FROM trip_legs tl
        JOIN gps_telemetry gt
          ON gt.vehicle_id = tl.vehicle_id
          AND DATE(gt.recorded_at) = DATE(tl.scheduled_departure)
        LEFT JOIN (
          SELECT
            id,
            vehicle_id,
            DATE(recorded_at) as calc_date,
            EXTRACT(EPOCH FROM (
              recorded_at - LAG(recorded_at) OVER (
                PARTITION BY vehicle_id, DATE(recorded_at)
                ORDER BY recorded_at
              )
            )) as time_diff
          FROM gps_telemetry
        ) td ON td.id = gt.id
          AND td.vehicle_id = gt.vehicle_id
          AND td.calc_date = DATE(gt.recorded_at)
        GROUP BY tl.to_id, tl.leg_number, tl.leg_start, tl.leg_end, tl.start_coords, tl.end_coords,
                 tl.vehicle_id, tl.driver_id, tl.scheduled_departure, tl.plate_number, 
                 tl.driver_name, tl.to_number, tl.leg_description
      )
      SELECT
        lt.*,
        TO_CHAR(lt.scheduled_departure, 'YYYY-MM-DD') as travel_date
      FROM leg_telemetry lt
      ${whereClause.replace(/t\./g, 'lt.')}
      ORDER BY lt.scheduled_departure DESC, lt.to_id DESC, lt.leg_number ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      dataParams,
    );

    const data = dataResult.rows.map((row) => {
      const totalHours = isNaN(Number(row.total_hours)) ? 0 : Number(row.total_hours);
      const movingHours = isNaN(Number(row.moving_hours)) ? 0 : Number(row.moving_hours);
      const idlingHours = Math.max(0, totalHours - movingHours);
      
      return {
        id: `${row.to_id}-leg${row.leg_number}`,
        toNumber: row.to_number || 'N/A',
        driverName: row.driver_name || 'Unknown',
        vehiclePlate: row.plate_number || 'Unknown',
        legNumber: row.leg_number,
        legDescription: row.leg_description,
        from: row.leg_start || 'N/A',
        to: row.leg_end || 'N/A',
        tripDate: row.travel_date || new Date().toISOString().split('T')[0],
        departureTime: row.departure_time
          ? new Date(row.departure_time).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })
          : null,
        arrivalTime: row.arrival_time
          ? new Date(row.arrival_time).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })
          : null,
        movingHours: movingHours.toFixed(1),
        idlingHours: idlingHours.toFixed(1),
        totalHours: totalHours.toFixed(1),
      };
    });

    res.json({
      success: true,
      data,
      total,
      page,
      pageSize,
      message: 'Travel reports retrieved successfully',
    });
  } catch (error) {
    const err = error as Error;
    console.error('GET /api/gps-logs/reports error:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({ success: false, data: null, error: err.message });
  }
});

// GET /api/gps-logs/telemetry — List raw GPS telemetry data
router.get('/telemetry', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const vehicleId = req.query.vehicleId as string | undefined;
    const plateNumber = req.query.plateNumber as string | undefined;
    const eventType = req.query.eventType as string | undefined;
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;

    const result = await fetchTelemetry({ page, pageSize, vehicleId, plateNumber, eventType, dateFrom, dateTo });

    res.json({
      success: true,
      data: result.data,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      message: 'GPS telemetry retrieved successfully',
    });
  } catch (error) {
    console.error('GET /api/gps-logs/telemetry error:', (error as Error).message);
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
  // For GPS trip logs, calculate distance from origin to destination
  let distance = row.gps_distance_km;
  
  // If coordinates are available, calculate haversine distance
  if (row.coordinates_origin && row.coordinates_destination) {
    const distMeters = haversineDistance(row.coordinates_origin, row.coordinates_destination);
    distance = distMeters / 1000; // Convert to km
  }

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
    gpsDistanceKm: distance,
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
    vehiclePlateNo: row.plate_number ?? 'Unknown',
    driverName: row.driver_full_name ?? 'Unknown',
    toNumber: row.travel_order_to_number ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    movingHours: row.moving_hours ?? null,
  };
}

export default router;
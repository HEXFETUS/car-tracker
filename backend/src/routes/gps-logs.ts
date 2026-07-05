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
  syncGpsTripLogsFromTelemetry,
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

function parseCoordinates(value: string | null | undefined): [number, number] | null {
  if (!value) return null;
  const [lat, lng] = value.split(',').map((part) => Number(part.trim()));
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

function findDestinationTelemetryPoint(route: any[], destinationCoordinates: [number, number] | null) {
  if (!destinationCoordinates || route.length === 0) return null;

  const [destLat, destLng] = destinationCoordinates;
  for (const point of route) {
    const distanceKm = haversineDistance(`${destLat},${destLng}`, `${point.lat},${point.lng}`) / 1000;
    if (distanceKm <= 0.2) {
      return point;
    }
  }

  return null;
}

interface GpsLogRow {
  id: string;
  gps_record_no: string;
  trip_date: string;
  vehicle_id: string;
  driver_id: string | null;
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
  active_trip_id?: string | null;
  // Joined columns
  plate_number?: string;
  driver_full_name?: string;
  travel_order_to_number?: string | null;
  to_origin?: string | null;
  to_destination?: string | null;
  to_status?: string | null;
  to_lat_long_origin?: string | null;
  to_lat_long_destination?: string | null;
  // Calculated fields for moving hours and bound-to-bound distance
  moving_hours?: number | null;
  bound_to_bound_distance_km?: number | null;
  calculated_arrival_time?: string | null;
}

// ─────────────────────────────────────────────────────────────────
// GET /api/gps-logs — List GPS log records from gps_trip_logs
//
// Returns rows from gps_trip_logs, including those without a
// linked Travel Order (travel_order_id = null). Uses LEFT JOINs
// so unlinked trips still appear in the list.
// ─────────────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    // Build WHERE clause — base condition always includes rows from gps_trip_logs
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (req.query.vehicleId) {
      conditions.push(`COALESCE(t_order.vehicle_id, g.vehicle_id) = $${params.length + 1}`);
      params.push(req.query.vehicleId);
    }
    if (req.query.tripDate) {
      conditions.push(`g.trip_date = $${params.length + 1}::date`);
      params.push(req.query.tripDate);
    }
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const tripStatus = req.query.tripStatus as string | undefined;
    const tripStatusClause = tripStatus ? `AND g.trip_status_gps = $${params.length + 1}` : '';
    const dataParams = tripStatus ? [...params, tripStatus, pageSize, offset] : [...params, pageSize, offset];
    const limitParamIndex = params.length + (tripStatus ? 2 : 1);
    const offsetParamIndex = params.length + (tripStatus ? 3 : 2);

    // Count total (include rows without a travel order)
    const countResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*) AS total
       FROM gps_trip_logs g
       LEFT JOIN travel_orders t_order ON t_order.id = g.travel_order_id
       LEFT JOIN vehicles v ON v.id = COALESCE(t_order.vehicle_id, g.vehicle_id)
       LEFT JOIN drivers d ON d.id = COALESCE(t_order.driver_id, g.driver_id)
       ${whereClause}
       ${tripStatusClause}`,
      tripStatus ? [...params, tripStatus] : params,
    );
    const total = parseInt(countResult.rows[0]?.total || '0', 10);

    // Fetch paginated data: includes rows with or without a travel order
    const dataResult = await pool.query(
      `SELECT
        g.id AS gps_id,
        g.gps_record_no,
        COALESCE(g.trip_date::text, '') AS trip_date,
        COALESCE(t_order.scheduled_departure::date) AS scheduled_date,
        COALESCE(t_order.vehicle_id, g.vehicle_id) AS vehicle_id,
        COALESCE(t_order.driver_id, g.driver_id) AS driver_id,
        COALESCE(g.origin_gps_start_point, '') AS origin_gps_start_point,
        COALESCE(g.destination_gps_end_point, '') AS destination_gps_end_point,
        g.actual_route_road_taken,
        g.departure_time_gps,
        g.arrival_time_gps,
        g.gps_distance_km,
        g.engine_hours,
        g.max_speed_kph,
        g.trip_status_gps AS trip_status_gps,
        g.travel_order_id,
        COALESCE(g.to_status_auto, CASE WHEN g.travel_order_id IS NULL THEN 'NO TO' ELSE t_order.status END) AS to_status_auto,
        COALESCE(g.anomaly_flag, false) AS anomaly_flag,
        g.notes_remarks,
        g.created_at,
        NULL::timestamptz AS updated_at,
        g.destination_verified,
        COALESCE(g.trip_type, 'OUTBOUND') AS trip_type,
        g.parent_trip_id,
        parent_trip.gps_record_no AS parent_gps_record_no,
        paired_return.id AS paired_return_id,
        paired_return.gps_record_no AS paired_return_gps_record_no,
        g.coordinates_origin,
        g.coordinates_destination,
        NULL::numeric AS moving_hours,
        v.plate_number,
        d.full_name AS driver_full_name,
        t_order.to_number AS travel_order_to_number,
        t_order.origin_location AS to_origin,
        t_order.destination_target AS to_destination,
        t_order.status AS to_status,
        -- Telemetry summary for display (only when vehicle_id is known)
        tel.latest_location,
        tel.latest_speed,
        tel.telemetry_count,
        tel.first_recorded_at,
        tel.last_recorded_at
      FROM gps_trip_logs g
      LEFT JOIN gps_trip_logs parent_trip ON parent_trip.id = g.parent_trip_id
      LEFT JOIN LATERAL (
        SELECT id, gps_record_no
          FROM gps_trip_logs rt
         WHERE rt.parent_trip_id = g.id
         ORDER BY rt.departure_time_gps DESC NULLS LAST
         LIMIT 1
      ) paired_return ON true
      LEFT JOIN travel_orders t_order ON t_order.id = g.travel_order_id
      LEFT JOIN vehicles v ON v.id = COALESCE(t_order.vehicle_id, g.vehicle_id)
      LEFT JOIN drivers d ON d.id = COALESCE(t_order.driver_id, g.driver_id)
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS telemetry_count,
          MIN(recorded_at) AS first_recorded_at,
          MAX(recorded_at) AS last_recorded_at,
          MAX(speed_kmh) AS latest_speed,
          (SELECT location_name FROM gps_telemetry
           WHERE vehicle_id = COALESCE(t_order.vehicle_id, g.vehicle_id)
           ORDER BY recorded_at DESC LIMIT 1) AS latest_location
        FROM gps_telemetry
        WHERE vehicle_id = COALESCE(t_order.vehicle_id, g.vehicle_id)
      ) tel ON true
       ${whereClause}
       ${tripStatusClause}
       ORDER BY
         CASE WHEN g.gps_record_no IS NULL THEN 1 ELSE 0 END,
         CAST(SUBSTRING(g.gps_record_no FROM '[0-9]+$') AS INTEGER) DESC NULLS LAST,
         COALESCE(g.departure_time_gps, g.created_at, t_order.updated_at, t_order.created_at) DESC
       LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
      dataParams,
    );

    const data = dataResult.rows.map((row: any) => {
      const noTravelOrder = !row.travel_order_id;
      return {
        id: row.gps_id,
        gpsRecordNo: row.gps_record_no || `GPS-${row.travel_order_to_number || 'PENDING'}`,
        tripDate: row.trip_date || (row.first_recorded_at ? new Date(row.first_recorded_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]),
        toDate: row.scheduled_date || row.trip_date,
        vehicleId: row.vehicle_id,
        driverId: row.driver_id,
        originGpsStartPoint: row.origin_gps_start_point || '',
        destinationGpsEndPoint: row.destination_gps_end_point || '',
        coordinatesOrigin: row.coordinates_origin,
        coordinatesDestination: row.coordinates_destination,
        actualRouteRoadTaken: row.actual_route_road_taken || '',
        toOrigin: row.to_origin || null,
        toDestination: row.to_destination || null,
        departureTimeGps: row.departure_time_gps || row.first_recorded_at,
        arrivalTimeGps: row.arrival_time_gps || row.last_recorded_at,
        gpsDistanceKm: row.gps_distance_km,
        engineHours: row.engine_hours,
        maxSpeedKph: row.max_speed_kph || row.latest_speed,
        tripStatusGps: row.trip_status_gps,
        travelOrderId: row.travel_order_id || null,
        toStatusAuto: row.to_status_auto ?? (noTravelOrder ? 'NO TO' : row.to_status ?? null),
        anomalyFlag: row.anomaly_flag,
        notesRemarks: row.notes_remarks || null,
        destinationVerified: row.destination_verified,
        tripType: row.trip_type,
        parentTripId: row.parent_trip_id,
        parentGpsRecordNo: row.parent_gps_record_no || null,
        pairedReturnId: row.paired_return_id || null,
        pairedReturnGpsRecordNo: row.paired_return_gps_record_no || null,
        missionDisplay: row.parent_gps_record_no
          ? `${row.parent_gps_record_no} (Outbound)`
          : row.paired_return_gps_record_no
            ? `${row.paired_return_gps_record_no} (Return)`
            : 'Standalone',
        linkedOutboundTrip: row.parent_trip_id ? {
          id: row.parent_trip_id,
          gpsRecordNo: row.parent_gps_record_no || '',
        } : null,
        linkedReturnTrip: row.paired_return_id ? {
          id: row.paired_return_id,
          gpsRecordNo: row.paired_return_gps_record_no || '',
        } : null,
        locationName: row.latest_location || null,
        vehiclePlateNo: row.plate_number ?? 'Unknown',
        driverName: row.driver_full_name ?? 'Unknown',
        toNumber: row.travel_order_to_number ?? null,
        createdAt: row.created_at || new Date().toISOString(),
        updatedAt: row.updated_at || new Date().toISOString(),
        movingHours: row.moving_hours ?? null,
        telemetryCount: row.telemetry_count || 0,
        latestSpeed: row.latest_speed || null,
      };
    });

    const response = {
      success: true,
      data,
      total,
      page,
      pageSize,
      message: 'GPS logs retrieved successfully',
    };

    // Debug log for endpoint source
    console.log('[LogsPage Source]', {
      endpoint: 'GET /api/gps-logs',
      rowsCount: data.length,
      source: 'gps_trip_logs',
      firstRow: data.length > 0 ? { id: data[0].id, tripStatusGps: data[0].tripStatusGps, toNumber: data[0].toNumber, noTO: !data[0].travelOrderId } : null,
    });

    res.json(response);
  } catch (error) {
    const err = error as Error;
    console.error('GET /api/gps-logs error:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({ success: false, data: null, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/gps-logs/ensure-log — Link or update one GPS log per Travel Order
//
// Telemetry is the source of truth for creating GPS logs. This endpoint
// only links a Travel Order to an existing telemetry-created GPS log:
//   - If YES: updates trip_status and updated_at only
//   - If NO:  links the best existing unlinked GPS log for the same vehicle/date
//
// Body:
//   travel_order_id (required) - UUID of the travel order
//   vehicle_id (required)      - UUID of the vehicle
//   driver_id (optional)       - UUID of the driver
//   trip_status (optional)     - 'pending' | 'tracking_started' | 'ongoing' | 'arrived' | 'completed'
//   notes (optional)           - text notes
// ─────────────────────────────────────────────────────────────────
router.post('/ensure-log', async (req: Request, res: Response) => {
  const { travel_order_id, vehicle_id, driver_id, trip_status, notes } = req.body;

  if (!travel_order_id || !vehicle_id) {
    res.status(400).json({
      success: false,
      data: null,
      error: 'Missing required fields: travel_order_id, vehicle_id',
    });
    return;
  }

  const validStatuses = ['pending', 'tracking_started', 'ongoing', 'arrived', 'completed'];
  const status = trip_status && validStatuses.includes(trip_status) ? trip_status : 'ongoing';

  try {
    const pool = getPool();

    // Check if a GPS log already exists for this travel order
    const existing = await pool.query<GpsLogRow>(
      `SELECT * FROM gps_trip_logs WHERE travel_order_id = $1 LIMIT 1`,
      [travel_order_id],
    );

    if (existing.rows.length > 0) {
      // Update existing log - only trip_status, notes, and updated_at
      const updateFields: string[] = ['updated_at = NOW()'];
      const updateParams: unknown[] = [];
      let idx = 1;

      updateFields.push(`trip_status_gps = $${idx++}`);
      updateParams.push(status);

      if (notes !== undefined) {
        updateFields.push(`notes_remarks = $${idx++}`);
        updateParams.push(notes);
      }

      updateParams.push(travel_order_id);

      const result = await pool.query(
        `UPDATE gps_trip_logs SET ${updateFields.join(', ')} WHERE travel_order_id = $${idx} RETURNING *`,
        updateParams,
      );

      res.json({
        success: true,
        data: mapRow(result.rows[0]),
        message: 'GPS log updated successfully',
        created: false,
      });
    } else {
      const toResult = await pool.query(
        `SELECT id, to_number, status, scheduled_departure, scheduled_arrival
           FROM travel_orders
          WHERE id = $1
          LIMIT 1`,
        [travel_order_id],
      );
      const toData = toResult.rows[0];

      if (!toData) {
        res.status(404).json({ success: false, data: null, error: 'Travel order not found' });
        return;
      }

      const result = await pool.query<GpsLogRow>(
        `WITH candidate AS (
           SELECT id
             FROM gps_trip_logs
            WHERE vehicle_id = $1
              AND travel_order_id IS NULL
              AND trip_date = COALESCE($2::timestamptz::date, CURRENT_DATE)
            ORDER BY ABS(EXTRACT(EPOCH FROM (departure_time_gps - $2::timestamptz))) ASC NULLS LAST,
                     created_at DESC
            LIMIT 1
         )
         UPDATE gps_trip_logs g
            SET travel_order_id = $3,
                driver_id = COALESCE($4, g.driver_id),
                trip_status_gps = $5,
                to_status_auto = $6,
                anomaly_flag = FALSE,
                notes_remarks = COALESCE($7, g.notes_remarks),
                updated_at = NOW()
           FROM candidate
          WHERE g.id = candidate.id
          RETURNING g.*`,
        [
          vehicle_id,
          toData.scheduled_departure ?? null,
          travel_order_id,
          driver_id || null,
          status,
          toData.status || null,
          notes || null,
        ],
      );

      if (result.rows.length === 0) {
        res.status(404).json({
          success: false,
          data: null,
          error: 'No existing GPS trip log found to link. GPS logs are created from telemetry, not Travel Orders.',
        });
        return;
      }

      console.log('[gps-trip-log] linked to TO', { travelOrderId: travel_order_id, gpsLogId: result.rows[0].id });

      res.json({
        success: true,
        data: mapRow(result.rows[0]),
        message: 'GPS log linked to Travel Order successfully',
        created: false,
      });
    }
  } catch (error) {
    console.error('POST /api/gps-logs/ensure-log error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/gps-logs/by-travel-order/:travelOrderId
// Get the single GPS log for a given travel order
// ─────────────────────────────────────────────────────────────────
router.get('/by-travel-order/:travelOrderId', async (req: Request, res: Response) => {
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
      WHERE g.travel_order_id = $1
      LIMIT 1`,
      [req.params.travelOrderId],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, data: null, error: 'GPS log not found for this travel order' });
      return;
    }
    res.json({ success: true, data: mapRow(result.rows[0]) });
  } catch (error) {
    console.error('GET /api/gps-logs/by-travel-order error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// POST /api/gps-logs — Create a new GPS log (legacy, kept for backward compatibility)
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
    const pool = getPool();

    // Fetch TO destination coordinates for vehicles with active travel orders
    const toDestinations = new Map<string, string>();
    try {
      const toDestResult = await pool.query<{ vehicle_id: string; lat_long_destination: string | null }>(
        `SELECT DISTINCT ON (vehicle_id) vehicle_id, lat_long_destination
         FROM travel_orders
         WHERE status = 'APPROVED'
           AND vehicle_id IS NOT NULL
           AND DATE(scheduled_departure) = CURRENT_DATE
           AND lat_long_destination IS NOT NULL`,
      );
      for (const row of toDestResult.rows) {
        if (row.lat_long_destination) {
          toDestinations.set(row.vehicle_id, row.lat_long_destination);
        }
      }
    } catch (err) {
      console.error('Failed to fetch TO destinations for sync:', (err as Error).message);
    }

    // Use the backend's direct PostgreSQL pool for plate validation
    // instead of Supabase REST API (which may not be configured).
    const result = await syncFleetAndAlert({
      resolveVehicleId: (plateNumber: string) => findVehicleByPlate(plateNumber),
      toDestinationOverrides: Object.fromEntries(toDestinations),
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

// ─────────────────────────────────────────────────────────────────
// PATCH /api/gps-logs/:id/notes — Update only the notes field
//
// This is a dedicated endpoint for notes editing.
// Only the `notes` field can be updated via this endpoint.
// ─────────────────────────────────────────────────────────────────
router.patch('/:id/notes', async (req: Request, res: Response) => {
  const { notes } = req.body;

  if (notes === undefined) {
    res.status(400).json({
      success: false,
      data: null,
      error: 'Missing required field: notes',
    });
    return;
  }

  try {
    const pool = getPool();
    const result = await pool.query<GpsLogRow>(
      `UPDATE gps_trip_logs
       SET notes_remarks = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [notes, req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, data: null, error: 'GPS log not found' });
      return;
    }

    res.json({
      success: true,
      data: mapRow(result.rows[0]),
      message: 'Notes updated successfully',
    });
  } catch (error) {
    console.error('PATCH /api/gps-logs/:id/notes error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
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
          -- Departure: first movement within 100m of start
          MIN(CASE
            WHEN gt.speed_kmh > 0
              AND (
                SELECT haversine_distance(tl.start_coords, CONCAT(gt.latitude, ',', gt.longitude)) / 1000.0
              ) <= 0.1
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

    const data = dataResult.rows.map((row: any) => {
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

// ─────────────────────────────────────────────────────────────────
// GET /api/gps-logs/telemetry — List raw GPS telemetry data
// ─────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────
// GET /api/gps-logs/travel-order/:travelOrderId/details
// Details for rows without a gps_trip_logs record (fallback)
// ─────────────────────────────────────────────────────────────────
router.get('/travel-order/:travelOrderId/details', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const tripResult = await pool.query(
      `SELECT
        t_o.*,
        v.plate_number,
        d.full_name AS driver_full_name
      FROM travel_orders t_o
      LEFT JOIN vehicles v ON v.id = t_o.vehicle_id
      LEFT JOIN drivers d ON d.id = t_o.driver_id
      WHERE t_o.id = $1`,
      [req.params.travelOrderId],
    );

    if (tripResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Travel order not found' });
      return;
    }

    const trip = tripResult.rows[0];
    const routeResult = await pool.query(
      `SELECT latitude, longitude, recorded_at, speed_kmh, location_name, ignition, event_type
       FROM gps_telemetry
       WHERE vehicle_id = $1
         AND DATE(recorded_at) = DATE($2::timestamp)
         AND latitude IS NOT NULL
         AND longitude IS NOT NULL
       ORDER BY recorded_at ASC`,
      [trip.vehicle_id, trip.scheduled_departure],
    );

    const route = routeResult.rows.map((row: any) => ({
      lat: Number(row.latitude),
      lng: Number(row.longitude),
      timestamp: row.recorded_at,
      speed: Number(row.speed_kmh) || 0,
      locationName: row.location_name || null,
      ignition: row.ignition,
      eventType: row.event_type,
    }));

    let totalDistance = 0;
    let maxSpeed = 0;
    let totalEngineHours = 0;
    let movingHours = 0;
    let startTime: string | null = null;
    let arrivedTime: string | null = null;
    let endTime: string | null = null;
    let destinationMatch: any = null;

    if (route.length > 0) {
      startTime = null;
      endTime = route[route.length - 1].timestamp;
      const destCoords = parseCoordinates(trip.lat_long_destination);
      if (destCoords) {
        destinationMatch = findDestinationTelemetryPoint(route, destCoords);
        if (destinationMatch) {
          arrivedTime = destinationMatch.timestamp;
        }
      }
    }

    res.json({
      success: true,
      data: {
        trip: {
          date: trip.scheduled_departure ? new Date(trip.scheduled_departure).toISOString().split('T')[0] : '',
          vehicle: trip.plate_number || 'Unknown',
          driver: trip.driver_full_name || 'Unknown',
          linkedTO: trip.to_number || null,
          status: trip.status || 'N/A',
          distance: null,
          engineHours: null,
          movingHours: null,
          maxSpeed: null,
          notes: null,
          origin: trip.origin_location || '',
          destination: trip.destination_target || '',
          routeRoadTaken: '',
          toOrigin: trip.origin_location || null,
          toDestination: trip.destination_target || null,
          toStatus: trip.status || null,
          startTime,
          arrivedTime,
          endTime,
          arrivedCoordinates: destinationMatch ? `${destinationMatch.lat},${destinationMatch.lng}` : null,
          arrivedLocation: destinationMatch?.locationName || null,
          anomalyFlag: false,
          coordinatesOrigin: trip.lat_long_origin || null,
          coordinatesDestination: trip.lat_long_destination || null,
        },
        route,
        routeCount: route.length,
      },
    });
  } catch (error) {
    const err = error as Error;
    console.error('GET /api/gps-logs/travel-order/:travelOrderId/details error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/gps-logs/:id/details — Get trip details with GPS route history
// ─────────────────────────────────────────────────────────────────
router.get('/:id/details', async (req: Request, res: Response) => {
  try {
    const pool = getPool();

    // Fetch the GPS log with vehicle, driver, and travel order info
    const tripResult = await pool.query<GpsLogRow>(
      `SELECT
        g.*,
        parent_trip.gps_record_no AS parent_gps_record_no,
        paired_return.id AS paired_return_id,
        paired_return.gps_record_no AS paired_return_gps_record_no,
        v.plate_number,
        d.full_name AS driver_full_name,
        t_o.to_number AS travel_order_to_number,
        t_o.origin_location AS to_origin,
        t_o.destination_target AS to_destination,
        t_o.status AS to_status,
        t_o.lat_long_origin AS to_lat_long_origin,
        t_o.lat_long_destination AS to_lat_long_destination
      FROM gps_trip_logs g
      LEFT JOIN gps_trip_logs parent_trip ON parent_trip.id = g.parent_trip_id
      LEFT JOIN LATERAL (
        SELECT id, gps_record_no
          FROM gps_trip_logs rt
         WHERE rt.parent_trip_id = g.id
         ORDER BY rt.departure_time_gps DESC NULLS LAST
         LIMIT 1
      ) paired_return ON true
      LEFT JOIN vehicles      v   ON v.id = g.vehicle_id
      LEFT JOIN drivers       d   ON d.id = g.driver_id
      LEFT JOIN travel_orders t_o ON t_o.id = g.travel_order_id
      WHERE g.id = $1`,
      [req.params.id],
    );

    if (tripResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'GPS log not found' });
      return;
    }

    const trip = tripResult.rows[0];
    const tripData = mapRow(trip);
    const missionDisplay = tripData.parentGpsRecordNo
      ? `Mission ${tripData.parentGpsRecordNo}`
      : tripData.pairedReturnId
        ? `Mission ${tripData.gpsRecordNo}`
        : 'Standalone';
    const linkedOutboundTrip = String(tripData.tripType ?? '').toUpperCase() === 'RETURN' && tripData.parentTripId
      ? { id: tripData.parentTripId, gpsRecordNo: tripData.parentGpsRecordNo || '' }
      : null;
    const linkedReturnTrip = String(tripData.tripType ?? '').toUpperCase() !== 'RETURN' && tripData.pairedReturnId
      ? { id: tripData.pairedReturnId, gpsRecordNo: tripData.pairedReturnGpsRecordNo || '' }
      : null;

    const rawTelemetry = trip.active_trip_id
      ? await pool.query(
        `SELECT latitude, longitude, recorded_at, speed_kmh, location_name, ignition, event_type
         FROM gps_telemetry
         WHERE vehicle_id = $1
           AND active_trip_id = $2
           AND latitude IS NOT NULL
           AND longitude IS NOT NULL
         ORDER BY recorded_at ASC`,
        [trip.vehicle_id, trip.active_trip_id],
      )
      : await pool.query(
        `SELECT latitude, longitude, recorded_at, speed_kmh, location_name, ignition, event_type
         FROM gps_telemetry
         WHERE vehicle_id = $1
           AND recorded_at >= $2::timestamptz
           AND recorded_at <= COALESCE($3::timestamptz, NOW())
           AND latitude IS NOT NULL
           AND longitude IS NOT NULL
         ORDER BY recorded_at ASC`,
        [trip.vehicle_id, trip.departure_time_gps, trip.arrival_time_gps],
      );

    const rawRows = rawTelemetry.rows;

    const route = rawRows.map((row: any) => ({
      lat: Number(row.latitude),
      lng: Number(row.longitude),
      timestamp: row.recorded_at,
      speed: Number(row.speed_kmh) || 0,
      locationName: row.location_name || null,
      ignition: row.ignition,
      eventType: row.event_type,
    }));

    const stopsResult = await pool.query(
      `SELECT id, gps_trip_log_id, active_trip_id, vehicle_id, stop_order,
              stop_type, location_name, coordinates, latitude, longitude,
              arrived_at, idle_minutes, telemetry_id, created_at
         FROM gps_trip_log_stops
        WHERE gps_trip_log_id = $1
        ORDER BY stop_order ASC`,
      [trip.id],
    );

    const stops = stopsResult.rows.map((stop: any) => ({
      id: stop.id,
      gpsTripLogId: stop.gps_trip_log_id,
      activeTripId: stop.active_trip_id,
      vehicleId: stop.vehicle_id,
      stopOrder: Number(stop.stop_order),
      stopType: stop.stop_type,
      locationName: stop.location_name,
      coordinates: stop.coordinates,
      latitude: stop.latitude == null ? null : Number(stop.latitude),
      longitude: stop.longitude == null ? null : Number(stop.longitude),
      arrivedAt: stop.arrived_at,
      idleMinutes: stop.idle_minutes == null ? null : Number(stop.idle_minutes),
      telemetryId: stop.telemetry_id,
      createdAt: stop.created_at,
    }));

    // Engine Hours: IGNITION_ON → IGNITION_OFF
    let ignitionOnTime: string | null = null;
    let ignitionOffTime: string | null = null;

    const IGNORED_EVENT_TYPES = new Set([
      'IGNITION_ON',
      'IGNITION_OFF',
      'IDLING',
      'IDLING_TOO_LONG',
      'MOTION_STARTED',
    ]);

    interface MovingTelemetryRow {
      recorded_at: string;
      speed_kmh: number;
      latitude: number | null;
      longitude: number | null;
    }

    const movingTelemetry: MovingTelemetryRow[] = [];

    for (const row of rawRows) {
      const eventType = String(row.event_type ?? '').trim().toUpperCase().replace(/\s+ALERT$/, '').replace(/\s+/g, '_');
      if (eventType === 'IGNITION_ON') {
        ignitionOnTime = row.recorded_at;
        continue;
      }
      if (eventType === 'IGNITION_OFF') {
        ignitionOffTime = row.recorded_at;
        continue;
      }
      if (IGNORED_EVENT_TYPES.has(eventType)) {
        continue;
      }
      if (eventType === 'LOCATION_UPDATE' && row.recorded_at) {
        const speed = Number(row.speed_kmh) || 0;
        const lat = Number(row.latitude);
        const lng = Number(row.longitude);
        if (speed > 0 && Number.isFinite(lat) && Number.isFinite(lng)) {
          movingTelemetry.push({ recorded_at: row.recorded_at, speed_kmh: speed, latitude: lat, longitude: lng });
        }
      }
    }

    const engineHours = (() => {
      if (!ignitionOnTime || !ignitionOffTime) return tripData.engineHours ?? null;
      const on = new Date(ignitionOnTime).getTime();
      const off = new Date(ignitionOffTime).getTime();
      if (Number.isNaN(on) || Number.isNaN(off) || off <= on) return 0;
      return Number(((off - on) / 3600000).toFixed(2));
    })();

    const MAX_GAP_MS = 2 * 60 * 1000;
    const MIN_DISTANCE_M = 50;
    let movingMs = 0;
    let countedIntervals = 0;
    let ignoredIntervals = 0;
    let ignoredSameLocation = 0;
    let ignoredLongGap = 0;
    let ignoredZeroSpeed = 0;

    if (movingTelemetry.length >= 2) {
      for (let i = 1; i < movingTelemetry.length; i++) {
        const prev = movingTelemetry[i - 1];
        const curr = movingTelemetry[i];

        const prevTime = new Date(prev.recorded_at).getTime();
        const currTime = new Date(curr.recorded_at).getTime();
        if (Number.isNaN(prevTime) || Number.isNaN(currTime)) {
          ignoredIntervals += 1;
          continue;
        }

        const gap = currTime - prevTime;
        if (gap <= 0 || gap > MAX_GAP_MS) {
          ignoredLongGap += 1;
          ignoredIntervals += 1;
          continue;
        }

        if (prev.speed_kmh <= 0 || curr.speed_kmh <= 0) {
          ignoredZeroSpeed += 1;
          ignoredIntervals += 1;
          continue;
        }

        const distanceM = haversineDistance(`${prev.latitude},${prev.longitude}`, `${curr.latitude},${curr.longitude}`);
        if (Number.isNaN(distanceM) || distanceM <= MIN_DISTANCE_M) {
          ignoredSameLocation += 1;
          ignoredIntervals += 1;
          continue;
        }

        movingMs += gap;
        countedIntervals += 1;
      }
    }

    let movingHours = Number((movingMs / 3600000).toFixed(2));
    if (engineHours !== null && movingHours > engineHours) {
      console.log('[TRIP TIME WARNING] movingHours exceeded engineHours; capping as safety fallback');
      movingHours = engineHours;
    }

    console.log(
      '[TRIP TIME]\n\n' +
        'engineHours\n' + (engineHours ?? 0).toFixed(2) + ' hrs\n\n' +
        'movingHours\n' + movingHours.toFixed(2) + ' hrs\n\n' +
        'movingRowsCount\n' + movingTelemetry.length + '\n\n' +
        'countedIntervals\n' + countedIntervals + '\n\n' +
        'ignoredIntervals\n' + ignoredIntervals + '\n\n' +
        'ignoredSameLocation\n' + ignoredSameLocation + '\n\n' +
        'ignoredLongGap\n' + ignoredLongGap + '\n\n' +
        'ignoredZeroSpeed\n' + ignoredZeroSpeed
    );

    let startTime: string | null = null;
    let arrivedTime: string | null = null;
    let endTime: string | null = null;
    let destinationMatch: any = null;

    if (route.length > 0) {
      startTime = trip.departure_time_gps;
      endTime = route[route.length - 1].timestamp;
      const destCoords = parseCoordinates(trip.to_lat_long_destination || trip.coordinates_destination);
      if (destCoords) {
        destinationMatch = findDestinationTelemetryPoint(route, destCoords);
        if (destinationMatch) {
          arrivedTime = destinationMatch.timestamp;
        }
      }
    }

    res.json({
      success: true,
      data: {
        trip: {
          date: tripData.tripDate || '',
          vehicle: tripData.vehiclePlateNo || 'Unknown',
          driver: tripData.driverName || 'Unknown',
          linkedTO: tripData.toNumber || null,
          status: tripData.tripStatusGps || 'N/A',
          distance: tripData.gpsDistanceKm,
          engineHours: engineHours,
          movingHours: movingHours,
          maxSpeed: tripData.maxSpeedKph,
          notes: tripData.notesRemarks,
          origin: tripData.originGpsStartPoint || '',
          destination: tripData.destinationGpsEndPoint || '',
          routeRoadTaken: tripData.actualRouteRoadTaken || '',
          toOrigin: tripData.toOrigin || null,
          toDestination: tripData.toDestination || null,
          toStatus: tripData.toStatusAuto || null,
          startTime,
          arrivedTime,
          endTime,
          arrivedCoordinates: destinationMatch ? `${destinationMatch.lat},${destinationMatch.lng}` : null,
          arrivedLocation: destinationMatch?.locationName || null,
          anomalyFlag: tripData.anomalyFlag,
          parentTripId: tripData.parentTripId,
          parentGpsRecordNo: tripData.parentGpsRecordNo,
          pairedReturnId: tripData.pairedReturnId,
          pairedReturnGpsRecordNo: tripData.pairedReturnGpsRecordNo,
          missionDisplay,
          linkedOutboundTrip,
          linkedReturnTrip,
          coordinatesOrigin: tripData.coordinatesOrigin || null,
          coordinatesDestination: tripData.coordinatesDestination || null,
          tripType: tripData.tripType || 'OUTBOUND',
        },
        route,
        routeCount: route.length,
        stops,
        stopsCount: stops.length,
      },
    });
  } catch (error) {
    const err = error as Error;
    console.error('GET /api/gps-logs/:id/details error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/gps-logs/:id/stops — Stops timeline for a GPS trip log
// ─────────────────────────────────────────────────────────────────
router.get('/:id/stops', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, gps_trip_log_id, active_trip_id, vehicle_id, stop_order,
              stop_type, location_name, coordinates, latitude, longitude,
              arrived_at, idle_minutes, telemetry_id, created_at
         FROM gps_trip_log_stops
        WHERE gps_trip_log_id = $1
        ORDER BY stop_order ASC`,
      [req.params.id],
    );

    res.json({
      success: true,
      data: result.rows.map((stop: any) => ({
        id: stop.id,
        gpsTripLogId: stop.gps_trip_log_id,
        activeTripId: stop.active_trip_id,
        vehicleId: stop.vehicle_id,
        stopOrder: Number(stop.stop_order),
        stopType: stop.stop_type,
        locationName: stop.location_name,
        coordinates: stop.coordinates,
        latitude: stop.latitude == null ? null : Number(stop.latitude),
        longitude: stop.longitude == null ? null : Number(stop.longitude),
        arrivedAt: stop.arrived_at,
        idleMinutes: stop.idle_minutes == null ? null : Number(stop.idle_minutes),
        telemetryId: stop.telemetry_id,
        createdAt: stop.created_at,
      })),
    });
  } catch (error) {
    const err = error as Error;
    console.error('GET /api/gps-logs/:id/stops error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/gps-logs/sync-from-telemetry — Sync GPS trip logs from gps_telemetry
//
// Reads all telemetry records, groups them into trips by active_trip_id
// (or vehicle + date fallback), and creates/updates gps_trip_logs rows.
//
// This is the preferred sync method for LogsPage — reads from the
// telemetry table rather than scanning live fleet state.
// ─────────────────────────────────────────────────────────────────
router.post('/sync-from-telemetry', async (req: Request, res: Response) => {
  try {
    const result = await syncGpsTripLogsFromTelemetry();
    res.json({
      success: true,
      source: 'gps_telemetry',
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      failed: result.failed,
    });
  } catch (error) {
    const err = error as Error;
    console.error('POST /api/gps-logs/sync-from-telemetry error:', err.message);
    res.status(500).json({ success: false, source: 'gps_telemetry', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/gps-logs/:id — Get a single GPS log by ID
// IMPORTANT: Must be placed last AFTER all other GET /api/gps-logs/*
// routes to avoid Express matching /telemetry, /alerts, etc. with :id
// ─────────────────────────────────────────────────────────────────
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
      WHERE g.id = $1
      LIMIT 1`,
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

// ── Map helper ──────────────────────────────────────────────────

function mapRow(row: any) {
  return {
    id: row.id,
    gpsRecordNo: row.gps_record_no,
    tripDate: row.trip_date,
    toDate: row.trip_date,
    vehicleId: row.vehicle_id,
    driverId: row.driver_id,
    originGpsStartPoint: row.origin_gps_start_point,
    destinationGpsEndPoint: row.destination_gps_end_point,
    coordinatesOrigin: row.coordinates_origin,
    coordinatesDestination: row.coordinates_destination,
    actualRouteRoadTaken: row.actual_route_road_taken,
    toOrigin: row.to_origin,
    toDestination: row.to_destination,
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
    parentGpsRecordNo: row.parent_gps_record_no || null,
    pairedReturnId: row.paired_return_id || null,
    pairedReturnGpsRecordNo: row.paired_return_gps_record_no || null,
    locationName: row.location_name,
    vehiclePlateNo: row.plate_number ?? 'Unknown',
    driverName: row.driver_full_name ?? 'Unknown',
    toNumber: row.travel_order_to_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    movingHours: row.moving_hours,
    telemetryCount: row.telemetry_count || 0,
    latestSpeed: row.latest_speed || null,
  };
}

export default router;

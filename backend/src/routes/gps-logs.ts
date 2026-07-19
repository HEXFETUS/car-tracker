import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import type { ApiResponse } from '@car-tracker/shared';
import { getPool } from '../db/db.js';
import { validateUuidParam } from '../middleware/validate-uuid.js';
import { expensiveOperationRateLimit } from '../middleware/rate-limit.js';
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
import { fetchTelemetry } from '../services/gpsTelemetryService.js';
import {
  resolveCartrackUnitId,
  fetchCartrackVehicleHistory,
} from '../services/cartrackHistoryService.js';
import {
  syncSingleVehicleDate,
} from '../services/trackingHistorySyncService.js';
import { syncUnlinkedGpsTripLogsToTravelOrders } from '../services/travelOrderSyncService.js';
import { syncNoToLogsFromTelemetry } from '../services/noToLifecycleService.js';
import { mapGpsTripLogRow } from './gps-trip-log-serializer.js';
import { deriveActualTripEndpoints } from '../services/tripDetailsRouteService.js';
import { anchorNoToRouteAtOrigin, deriveNoToTripDetails } from '../services/noToTripDetailsService.js';

const router: ExpressRouter = express.Router();
router.param('id', validateUuidParam);
router.param('travelOrderId', validateUuidParam);

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
  business_trip_status?: string | null;
  destination_reached_at?: string | null;
  returned_to_base_at?: string | null;
  arrived_location_name?: string | null;
  arrived_coordinates?: string | null;
  matched_destination_distance_m?: number | null;
  matched_origin_distance_m?: number | null;
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
        to_char(g.departure_time_gps AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS departure_time_gps,
        to_char(g.arrival_time_gps AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS arrival_time_gps,
        g.gps_distance_km,
        g.engine_hours,
        g.max_speed_kph,
        g.trip_status_gps AS trip_status_gps,
        g.travel_order_id,
        g.to_status_auto,
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
      const gpsLog = mapGpsTripLogRow(row);
      return {
        ...gpsLog,
        gpsRecordNo: gpsLog.gpsRecordNo || `GPS-${row.travel_order_to_number || 'PENDING'}`,
        tripDate: gpsLog.tripDate || (row.first_recorded_at ? new Date(row.first_recorded_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]),
        departureTimeGps: gpsLog.departureTimeGps || row.first_recorded_at,
        arrivalTimeGps: gpsLog.arrivalTimeGps || row.last_recorded_at,
        maxSpeedKph: gpsLog.maxSpeedKph || row.latest_speed,
        toStatusAuto: row.to_status_auto ?? (noTravelOrder ? 'NO TO' : row.to_status ?? null),
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
        createdAt: row.created_at || new Date().toISOString(),
        updatedAt: row.updated_at || new Date().toISOString(),
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

router.get('/no-to', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
    const offset = (page - 1) * pageSize;
    const conditions: string[] = ['n.parent_trip_id IS NULL'];
    const params: unknown[] = [];

    if (req.query.vehicleId) {
      conditions.push(`n.vehicle_id = $${params.length + 1}`);
      params.push(req.query.vehicleId);
    }
    if (req.query.tripDate) {
      conditions.push(`n.trip_date = $${params.length + 1}::date`);
      params.push(req.query.tripDate);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const count = await pool.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM gps_no_to_logs n ${whereClause}`,
      params,
    );
    const rows = await pool.query(
      `SELECT n.*, v.plate_number, d.full_name AS driver_full_name,
              t.to_number AS linked_travel_order_no
         FROM gps_no_to_logs n
         LEFT JOIN vehicles v ON v.id = n.vehicle_id
         LEFT JOIN drivers d ON d.id = n.driver_id
         LEFT JOIN travel_orders t ON t.id = n.travel_order_id
        ${whereClause}
        ORDER BY n.trip_date DESC, split_part(n.no_to_record_no, '-', 4)::int DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );

    res.json({
      success: true,
      data: rows.rows.map((row: any) => ({
        id: row.id,
        noToRecordNo: row.no_to_record_no,
        tripDate: row.trip_date,
        vehicleId: row.vehicle_id,
        driverId: row.driver_id,
        travelOrderId: row.travel_order_id,
        linkedToNumber: row.linked_to_number ?? null,
        vehiclePlateNo: row.plate_number ?? 'Unknown',
        driverName: row.driver_full_name ?? 'Unknown',
        originAddress: row.origin_address,
        originCoordinates: row.origin_coordinates,
        destinationAddress: row.destination_address,
        destinationCoordinates: row.destination_coordinates,
        departureTime: row.departure_time,
        arrivalTime: row.arrival_time,
        distanceKm: row.distance_km == null ? null : Number(row.distance_km),
        engineHours: row.engine_hours == null ? null : Number(row.engine_hours),
        movingHours: row.moving_hours == null ? null : Number(row.moving_hours),
        maxSpeedKph: row.max_speed_kph == null ? null : Number(row.max_speed_kph),
        status: row.status,
        statusDisplay: row.end_time != null || row.business_trip_status === 'COMPLETED' ? 'Completed' : 'En Route',
        anomalyFlag: row.anomaly_flag,
        anomalyReason: row.anomaly_reason,
        notes: row.notes,
        linkedAt: row.linked_at,
        convertedGpsTripLogId: row.converted_gps_trip_log_id,
        createdAt: row.created_at,
      })),
      total: Number(count.rows[0]?.total ?? 0),
      page,
      pageSize,
    });
  } catch (error) {
    console.error('GET /api/gps-logs/no-to error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// POST /api/gps-logs/no-to/sync — Manually trigger No TO Logs sync
router.post('/no-to/sync', expensiveOperationRateLimit, async (_req: Request, res: Response) => {
  try {
    const result = await syncNoToLogsFromTelemetry();
    res.json({
      success: true,
      data: result,
      message: 'No TO Logs sync completed',
    });
  } catch (error) {
    const err = error as Error;
    console.error('POST /api/gps-logs/no-to/sync error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/no-to/link-options', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const vehicleId = req.query.vehicleId || null;
    const result = await pool.query(
      `SELECT t.id, t.to_number, t.scheduled_departure, t.scheduled_arrival,
              t.origin_location, t.destination_target, v.plate_number, d.full_name AS driver_name
         FROM travel_orders t
         LEFT JOIN vehicles v ON v.id = t.vehicle_id
         LEFT JOIN drivers d ON d.id = t.driver_id
        WHERE t.status IN ('APPROVED', 'ACTIVE')
          AND ($1::uuid IS NULL OR t.vehicle_id = $1::uuid)
          AND NOT EXISTS (
            SELECT 1 FROM gps_trip_logs g WHERE g.travel_order_id = t.id
          )
        ORDER BY t.scheduled_departure DESC NULLS LAST
        LIMIT 100`,
      [vehicleId],
    );
    res.json({ success: true, data: result.rows.map((row: any) => ({
      id: row.id,
      toNumber: row.to_number,
      scheduledDeparture: row.scheduled_departure,
      scheduledArrival: row.scheduled_arrival,
      origin: row.origin_location,
      destination: row.destination_target,
      vehiclePlateNo: row.plate_number,
      driverName: row.driver_name,
    })) });
  } catch (error) {
    console.error('GET /api/gps-logs/no-to/link-options error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

router.get('/no-to/:id/details', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const logResult = await pool.query(
      `SELECT
        n.id, n.no_to_record_no, n.trip_date, n.vehicle_id, n.driver_id,
        n.travel_order_id, n.linked_to_number,
        n.origin_address, n.origin_coordinates,
        n.destination_address, n.destination_coordinates,
        to_char(n.departure_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS departure_time,
        to_char(n.arrival_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS arrival_time,
        n.distance_km, n.engine_hours, n.moving_hours, n.max_speed_kph,
        n.status, n.anomaly_flag, n.anomaly_reason, n.notes,
        n.linked_at, n.converted_gps_trip_log_id,
        to_char(n.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
        n.arrived_location_name, n.arrived_coordinates,
        to_char(n.destination_reached_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS destination_reached_at,
        to_char(n.paused_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paused_at,
        n.end_address, n.end_coordinates,
        to_char(n.end_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS end_time,
        to_char(n.returned_to_base_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS returned_to_base_at,
        n.business_trip_status,
        v.plate_number, d.full_name AS driver_full_name,
        t.to_number AS linked_travel_order_no
         FROM gps_no_to_logs n
         LEFT JOIN vehicles v ON v.id = n.vehicle_id
         LEFT JOIN drivers d ON d.id = n.driver_id
         LEFT JOIN travel_orders t ON t.id = n.travel_order_id
        WHERE n.id = $1`,
      [req.params.id],
    );
    const log = logResult.rows[0];
    if (!log) {
      res.status(404).json({ success: false, error: 'No TO GPS log not found' });
      return;
    }

    const sessions = await pool.query(
      `SELECT active_trip_id, start_time, end_time
         FROM gps_no_to_log_active_trips
        WHERE gps_no_to_log_id = $1
        ORDER BY start_time ASC NULLS LAST`,
      [log.id],
    );
    const routeResult = await pool.query(
      `SELECT gt.latitude, gt.longitude, gt.recorded_at, gt.speed_kmh,
              gt.location_name, gt.ignition, gt.event_type, gt.active_trip_id
         FROM gps_telemetry gt
         JOIN gps_no_to_log_active_trips nat
           ON nat.gps_no_to_log_id = $2
          AND nat.active_trip_id = gt.active_trip_id
        WHERE gt.vehicle_id = $1
          AND (nat.start_time IS NULL OR gt.recorded_at >= nat.start_time)
          AND (nat.end_time IS NULL OR gt.recorded_at <= nat.end_time)
          AND ($3::timestamptz IS NULL OR gt.recorded_at >= $3::timestamptz)
          AND ($4::timestamptz IS NULL OR gt.recorded_at <= $4::timestamptz)
          AND gt.latitude IS NOT NULL
          AND gt.longitude IS NOT NULL
        ORDER BY gt.recorded_at ASC`,
      [log.vehicle_id, log.id, log.departure_time, log.end_time],
    );

    const telemetryRoute = routeResult.rows.map((row: any) => ({
      lat: Number(row.latitude),
      lng: Number(row.longitude),
      timestamp: row.recorded_at,
      speed: Number(row.speed_kmh) || 0,
      locationName: row.location_name || null,
      ignition: row.ignition,
      eventType: row.event_type,
      activeTripId: row.active_trip_id,
    }));
    const route = anchorNoToRouteAtOrigin(
      telemetryRoute,
      log.origin_coordinates,
      log.origin_address,
      log.departure_time,
    );
    const activeTripSessions = sessions.rows.map((row: any) => ({
      activeTripId: row.active_trip_id,
      startTime: row.start_time,
      endTime: row.end_time,
    }));
    const derived = deriveNoToTripDetails(route, activeTripSessions, log.business_trip_status);
    const hasRoute = route.length > 0;
    const destinationAddress = derived.arrivalAddress ?? log.destination_address ?? '';
    const destinationCoordinates = derived.arrivalCoordinates ?? log.destination_coordinates ?? null;
    const originAddress = log.origin_address ?? derived.originAddress ?? '';
    const originCoordinates = log.origin_coordinates ?? derived.originCoordinates ?? null;
    const startTime = log.departure_time ?? derived.startTime ?? null;
    const arrivalTime = derived.arrivalTime;
    const endAddress = derived.completed
      ? (derived.endAddress ?? log.end_address ?? null)
      : null;
    const endCoordinates = derived.completed
      ? (derived.endCoordinates ?? log.end_coordinates ?? null)
      : null;
    const endTime = derived.completed
      ? (derived.endTime ?? log.end_time ?? log.returned_to_base_at ?? null)
      : null;

    res.json({
      success: true,
      data: {
        trip: {
          date: log.trip_date,
          vehicle: log.plate_number ?? 'Unknown',
          driver: log.driver_full_name ?? 'Unknown',
          linkedTO: log.linked_to_number ?? null,
          status: derived.status,
          distance: hasRoute ? derived.distanceKm : (log.distance_km == null ? null : Number(log.distance_km)),
          engineHours: hasRoute ? derived.engineHours : (log.engine_hours == null ? null : Number(log.engine_hours)),
          movingHours: hasRoute ? derived.movingHours : (log.moving_hours == null ? null : Number(log.moving_hours)),
          maxSpeed: hasRoute ? derived.maxSpeed : (log.max_speed_kph == null ? null : Number(log.max_speed_kph)),
          notes: log.notes,
          // Origin
          origin: originAddress,
          startTime,
          coordinatesOrigin: originCoordinates,
          // Arrival (farthest telemetry point from this journey's origin)
          destination: destinationAddress,
          plannedDestinationAddress: destinationAddress,
          plannedDestinationCoordinates: destinationCoordinates,
          arrivedLocation: destinationAddress || null,
          arrivedCoordinates: destinationCoordinates,
          arrivedTime: arrivalTime,
          // Explicit fields for the frontend Arrival/End mapping
          arrivalDisplayTime: arrivalTime,
          departureTime: startTime,
          destinationReachedAt: log.destination_reached_at ?? null,
          arrivalTime: arrivalTime,
          pausedAt: log.paused_at ?? null,
          // End (return to base)
          endAddress: endAddress,
          endCoordinates: endCoordinates,
          endTime: endTime,
          returnedToBaseAt: derived.completed ? endTime : null,
          // No-TO specific
          routeRoadTaken: '',
          toOrigin: null,
          toDestination: null,
          toStatus: log.status,
          anomalyFlag: log.anomaly_flag,
          anomalyReason: log.anomaly_reason,
          coordinatesDestination: destinationCoordinates,
          tripType: 'NO_TO',
          missionDisplay: log.no_to_record_no,
          // Lifecycle status
          businessTripStatus: log.business_trip_status ?? null,
        },
        route,
        routeCount: route.length,
        activeTripSessions,
      },
    });
  } catch (error) {
    console.error('GET /api/gps-logs/no-to/:id/details error:', (error as Error).message);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.post('/no-to/:id/link', async (req: Request, res: Response) => {
  const { travel_order_id } = req.body ?? {};
  if (!travel_order_id) {
    res.status(400).json({ success: false, error: 'Missing required field: travel_order_id' });
    return;
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const toResult = await client.query(
      `SELECT id, to_number, driver_id FROM travel_orders WHERE id = $1 LIMIT 1`,
      [travel_order_id],
    );
    const travelOrder = toResult.rows[0];
    if (!travelOrder) {
      await client.query('ROLLBACK');
      res.status(404).json({ success: false, error: 'Travel Order not found' });
      return;
    }

    const updated = await client.query(
      `UPDATE gps_no_to_logs
          SET travel_order_id = $2,
              linked_to_number = $3,
              driver_id = COALESCE(driver_id, $4),
              status = 'linked',
              linked_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [req.params.id, travel_order_id, travelOrder.to_number, travelOrder.driver_id],
    );
    const noToLog = updated.rows[0];
    if (!noToLog) {
      await client.query('ROLLBACK');
      res.status(404).json({ success: false, error: 'No TO GPS log not found' });
      return;
    }

    const telemetryUpdate = await client.query(
      `UPDATE gps_telemetry gt
          SET travel_order_id = $2,
              driver_id = COALESCE(gt.driver_id, $3)
         FROM gps_no_to_log_active_trips nat
        WHERE nat.gps_no_to_log_id = $1
          AND gt.vehicle_id = $4
          AND gt.active_trip_id = nat.active_trip_id
          AND (nat.start_time IS NULL OR gt.recorded_at >= nat.start_time)
          AND (nat.end_time IS NULL OR gt.recorded_at <= nat.end_time)`,
      [req.params.id, travel_order_id, travelOrder.driver_id, noToLog.vehicle_id],
    );

    await client.query('COMMIT');
    res.json({
      success: true,
      data: {
        id: noToLog.id,
        travelOrderId: travel_order_id,
        linkedToNumber: travelOrder.to_number,
        telemetryBackfilled: telemetryUpdate.rowCount ?? 0,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('POST /api/gps-logs/no-to/:id/link error:', (error as Error).message);
    res.status(500).json({ success: false, error: 'Database error' });
  } finally {
    client.release();
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
router.post('/sync', expensiveOperationRateLimit, async (req: Request, res: Response) => {
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
    const travelOrderSync = await syncUnlinkedGpsTripLogsToTravelOrders();

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
        travel_order_sync_checked: travelOrderSync.checked,
        travel_order_sync_linked: travelOrderSync.linked,
        travel_order_sync_results: travelOrderSync.results,
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
      travel_order_sync_checked: travelOrderSync.checked,
      travel_order_sync_linked: travelOrderSync.linked,
      travel_order_sync_results: travelOrderSync.results,
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
       FROM gps_telemetry gt
       JOIN gps_trip_logs g ON g.id = gt.gps_trip_log_id
       WHERE g.travel_order_id = $1
         AND gt.latitude IS NOT NULL
         AND gt.longitude IS NOT NULL
       ORDER BY gt.recorded_at ASC`,
      [req.params.travelOrderId],
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
          plannedDestinationAddress: trip.destination_target || null,
          plannedDestinationCoordinates: trip.lat_long_destination || null,
          arrivedCoordinates: destinationMatch ? `${destinationMatch.lat},${destinationMatch.lng}` : null,
          arrivedLocation: destinationMatch?.locationName || null,
          matchedDestinationDistanceM: destinationMatch && trip.lat_long_destination
            ? haversineDistance(trip.lat_long_destination, `${destinationMatch.lat},${destinationMatch.lng}`)
            : null,
          endAddress: route[route.length - 1]?.locationName || null,
          endCoordinates: route.length > 0 ? `${route[route.length - 1].lat},${route[route.length - 1].lng}` : null,
          returnedToBaseAt: endTime,
          matchedOriginDistanceM: null,
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
        g.id,
        g.gps_record_no,
        g.trip_date,
        g.vehicle_id,
        g.driver_id,
        g.origin_gps_start_point,
        g.destination_gps_end_point,
        g.actual_route_road_taken,
        to_char(g.departure_time_gps AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS departure_time_gps,
        to_char(g.arrival_time_gps AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS arrival_time_gps,
        g.gps_distance_km,
        g.engine_hours,
        g.max_speed_kph,
        g.trip_status_gps,
        g.travel_order_id,
        g.to_status_auto,
        g.anomaly_flag,
        g.notes_remarks,
        to_char(g.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
        g.destination_verified,
        g.trip_type,
        g.parent_trip_id,
        g.coordinates_origin,
        g.coordinates_destination,
        g.active_trip_id,
        g.business_trip_status,
        to_char(g.destination_reached_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS destination_reached_at,
        to_char(g.returned_to_base_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS returned_to_base_at,
        g.arrived_location_name,
        g.arrived_coordinates,
        g.matched_destination_distance_m,
        g.matched_origin_distance_m,
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

    const activeSessionsResult = await pool.query(
      `SELECT active_trip_id, start_time, end_time
         FROM gps_trip_log_active_trips
        WHERE gps_trip_log_id = $1
        ORDER BY start_time ASC NULLS LAST`,
      [trip.id],
    );

    const rawTelemetry = activeSessionsResult.rows.length > 0
      ? await pool.query(
        `SELECT gt.latitude, gt.longitude, gt.recorded_at, gt.speed_kmh,
                gt.location_name, gt.ignition, gt.event_type, gt.active_trip_id
           FROM gps_telemetry gt
           JOIN gps_trip_log_active_trips gla
             ON gla.gps_trip_log_id = $2
            AND gla.active_trip_id = gt.active_trip_id
          WHERE gt.vehicle_id = $1
            AND (gla.start_time IS NULL OR gt.recorded_at >= gla.start_time)
            AND (gla.end_time IS NULL OR gt.recorded_at <= gla.end_time)
            AND gt.latitude IS NOT NULL
            AND gt.longitude IS NOT NULL
          ORDER BY gt.recorded_at ASC`,
        [trip.vehicle_id, trip.id],
      )
      : await pool.query(
        `SELECT latitude, longitude, recorded_at, speed_kmh, location_name, ignition, event_type, active_trip_id
         FROM gps_telemetry
         WHERE vehicle_id = $1
           AND (
             ($2::uuid IS NOT NULL AND active_trip_id = $2::uuid)
             OR (
               recorded_at >= $3::timestamptz
               AND recorded_at <= COALESCE($4::timestamptz, NOW())
             )
           )
           AND latitude IS NOT NULL
           AND longitude IS NOT NULL
         ORDER BY recorded_at ASC`,
        [trip.vehicle_id, trip.active_trip_id, trip.departure_time_gps, trip.arrival_time_gps],
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
      activeTripId: row.active_trip_id ?? null,
    }));
    const actualEndpoints = deriveActualTripEndpoints(
      route,
      trip.to_lat_long_origin || trip.coordinates_origin,
      trip.trip_status_gps,
    );

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

    // ── Compute engine hours, moving hours, max speed, and distance from telemetry ──
    // Use active session time ranges to bound calculations.
    // For each active session, sum session duration for engine hours,
    // and sum moving intervals (speed > 0) within the session for moving hours.
    let computedEngineHours: number | null = null;
    let computedMovingHours: number | null = null;
    let computedMaxSpeed: number | null = null;
    let computedDistanceKm: number | null = null;

    const activeSessions = activeSessionsResult.rows;

    if (rawRows.length > 0) {
      // Compute max speed from all telemetry points
      computedMaxSpeed = rawRows.reduce((max: number, row: any) => {
        const speed = Number(row.speed_kmh) || 0;
        return speed > max ? speed : max;
      }, 0);

      // Compute distance from consecutive route points
      let totalDistanceM = 0;
      for (let i = 1; i < route.length; i++) {
        const prev = route[i - 1];
        const curr = route[i];
        const dist = haversineDistance(`${prev.lat},${prev.lng}`, `${curr.lat},${curr.lng}`);
        if (Number.isFinite(dist) && dist > 0) {
          totalDistanceM += dist;
        }
      }
      computedDistanceKm = totalDistanceM > 0 ? Number((totalDistanceM / 1000).toFixed(2)) : null;

      if (activeSessions.length > 0) {
        // Per-session calculation
        let totalEngineMs = 0;
        let totalMovingMs = 0;

        for (const session of activeSessions) {
          const sessionStart = session.start_time ? new Date(session.start_time).getTime() : null;
          const sessionEnd = session.end_time ? new Date(session.end_time).getTime() : null;

          // Engine hours: session duration
          if (sessionStart && sessionEnd && sessionEnd > sessionStart) {
            totalEngineMs += (sessionEnd - sessionStart);
          }

          // Moving hours: consecutive telemetry points within this session with speed > 0
          const sessionPoints = rawRows.filter((row: any) => {
            const t = new Date(row.recorded_at).getTime();
            if (sessionStart && t < sessionStart) return false;
            if (sessionEnd && t > sessionEnd) return false;
            return true;
          });

          if (sessionPoints.length >= 2) {
            for (let i = 1; i < sessionPoints.length; i++) {
              const prev = sessionPoints[i - 1];
              const curr = sessionPoints[i];
              const prevSpeed = Number(prev.speed_kmh) || 0;
              const currSpeed = Number(curr.speed_kmh) || 0;
          const wasMoving = Number(prev.speed_kmh ?? 0) > 0 || Number(curr.speed_kmh ?? 0) > 0;
          if (!wasMoving) continue;

              const prevTime = new Date(prev.recorded_at).getTime();
              const currTime = new Date(curr.recorded_at).getTime();
              if (Number.isNaN(prevTime) || Number.isNaN(currTime)) continue;

              const gap = currTime - prevTime;
              // Skip gaps > 10 minutes (between sessions)
              if (gap <= 0 || gap > 10 * 60 * 1000) continue;

              totalMovingMs += gap;
            }
          }
        }

        computedEngineHours = totalEngineMs > 0 ? Number((totalEngineMs / 3600000).toFixed(2)) : null;
        computedMovingHours = totalMovingMs > 0 ? Number((totalMovingMs / 3600000).toFixed(2)) : null;
      } else {
        // No active sessions — use first/last telemetry timestamp for engine hours
        const firstTime = new Date(rawRows[0].recorded_at).getTime();
        const lastTime = new Date(rawRows[rawRows.length - 1].recorded_at).getTime();
        if (Number.isFinite(firstTime) && Number.isFinite(lastTime) && lastTime > firstTime) {
          computedEngineHours = Number(((lastTime - firstTime) / 3600000).toFixed(2));
        }

        // Moving hours: consecutive points with speed > 0
        let movingMs = 0;
        if (rawRows.length >= 2) {
          for (let i = 1; i < rawRows.length; i++) {
            const prev = rawRows[i - 1];
            const curr = rawRows[i];
            const wasMoving = Number(prev.speed_kmh ?? 0) > 0 || Number(curr.speed_kmh ?? 0) > 0;
            if (!wasMoving) continue;

            const prevTime = new Date(prev.recorded_at).getTime();
            const currTime = new Date(curr.recorded_at).getTime();
            if (Number.isNaN(prevTime) || Number.isNaN(currTime)) continue;

            const gap = currTime - prevTime;
            if (gap <= 0 || gap > 10 * 60 * 1000) continue;

            movingMs += gap;
          }
        }
        computedMovingHours = movingMs > 0 ? Number((movingMs / 3600000).toFixed(2)) : null;
      }
    }

    // Fallback to stored values if computed values are null
    const engineHours = computedEngineHours ?? tripData.engineHours ?? null;
    const movingHours = computedMovingHours ?? tripData.movingHours ?? null;
    const maxSpeed = computedMaxSpeed ?? tripData.maxSpeedKph ?? null;
    const distanceKm = computedDistanceKm ?? tripData.gpsDistanceKm ?? null;

    console.log(
      '[TRIP TIME] computed engineHours=' + (computedEngineHours ?? 'null') +
      ' movingHours=' + (computedMovingHours ?? 'null') +
      ' maxSpeed=' + (computedMaxSpeed ?? 'null') +
      ' distanceKm=' + (computedDistanceKm ?? 'null') +
      ' | stored engineHours=' + (tripData.engineHours ?? 'null') +
      ' movingHours=' + (tripData.movingHours ?? 'null')
    );

    let startTime: string | null = null;
    let arrivedTime: string | null = null;
    let endTime: string | null = null;
    let destinationMatch: any = null;

    if (route.length > 0) {
      startTime = actualEndpoints.startTime == null ? trip.departure_time_gps : String(actualEndpoints.startTime);
      endTime = actualEndpoints.endTime == null
        ? (trip.returned_to_base_at || trip.arrival_time_gps)
        : String(actualEndpoints.endTime);
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
          distance: distanceKm,
          engineHours: engineHours,
          movingHours: movingHours,
          maxSpeed: maxSpeed,
          notes: tripData.notesRemarks,
          origin: actualEndpoints.originAddress || tripData.originGpsStartPoint || '',
          destination: tripData.destinationGpsEndPoint || '',
          routeRoadTaken: tripData.actualRouteRoadTaken || '',
          toOrigin: tripData.toOrigin || null,
          toDestination: tripData.toDestination || null,
          travelOrderStatus: trip.to_status ?? null,
          toStatus: tripData.toStatusAuto || null,
          startTime,
          arrivedTime: trip.destination_reached_at || arrivedTime,
          endTime,
          plannedDestinationAddress: trip.to_destination || tripData.toDestination || null,
          plannedDestinationCoordinates: trip.to_lat_long_destination || null,
          arrivedCoordinates: trip.arrived_coordinates || (destinationMatch ? `${destinationMatch.lat},${destinationMatch.lng}` : null),
          arrivedLocation: trip.arrived_location_name || destinationMatch?.locationName || null,
          matchedDestinationDistanceM: trip.matched_destination_distance_m == null ? null : Number(trip.matched_destination_distance_m),
          endAddress: actualEndpoints.endAddress || tripData.destinationGpsEndPoint || null,
          endCoordinates: actualEndpoints.endCoordinates || tripData.coordinatesDestination || null,
          returnedToBaseAt: actualEndpoints.returnedToBaseAt == null
            ? (trip.returned_to_base_at || null)
            : String(actualEndpoints.returnedToBaseAt),
          matchedOriginDistanceM: actualEndpoints.matchedOriginDistanceM
            ?? (trip.matched_origin_distance_m == null ? null : Number(trip.matched_origin_distance_m)),
          anomalyFlag: tripData.anomalyFlag,
          parentTripId: tripData.parentTripId,
          parentGpsRecordNo: tripData.parentGpsRecordNo,
          pairedReturnId: tripData.pairedReturnId,
          pairedReturnGpsRecordNo: tripData.pairedReturnGpsRecordNo,
          missionDisplay,
          linkedOutboundTrip,
          linkedReturnTrip,
          coordinatesOrigin: actualEndpoints.originCoordinates || tripData.coordinatesOrigin || null,
          coordinatesDestination: tripData.coordinatesDestination || null,
          tripType: tripData.tripType || 'OUTBOUND',
        },
        route,
        routeCount: route.length,
        activeTripSessions: activeSessionsResult.rows.map((session: any) => ({
          activeTripId: session.active_trip_id,
          startTime: session.start_time,
          endTime: session.end_time,
        })),
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
router.post('/sync-from-telemetry', expensiveOperationRateLimit, async (req: Request, res: Response) => {
  try {
    const result = await syncGpsTripLogsFromTelemetry();
    const travelOrderSync = await syncUnlinkedGpsTripLogsToTravelOrders();
    res.json({
      success: true,
      source: 'gps_telemetry',
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      failed: result.failed,
      travel_order_sync_checked: travelOrderSync.checked,
      travel_order_sync_linked: travelOrderSync.linked,
      travel_order_sync_results: travelOrderSync.results,
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

const mapRow = mapGpsTripLogRow;

export default router;

// ── GPS Telemetry Service ──────────────────────────────────────
//
// Database operations for the gps_telemetry table.
// Stores raw vehicle telemetry snapshots captured on each
// fleet sync cycle.

import { getPool } from '../db/db.js';

export interface TelemetryInsert {
  vehicleId: string;
  plateNumber: string;
  eventType: string;
  latitude: number | null;
  longitude: number | null;
  speedKmh: number;
  fuelLiters: number | null;
  ignition: boolean;
  locationName: string | null;
  driverName: string | null;
  toNumber: string | null;
  recordedAt: string;
  activeTripId?: string | null;
}

export interface TelemetryRow {
  id: string;
  vehicleId: string;
  plateNumber: string;
  eventType: string;
  latitude: number | null;
  longitude: number | null;
  speedKmh: number;
  fuelLiters: number | null;
  ignition: boolean;
  locationName: string | null;
  driverName: string | null;
  toNumber: string | null;
  recordedAt: string;
  createdAt: string;
  activeTripId: string | null;
  // Active travel order info
  activeToNumber?: string | null;
  activeToStatus?: string | null;
  activeDriverName?: string | null;
}

interface TelemetryDbRow {
  id: string;
  vehicle_id: string;
  plate_number: string;
  event_type: string;
  latitude: number | null;
  longitude: number | null;
  speed_kmh: number;
  fuel_liters: number | null;
  ignition: boolean;
  location_name: string | null;
  driver_name: string | null;
  to_number: string | null;
  recorded_at: string;
  created_at: string;
  active_trip_id: string | null;
  active_to_number: string | null;
  active_to_status: string | null;
  active_driver_name: string | null;
}

/**
 * Get the most recent telemetry record for a vehicle.
 * Returns null if no record exists.
 */
export async function getLatestTelemetry(vehicleId: string): Promise<{
  speedKmh: number;
  fuelLiters: number | null;
  ignition: boolean;
  locationName: string | null;
  eventType: string;
  recordedAt: string;
  latitude: number | null;
  longitude: number | null;
  activeTripId: string | null;
} | null> {
  const pool = getPool();
  const result = await pool.query<{ speed_kmh: number; fuel_liters: number | null; ignition: boolean; location_name: string | null; event_type: string; recorded_at: string; latitude: number | null; longitude: number | null; active_trip_id: string | null }>(
    `SELECT speed_kmh, fuel_liters, ignition, location_name, event_type, recorded_at, latitude, longitude, active_trip_id
     FROM gps_telemetry
     WHERE vehicle_id = $1
     ORDER BY recorded_at DESC
     LIMIT 1`,
    [vehicleId],
  );
  if (result.rows.length === 0) return null;
  return {
    speedKmh: result.rows[0].speed_kmh,
    fuelLiters: result.rows[0].fuel_liters,
    ignition: result.rows[0].ignition,
    locationName: result.rows[0].location_name,
    eventType: result.rows[0].event_type,
    recordedAt: result.rows[0].recorded_at,
    latitude: result.rows[0].latitude,
    longitude: result.rows[0].longitude,
    activeTripId: result.rows[0].active_trip_id,
  };
}

/**
 * Check whether an ignition boundary event already exists for a trip cycle.
 */
export async function telemetryTripEventExists(
  vehicleId: string,
  activeTripId: string,
  eventType: string,
): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT 1
       FROM gps_telemetry
      WHERE vehicle_id = $1
        AND active_trip_id = $2
        AND event_type = $3
      LIMIT 1`,
    [vehicleId, activeTripId, eventType],
  );
  return result.rows.length > 0;
}

/**
 * Check if a telemetry record with the same key fields already exists.
 * Used for deduplication to prevent saving identical records.
 */
export async function telemetryExists(
  vehicleId: string,
  recordedAt: string,
  eventType: string,
  speedKmh: number,
  fuelLiters: number | null,
  ignition: boolean,
  locationName: string | null,
): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT COUNT(*) AS count FROM gps_telemetry
     WHERE vehicle_id = $1
       AND recorded_at = $2
       AND event_type = $3
       AND speed_kmh = $4
       AND (fuel_liters IS NOT DISTINCT FROM $5)
       AND ignition = $6
       AND (location_name IS NOT DISTINCT FROM $7)`,
    [vehicleId, recordedAt, eventType, speedKmh, fuelLiters, ignition, locationName],
  );
  return parseInt(result.rows[0]?.count || '0', 10) > 0;
}

/**
 * Insert a single telemetry data point.
 */
export async function insertTelemetry(data: TelemetryInsert): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO gps_telemetry
       (vehicle_id, plate_number, event_type, latitude, longitude,
        speed_kmh, fuel_liters, ignition, location_name,
        driver_name, to_number, recorded_at, active_trip_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT DO NOTHING`,
    [
      data.vehicleId,
      data.plateNumber,
      data.eventType,
      data.latitude,
      data.longitude,
      data.speedKmh,
      data.fuelLiters,
      data.ignition,
      data.locationName,
      data.driverName,
      data.toNumber,
      data.recordedAt,
      data.activeTripId ?? null,
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

export interface FetchTelemetryParams {
  vehicleId?: string;
  plateNumber?: string;
  eventType?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export interface TelemetryResult {
  success: boolean;
  data: TelemetryRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Fetch telemetry data with pagination and optional filters.
 * Includes active travel order and driver information via LEFT JOIN.
 */
export async function fetchTelemetry(
  params: FetchTelemetryParams = {},
): Promise<TelemetryResult> {
  const pool = getPool();
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(200, Math.max(1, params.pageSize || 50));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const values: unknown[] = [];

  if (params.vehicleId) {
    conditions.push(`gt.vehicle_id = $${values.length + 1}`);
    values.push(params.vehicleId);
  }
  if (params.plateNumber) {
    conditions.push(`gt.plate_number ILIKE $${values.length + 1}`);
    values.push(`%${params.plateNumber}%`);
  }
  if (params.eventType) {
    conditions.push(`gt.event_type = $${values.length + 1}`);
    values.push(params.eventType);
  }
  if (params.dateFrom) {
    conditions.push(`gt.recorded_at >= $${values.length + 1}`);
    values.push(params.dateFrom);
  }
  if (params.dateTo) {
    conditions.push(`gt.recorded_at <= $${values.length + 1}`);
    values.push(params.dateTo + 'T23:59:59.999Z');
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  // Count total with deduplication (same logic as data query)
  const countResult = await pool.query<{ total: string }>(
    `WITH ranked_telemetry AS (
      SELECT
        gt.id,
        gt.event_type,
        gt.speed_kmh,
        gt.ignition,
        gt.fuel_liters,
        gt.location_name,
        LAG(gt.event_type) OVER (PARTITION BY gt.vehicle_id ORDER BY gt.recorded_at) as prev_event_type,
        LAG(gt.speed_kmh) OVER (PARTITION BY gt.vehicle_id ORDER BY gt.recorded_at) as prev_speed,
        LAG(gt.ignition) OVER (PARTITION BY gt.vehicle_id ORDER BY gt.recorded_at) as prev_ignition,
        LAG(gt.fuel_liters) OVER (PARTITION BY gt.vehicle_id ORDER BY gt.recorded_at) as prev_fuel,
        LAG(gt.location_name) OVER (PARTITION BY gt.vehicle_id ORDER BY gt.recorded_at) as prev_location
      FROM gps_telemetry gt
      LEFT JOIN LATERAL (
        SELECT to_number, status, driver_id FROM travel_orders
        WHERE vehicle_id = gt.vehicle_id
        AND status IN ('APPROVED', 'ACTIVE')
        AND DATE(scheduled_departure) = DATE(gt.recorded_at)
        ORDER BY created_at DESC
        LIMIT 1
      ) to_data ON true
      LEFT JOIN drivers d ON d.id = to_data.driver_id
      ${whereClause}
    )
    SELECT COUNT(*) AS total FROM ranked_telemetry
    WHERE prev_event_type IS NULL
       OR prev_event_type != event_type
       OR prev_speed != speed_kmh
       OR prev_ignition != ignition
       OR (prev_fuel IS DISTINCT FROM fuel_liters)
       OR (prev_location IS DISTINCT FROM location_name)`,
    values,
  );
  const total = parseInt(countResult.rows[0]?.total || '0', 10);

  // Fetch data with deduplication - filter out consecutive duplicates
  const dataResult = await pool.query<TelemetryDbRow>(
    `WITH ranked_telemetry AS (
      SELECT 
        gt.*,
        to_data.to_number as active_to_number,
        to_data.status as active_to_status,
        d.full_name as active_driver_name,
        LAG(gt.event_type) OVER (PARTITION BY gt.vehicle_id ORDER BY gt.recorded_at) as prev_event_type,
        LAG(gt.speed_kmh) OVER (PARTITION BY gt.vehicle_id ORDER BY gt.recorded_at) as prev_speed,
        LAG(gt.ignition) OVER (PARTITION BY gt.vehicle_id ORDER BY gt.recorded_at) as prev_ignition,
        LAG(gt.fuel_liters) OVER (PARTITION BY gt.vehicle_id ORDER BY gt.recorded_at) as prev_fuel,
        LAG(gt.location_name) OVER (PARTITION BY gt.vehicle_id ORDER BY gt.recorded_at) as prev_location
      FROM gps_telemetry gt
      LEFT JOIN LATERAL (
        SELECT to_number, status, driver_id
        FROM travel_orders
        WHERE vehicle_id = gt.vehicle_id
        AND status IN ('APPROVED', 'ACTIVE')
        AND DATE(scheduled_departure) = DATE(gt.recorded_at)
        ORDER BY created_at DESC
        LIMIT 1
      ) to_data ON true
      LEFT JOIN drivers d ON d.id = to_data.driver_id
      ${whereClause}
    )
    SELECT *
    FROM ranked_telemetry
    WHERE prev_event_type IS NULL
       OR prev_event_type != event_type
       OR prev_speed != speed_kmh
       OR prev_ignition != ignition
       OR (prev_fuel IS DISTINCT FROM fuel_liters)
       OR (prev_location IS DISTINCT FROM location_name)
    ORDER BY recorded_at DESC
    LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, offset],
  );

  const mappedRows = dataResult.rows.map((row) => ({
    id: row.id,
    vehicleId: row.vehicle_id,
    plateNumber: row.plate_number,
    eventType: row.event_type,
    latitude: row.latitude,
    longitude: row.longitude,
    speedKmh: row.speed_kmh,
    fuelLiters: row.fuel_liters,
    ignition: row.ignition,
    locationName: row.location_name,
    driverName: row.driver_name,
    toNumber: row.to_number,
    recordedAt: row.recorded_at,
    createdAt: row.created_at,
    activeTripId: row.active_trip_id ?? null,
    activeToNumber: row.active_to_number ?? null,
    activeToStatus: row.active_to_status ?? null,
    activeDriverName: row.active_driver_name ?? null,
  }));

  return {
    success: true,
    data: mappedRows,
    total,
    page,
    pageSize,
  };
}

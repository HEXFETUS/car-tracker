// ── GPS Telemetry Service ──────────────────────────────────────
//
// Database operations for the gps_telemetry table.
// Stores raw vehicle telemetry snapshots captured on each
// fleet sync cycle.

import { getPool } from '../db/db.js';
import { IGNITION_DUPLICATE_WINDOW_SECONDS } from './gpsVehicleStateService.js';

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
  driverId?: string | null;
  travelOrderId?: string | null;
  toNumber?: string | null;
  recordedAt: string;
  activeTripId?: string | null;
  idlingThresholdMinutes?: number | null;
  telegramMessage?: string | null;
  telegramStatus?: string | null;
  telegramError?: string | null;
  telegramAttemptedAt?: string | null;
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
  driverId: string | null;
  travelOrderId: string | null;
  recordedAt: string;
  createdAt: string;
  activeTripId: string | null;
  telegramMessage: string | null;
  telegramStatus: string | null;
  telegramError: string | null;
  telegramAttemptedAt: string | null;
  toNumber: string | null;
  driverName: string | null;
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
  driver_id: string | null;
  travel_order_id: string | null;
  recorded_at: string;
  created_at: string;
  active_trip_id: string | null;
  telegram_message: string | null;
  telegram_status: string | null;
  telegram_error: string | null;
  telegram_attempted_at: string | null;
  to_number: string | null;
  driver_full_name: string | null;
}

function canonicalTelemetryEventType(eventType: string): string {
  let result: string;
  switch (eventType) {
    case 'IGNITION ON ALERT':
    case 'IGNITION_ON':
      result = 'IGNITION_ON';
      break;
    case 'IGNITION OFF ALERT':
    case 'IGNITION_OFF':
      result = 'IGNITION_OFF';
      break;
    case 'LOCATION UPDATE ALERT':
    case 'LOCATION UPDATE':
    case 'LOCATION_UPDATE':
      result = 'LOCATION_UPDATE';
      break;
    case 'MOVING ALERT':
    case 'MOTION_STARTED':
      result = 'MOTION_STARTED';
      break;
    case 'IDLING ALERT':
    case 'IDLING TOO LONG ALERT':
    case 'IDLING':
    case 'IDLING_TOO_LONG':
      result = 'IDLING_TOO_LONG';
      break;
    case 'NO_APPROVED_TRAVEL_ORDER':
      result = 'NO_APPROVED_TRAVEL_ORDER';
      break;
    default:
      result = eventType;
      break;
  }
  if (eventType !== result) {
    console.log('[EVENT NORMALIZED]', { incoming: eventType, saved: result });
  }
  return result;
}

function normalizeLocationName(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/,+$/g, '')
    .trim()
    .toLowerCase();
}

function recordedAtMinuteIso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
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
 * Deprecated: Use hasRecentIgnitionEvent from gpsVehicleStateService instead.
 * This function is kept for backward compatibility but will be removed.
 */
export async function telemetryTripEventExists(
  vehicleId: string,
  activeTripId: string,
  eventType: string,
): Promise<boolean> {
  const pool = getPool();
  // Use time-window dedup instead of tripId-based dedup
  const windowSeconds = IGNITION_DUPLICATE_WINDOW_SECONDS;
  const result = await pool.query(
    `SELECT 1
       FROM gps_telemetry
      WHERE vehicle_id = $1
        AND event_type = $2
        AND recorded_at >= now() - INTERVAL '1 second' * $3
      LIMIT 1`,
    [vehicleId, eventType, windowSeconds],
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
 * travel_order_id (UUID) is the single source of truth.
 * The TO number is obtained by JOINing to travel_orders.to_number.
 */
export async function insertTelemetry(data: TelemetryInsert): Promise<{ inserted: boolean; updated: boolean; id: string | null }> {
  const pool = getPool();
  const eventType = canonicalTelemetryEventType(data.eventType);
  const normalizedLocationName = normalizeLocationName(data.locationName);
  console.log("[TELEMETRY SERVICE] insertTelemetry called with:", {
    plate: data.plateNumber,
    inputEventType: data.eventType,
    canonicalEventType: eventType,
    speed: data.speedKmh,
    ignition: data.ignition
  });
  const recordedAtMinute = recordedAtMinuteIso(data.recordedAt);
  let inheritedTravelOrderId = data.travelOrderId ?? null;
  let inheritedDriverId = data.driverId ?? null;
  if (data.activeTripId && !inheritedTravelOrderId) {
    const inheritedResult = await pool.query<{
      travel_order_id: string | null;
      driver_id: string | null;
    }>(
      `SELECT g.travel_order_id,
              COALESCE(g.driver_id, to_.driver_id) AS driver_id
         FROM gps_trip_logs g
         LEFT JOIN travel_orders to_ ON to_.id = g.travel_order_id
        WHERE g.vehicle_id = $1
          AND g.active_trip_id = $2
          AND g.travel_order_id IS NOT NULL
        ORDER BY g.departure_time_gps DESC
        LIMIT 1`,
      [data.vehicleId, data.activeTripId],
    );
    const inherited = inheritedResult.rows[0];
    inheritedTravelOrderId = inheritedTravelOrderId ?? inherited?.travel_order_id ?? null;
    inheritedDriverId = inheritedDriverId ?? inherited?.driver_id ?? null;
  }
  console.log(
    `[telemetry] Before INSERT gps_telemetry vehicle=${data.vehicleId} plate=${data.plateNumber} event=${eventType} recorded_at=${data.recordedAt}`,
  );
  try {
    if (eventType === 'LOCATION_UPDATE') {
      if (data.ignition !== true || Number(data.speedKmh ?? 0) <= 0) {
        console.log(
          `[telemetry] LOCATION_UPDATE skipped not moving vehicle=${data.vehicleId} ignition=${data.ignition} speed=${data.speedKmh}`,
        );
        return { inserted: false, updated: false, id: null };
      }

      // Get latest LOCATION_UPDATE for same vehicle_id + active_trip_id
      // to check if location_name has changed.
      // ALWAYS create a NEW row when location_name is different.
      // Never update the existing row.
      const latestResult = await pool.query<{ id: string; location_name: string | null }>(
        `SELECT id, location_name
           FROM gps_telemetry
          WHERE vehicle_id = $1
            AND active_trip_id IS NOT DISTINCT FROM $2
            AND event_type = $3
          ORDER BY recorded_at DESC, created_at DESC
          LIMIT 1`,
        [data.vehicleId, data.activeTripId ?? null, eventType],
      );
      const latestRow = latestResult.rows[0];

      if (latestRow) {
        const latestLocation = normalizeLocationName(latestRow.location_name);
        if (latestLocation === normalizedLocationName) {
          console.log(
            `[telemetry] LOCATION_UPDATE skipped same location_name vehicle=${data.vehicleId} location=${JSON.stringify(data.locationName ?? '')}`,
          );
          return { inserted: false, updated: false, id: null };
        }
        console.log(
          `[telemetry] LOCATION_UPDATE inserted new location_name vehicle=${data.vehicleId} old_location=${JSON.stringify(latestRow.location_name)} new_location=${JSON.stringify(data.locationName ?? '')}`,
        );
      }
    }

    // ── Dedup: Use time-window for ignition events ────────────
    // DO NOT use active_trip_id for dedup because different paths
    // generate different tripIds. Use vehicle_id + event_type + time window.
    if (eventType === 'IGNITION_ON' || eventType === 'IGNITION_OFF') {
      // For IGNITION_OFF, search for IGNITION_OFF variants; for IGNITION_ON, search for ON variants
      const isOn = eventType === 'IGNITION_ON';
      const typeVariants = isOn
        ? ['IGNITION_ON', 'IGNITION ON', 'IGNITION ON ALERT']
        : ['IGNITION_OFF', 'IGNITION OFF', 'IGNITION OFF ALERT'];
      const dupResult = await pool.query<{ id: string }>(
        `SELECT id FROM gps_telemetry
         WHERE vehicle_id = $1
           AND (event_type = $2 OR event_type = $3 OR event_type = $4)
           AND ignition = $5
           AND recorded_at >= $6::timestamptz - INTERVAL '1 second' * $7
         LIMIT 1`,
        [
          data.vehicleId,
          typeVariants[0], typeVariants[1], typeVariants[2],
          data.ignition,
          data.recordedAt,
          IGNITION_DUPLICATE_WINDOW_SECONDS,
        ],
      );
      if (dupResult.rows[0]?.id) {
        if (data.telegramMessage) {
          await pool.query(
            `UPDATE gps_telemetry
                SET telegram_message = COALESCE(telegram_message, $2)
              WHERE id = $1`,
            [dupResult.rows[0].id, data.telegramMessage],
          );
        }
        console.log(
          `[telemetry] INSERT ${eventType} skipped by time-window dedup vehicle=${data.vehicleId} window=${IGNITION_DUPLICATE_WINDOW_SECONDS}s`,
        );
        return { inserted: false, updated: false, id: dupResult.rows[0].id };
      }
    } else {
      // For non-ignition events, use existing minute+doubled-location dedup
      const nonIgnitionDuplicateResult = await pool.query<{ id: string; latitude: number | null; longitude: number | null }>(
        `SELECT id
              , latitude
              , longitude
           FROM gps_telemetry
          WHERE vehicle_id = $1
            AND CASE event_type
              WHEN 'LOCATION UPDATE' THEN 'LOCATION_UPDATE'
              WHEN 'LOCATION UPDATE ALERT' THEN 'LOCATION_UPDATE'
              WHEN 'IGNITION ON' THEN 'IGNITION_ON'
              WHEN 'IGNITION ON ALERT' THEN 'IGNITION_ON'
              WHEN 'IGNITION OFF' THEN 'IGNITION_OFF'
              WHEN 'IGNITION OFF ALERT' THEN 'IGNITION_OFF'
              WHEN 'MOVING ALERT' THEN 'MOTION_STARTED'
              WHEN 'IDLING ALERT' THEN 'IDLING_TOO_LONG'
              WHEN 'IDLING TOO LONG ALERT' THEN 'IDLING_TOO_LONG'
              WHEN 'IDLING' THEN 'IDLING_TOO_LONG'
              WHEN 'IDLING_TOO_LONG' THEN 'IDLING_TOO_LONG'
              ELSE event_type
            END = $2
            AND date_trunc('minute', recorded_at AT TIME ZONE 'UTC') = date_trunc('minute', $3::timestamptz AT TIME ZONE 'UTC')
            AND lower(trim(regexp_replace(regexp_replace(coalesce(location_name, ''), ',+$', ''), '\\s+', ' ', 'g'))) = $4
          LIMIT 1`,
        [
          data.vehicleId,
          eventType,
          recordedAtMinute,
          normalizedLocationName,
        ],
      );
      const nonIgnitionDuplicateRow = nonIgnitionDuplicateResult.rows[0];
      if (nonIgnitionDuplicateRow?.id) {
        if (eventType !== 'LOCATION_UPDATE') {
          if (data.telegramMessage) {
            await pool.query(
              `UPDATE gps_telemetry
                  SET telegram_message = COALESCE(telegram_message, $2)
                WHERE id = $1`,
              [nonIgnitionDuplicateRow.id, data.telegramMessage],
            );
          }
            console.log(
              `[telemetry] INSERT gps_telemetry skipped by dedupe key vehicle=${data.vehicleId} event=${eventType} minute=${recordedAtMinute} location=${JSON.stringify(normalizedLocationName)}`,
            );
            return { inserted: false, updated: false, id: nonIgnitionDuplicateRow.id };
        }
      }
    }

    const result = await pool.query<{ id: string }>(
      `INSERT INTO gps_telemetry
       (vehicle_id, plate_number, event_type, latitude, longitude,
        speed_kmh, fuel_liters, ignition, location_name,
        driver_id, travel_order_id, recorded_at, active_trip_id, idling_threshold_minutes, telegram_message,
        telegram_status, telegram_error, telegram_attempted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     ON CONFLICT DO NOTHING
     RETURNING id`,
        [
          data.vehicleId,
          data.plateNumber,
          eventType,
          data.latitude,
          data.longitude,
          data.speedKmh,
          data.fuelLiters,
          data.ignition,
          data.locationName,
          inheritedDriverId,
          inheritedTravelOrderId,
          data.recordedAt,
          data.activeTripId ?? null,
          data.idlingThresholdMinutes ?? null,
          data.telegramMessage ?? null,
          data.telegramStatus ?? null,
          data.telegramError ?? null,
          data.telegramAttemptedAt ?? null,
        ],
    );
    const id = result.rows[0]?.id ?? null;
    if (id) {
      console.log(`[telemetry] INSERT gps_telemetry succeeded id=${id}`);
      return { inserted: true, updated: false, id };
    }
    console.log(
      `[telemetry] INSERT gps_telemetry skipped by conflict vehicle=${data.vehicleId} event=${eventType} active_trip_id=${data.activeTripId ?? 'null'}`,
    );
    const conflictResult = eventType === 'IGNITION_ON'
      ? await pool.query<{ id: string; latitude: number | null; longitude: number | null }>(
        `SELECT id, latitude, longitude
           FROM gps_telemetry
          WHERE vehicle_id = $1
            AND active_trip_id = $2
            AND CASE event_type
              WHEN 'IGNITION ON' THEN 'IGNITION_ON'
              WHEN 'IGNITION ON ALERT' THEN 'IGNITION_ON'
              ELSE event_type
            END = 'IGNITION_ON'
          LIMIT 1`,
        [data.vehicleId, data.activeTripId ?? null],
      )
      : await pool.query<{ id: string; latitude: number | null; longitude: number | null }>(
        `SELECT id
              , latitude
              , longitude
           FROM gps_telemetry
          WHERE vehicle_id = $1
            AND CASE event_type
              WHEN 'LOCATION UPDATE' THEN 'LOCATION_UPDATE'
              WHEN 'LOCATION UPDATE ALERT' THEN 'LOCATION_UPDATE'
              WHEN 'IGNITION ON' THEN 'IGNITION_ON'
              WHEN 'IGNITION ON ALERT' THEN 'IGNITION_ON'
              WHEN 'IGNITION OFF' THEN 'IGNITION_OFF'
              WHEN 'IGNITION OFF ALERT' THEN 'IGNITION_OFF'
              WHEN 'MOVING ALERT' THEN 'MOTION_STARTED'
              WHEN 'IDLING ALERT' THEN 'IDLING_TOO_LONG'
              WHEN 'IDLING TOO LONG ALERT' THEN 'IDLING_TOO_LONG'
              WHEN 'IDLING' THEN 'IDLING_TOO_LONG'
              WHEN 'IDLING_TOO_LONG' THEN 'IDLING_TOO_LONG'
              ELSE event_type
            END = $2
            AND date_trunc('minute', recorded_at AT TIME ZONE 'UTC') = date_trunc('minute', $3::timestamptz AT TIME ZONE 'UTC')
            AND lower(trim(regexp_replace(regexp_replace(coalesce(location_name, ''), ',+$', ''), '\\s+', ' ', 'g'))) = $4
          LIMIT 1`,
        [data.vehicleId, eventType, recordedAtMinute, normalizedLocationName],
      );
    const conflictRow = conflictResult.rows[0];
    let conflictId = conflictRow?.id ?? null;
    if (conflictId && data.telegramMessage) {
      await pool.query(
        `UPDATE gps_telemetry
            SET telegram_message = COALESCE(telegram_message, $2)
          WHERE id = $1`,
        [conflictId, data.telegramMessage],
      );
    }
    if (conflictId) {
      console.log(
        `[telemetry] INSERT gps_telemetry conflict matched existing_id=${conflictId} vehicle=${data.vehicleId} event=${eventType}`,
      );
    }
    return { inserted: false, updated: false, id: conflictId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[telemetry] INSERT gps_telemetry failed: ${message}`);
    throw error;
  }
}

export async function updateTelemetryTelegramMessage(id: string, telegramMessage: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE gps_telemetry
        SET telegram_message = $2
      WHERE id = $1`,
    [id, telegramMessage],
  );
}

export async function updateTelemetryTelegramDelivery(
  id: string,
  status: 'sent' | 'failed' | 'skipped',
  error: string | null,
  attemptedAt: string,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE gps_telemetry
        SET telegram_status = $2,
            telegram_error = $3,
            telegram_attempted_at = $4
      WHERE id = $1`,
    [id, status, error, attemptedAt],
  );
}


/**
 * Get the last idling threshold minutes for a vehicle + active trip.
 * Returns 0 if no idling alert has been saved for this trip.
 */
export async function getLastIdlingThreshold(vehicleId: string, activeTripId: string): Promise<number> {
  const pool = getPool();
  const result = await pool.query<{ threshold: number | null }>(
    `SELECT COALESCE(MAX(idling_threshold_minutes), 0) AS threshold
       FROM gps_telemetry
      WHERE vehicle_id = $1
        AND active_trip_id = $2
        AND event_type = 'IDLING_TOO_LONG'
        AND idling_threshold_minutes IS NOT NULL`,
    [vehicleId, activeTripId],
  );
  return result.rows[0]?.threshold ?? 0;
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
 * Includes travel order and driver display fields from the IDs stored on each telemetry row.
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
        t_order.to_number,
        d.full_name as driver_full_name,
        LAG(gt.event_type) OVER (PARTITION BY gt.vehicle_id ORDER BY gt.recorded_at) as prev_event_type,
        LAG(gt.speed_kmh) OVER (PARTITION BY gt.vehicle_id ORDER BY gt.recorded_at) as prev_speed,
        LAG(gt.ignition) OVER (PARTITION BY gt.vehicle_id ORDER BY gt.recorded_at) as prev_ignition,
        LAG(gt.fuel_liters) OVER (PARTITION BY gt.vehicle_id ORDER BY gt.recorded_at) as prev_fuel,
        LAG(gt.location_name) OVER (PARTITION BY gt.vehicle_id ORDER BY gt.recorded_at) as prev_location
      FROM gps_telemetry gt
      LEFT JOIN travel_orders t_order ON t_order.id = gt.travel_order_id
      LEFT JOIN drivers d ON d.id = gt.driver_id
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
    driverId: row.driver_id ?? null,
    travelOrderId: row.travel_order_id ?? null,
    recordedAt: row.recorded_at,
    createdAt: row.created_at,
    activeTripId: row.active_trip_id ?? null,
    telegramMessage: row.telegram_message ?? null,
    telegramStatus: row.telegram_status ?? null,
    telegramError: row.telegram_error ?? null,
    telegramAttemptedAt: row.telegram_attempted_at ?? null,
    toNumber: row.to_number ?? null,
    driverName: row.driver_full_name ?? null,
  }));

  return {
    success: true,
    data: mappedRows,
    total,
    page,
    pageSize,
  };
}

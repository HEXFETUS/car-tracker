// ── GPS Trip Log Service ──────────────────────────────────────
//
// Database persistence layer for automated GPS trip log ingestion.
// Called by the cron sync pipeline after each fleet telemetry cycle.

import { getPool } from '../db/db.js';
import { createGpsAlert, getVehiclePlate } from './gpsAlertService.js';
import { DEFAULT_ORIGIN, DEFAULT_BASE_RADIUS_METERS } from '../config/constants.js';
import { getFleetConfig } from './fleetConfigService.js';

// ── Types ──────────────────────────────────────────────────────

export interface GpsLogInsertData {
  gpsRecordNo: string;
  tripDate: string;
  vehicleId: string;
  driverId: string | null;
  originGpsStartPoint: string;
  destinationGpsEndPoint: string;
  coordinatesOrigin?: string | null;
  coordinatesDestination?: string | null;
  actualRouteRoadTaken: string;
  departureTimeGps: string | null;
  arrivalTimeGps: string | null;
  gpsDistanceKm: number;
  engineHours: number;
  maxSpeedKph: number;
  tripStatusGps: string;
  travelOrderId: string | null;
  toStatusAuto: string | null;
  anomalyFlag: boolean;
  notesRemarks: string | null;
  // Enhanced fields
  destinationVerified?: boolean;
  tripType?: 'OUTBOUND' | 'RETURN';
  parentTripId?: string | null;
}

export interface ApprovedTravelOrderResult {
  id: string;
  vehicle_id: string;
  driver_id: string;
  status: string;
}

// ── Relational Lookups ─────────────────────────────────────────

/**
 * Find a vehicle record by its plate number (case-insensitive).
 * Returns the vehicle UUID or null if not found.
 */
export async function findVehicleByPlate(plateNumber: string): Promise<string | null> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM vehicles WHERE UPPER(plate_number) = UPPER($1) LIMIT 1`,
    [plateNumber],
  );
  return result.rows[0]?.id ?? null;
}

/**
 * Find an ongoing trip log for a vehicle (one that has no arrival time yet).
 * Returns the trip record or null if no active trip exists.
 */
export async function findOngoingTripLog(vehicleId: string): Promise<{ id: string } | null> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `SELECT id
       FROM gps_trip_logs
      WHERE vehicle_id = $1
        AND arrival_time_gps IS NULL
        AND departure_time_gps IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [vehicleId],
  );
  return result.rows[0] ?? null;
}

/**
 * Find an active/approved travel order assigned to the given vehicle.
 * Returns the travel order record or null.
 */
export async function findActiveTravelOrder(
  vehicleId: string,
): Promise<{ id: string; status: string; driver_id: string | null } | null> {
  const pool = getPool();
  const result = await pool.query<{ id: string; status: string; driver_id: string | null }>(
    `SELECT id, status, driver_id
       FROM travel_orders
      WHERE vehicle_id = $1
        AND UPPER(status) IN ('ACTIVE', 'APPROVED')
      ORDER BY created_at DESC
      LIMIT 1`,
    [vehicleId],
  );
  return result.rows[0] ?? null;
}

export interface TravelOrderWithTimes extends ApprovedTravelOrderResult {
  scheduled_departure: string | null;
  scheduled_arrival: string | null;
  lat_long_origin: string | null;
  lat_long_destination: string | null;
  to_number: string | null;
  location_name: string | null;
  origin_location: string | null;
  destination_target: string | null;
}

/**
 * Find a travel order that is APPROVED, ACTIVE, or COMPLETED for a
 * specific vehicle on a specific date. The date check uses the
 * scheduled_departure and scheduled_arrival range.
 *
 * Returns the matched travel order record or null if no valid
 * travel order exists for that vehicle on that date.
 */
export async function findApprovedTravelOrderForDate(
  vehicleId: string,
  dateStr: string,
): Promise<ApprovedTravelOrderResult | null> {
  const pool = getPool();
  const result = await pool.query<ApprovedTravelOrderResult>(
    `SELECT id, vehicle_id, driver_id, status
       FROM travel_orders
      WHERE vehicle_id = $1
        AND status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
        AND $2::date BETWEEN scheduled_departure::date AND COALESCE(scheduled_arrival::date, $2::date)
      ORDER BY created_at DESC
      LIMIT 1`,
    [vehicleId, dateStr],
  );
  return result.rows[0] ?? null;
}

/**
 * Find ALL travel orders that are APPROVED, ACTIVE, or COMPLETED for a
 * specific vehicle on a specific date. Used when multiple TOs exist
 * for the same vehicle/driver on the same day, so we can match each
 * GPS trip to the correct TO based on departure/arrival time proximity.
 *
 * Returns an array of matching travel orders ordered by scheduled_departure ASC.
 */
export async function findAllTravelOrdersForDate(
  vehicleId: string,
  dateStr: string,
): Promise<TravelOrderWithTimes[]> {
  const pool = getPool();
  const result = await pool.query<TravelOrderWithTimes>(
    `SELECT id, vehicle_id, driver_id, status,
            scheduled_departure, scheduled_arrival,
            lat_long_origin, lat_long_destination,
            to_number, location_name,
            origin_location, destination_target
       FROM travel_orders
      WHERE vehicle_id = $1
        AND status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
        AND $2::date BETWEEN scheduled_departure::date AND COALESCE(scheduled_arrival::date, $2::date)
      ORDER BY scheduled_departure ASC`,
    [vehicleId, dateStr],
  );
  return result.rows;
}

/**
 * Find the best travel order for a GPS trip using the trip date first,
 * then the trip timestamps/coordinates when there are multiple candidates.
 */
export async function findTravelOrderForGpsTrip(
  vehicleId: string,
  tripDate: string,
  departureTimeGps: string | null,
  arrivalTimeGps: string | null,
  destinationCoord: string | null = null,
): Promise<TravelOrderWithTimes | null> {
  const candidates = await findAllTravelOrdersForDate(vehicleId, tripDate);
  return matchTravelOrderToGpsTrip(
    departureTimeGps,
    arrivalTimeGps,
    destinationCoord,
    candidates,
  );
}

/**
 * Given a GPS trip's departure and arrival times, find the best-matching
 * travel order from a list of candidate orders. The matching algorithm:
 *
 * Priority:
 * 1. Same vehicle (already filtered in query)
 * 2. GPS departure falls within TO departure window
 * 3. GPS arrival falls within TO expected trip window
 * 4. Destination coordinates match TO destination coordinates
 *
 * Returns the matched travel order, or the first candidate if no clear
 * match can be determined, or null if candidates list is empty.
 */
/**
 * Default tolerance for matching GPS departure time to TO departure time.
 * A GPS driving timestamp within this window (±TO_DEPARTURE_TOLERANCE_MS)
 * of the TO's scheduled departure is considered a match.
 */
const TO_DEPARTURE_TOLERANCE_MS = 10 * 60 * 1000; // ±10 minutes default

/**
 * Configurable distance threshold for coordinate-based matching.
 * Uses FLEET_CONFIG.trip.coordMatchThresholdM as the single source of truth.
 */
export const TO_COORD_MATCH_THRESHOLD_M = getFleetConfig().trip.coordMatchThresholdM;

/**
 * Safe timestamp parser: accepts string, Date, number, or null/undefined.
 * Exported so other services (trackingHistorySyncService) can use it too.
 */
/**
 * Parse Cartrack trip summary timestamps like "2026-06-17 14:21:13+08".
 * Normalizes short timezone offsets to full ISO 8601 before parsing.
 */
export function parseCartrackTripTimestamp(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : value;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  // Normalize "2026-06-17 14:21:13+08" → "2026-06-17T14:21:13+08:00"
  const normalized = raw.replace(
    /^(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}:\d{2})([+-]\d{2})$/,
    '$1T$2$3:00',
  );

  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseTimestampSafe(ts: unknown, label = "timestamp"): number | null {
  if (ts === null || ts === undefined || ts === "") {
    return null;
  }

  // Date object from DB driver — use directly, do not parse again
  if (ts instanceof Date) {
    const ms = ts.getTime();
    return Number.isNaN(ms) ? null : ms;
  }

  // Number: treat as epoch ms or seconds
  if (typeof ts === "number") {
    const ms = ts >= 1e12 ? ts : ts * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }

  // Only call .trim() after confirming it's a string
  if (typeof ts !== "string") {
    console.warn(`[SyncHistory] ${label}: unsupported type ${typeof ts}`, ts);
    return null;
  }

  const trimmed = ts.trim();
  if (!trimmed) return null;

  // Timestamps are stored as local Philippine time without timezone (e.g. "2026-06-17 10:00:00")
  // Parse with explicit UTC+8 offset so both TO and GPS timestamps are in the same reference frame
  const normalized = trimmed.replace(" ", "T");
  const d = new Date(`${normalized}+08:00`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/**
 * Check whether a TO departure (or return) time falls inside a GPS trip
 * time window, with optional logging.
 *
 * A trip can only match a TO if:
 *   tripStart <= toTimestamp <= tripEnd
 *
 * This prevents matching a trip that ends before the TO departure
 * (e.g. 08:10–08:31 trip cannot match a 10:10 departure).
 */
function isTimestampContainedInTrip(
  label: string,
  toTimestampMs: number | null,
  tripStartMs: number | null,
  tripEndMs: number | null,
  log?: (msg: string) => void,
): boolean {
  if (toTimestampMs === null) {
    if (log) log(`  ${label}: TO timestamp is null → cannot check containment`);
    return false;
  }
  if (tripStartMs === null || tripEndMs === null) {
    if (log) log(`  ${label}: Trip start/end is null → cannot check containment`);
    return false;
  }
  const contained = tripStartMs <= toTimestampMs && tripEndMs >= toTimestampMs;
  if (log) {
    log(`  ${label}: tripStart=${new Date(tripStartMs).toISOString()}, tripEnd=${new Date(tripEndMs).toISOString()}, toTime=${new Date(toTimestampMs).toISOString()}, contained=${contained}`);
  }
  return contained;
}

/**
 * Given a GPS trip's departure and arrival times, find the best-matching
 * travel order from a list of candidate orders.
 *
 * MATCHING ALGORITHM (containment-based):
 *
 * A trip can only match a TO if the TO's departure or arrival time is
 * CONTAINED within the trip's time window:
 *
 *   trip.start_timestamp <= TO.departure <= trip.end_timestamp
 *   OR
 *   trip.start_timestamp <= TO.arrival <= trip.end_timestamp
 *
 * Priority order:
 * 1. TO departure AND TO arrival both contained in trip (strongest match)
 * 2. TO departure contained in trip
 * 3. TO arrival contained in trip
 * 4. Destination coordinates match (within 200m)
 *
 * If no TO passes containment check, return null (REJECT).
 *
 * @returns The matched travel order, or null if no match.
 */
export function matchTravelOrderToGpsTrip(
  gpsDepartureTime: string | null,
  gpsArrivalTime: string | null,
  gpsDestinationCoord: string | null,
  candidates: TravelOrderWithTimes[],
  logCallback?: (msg: string) => void,
): TravelOrderWithTimes | null {
  const log = logCallback ?? ((_msg: string) => { /* no-op */ });

  if (!candidates || candidates.length === 0) {
    log('[TO Match] No candidates provided → null');
    return null;
  }

  const gpsDepMs = parseTimestampSafe(gpsDepartureTime);
  const gpsArrMs = parseTimestampSafe(gpsArrivalTime);

  log(`[TO Match] Trip: dep=${gpsDepartureTime} (${gpsDepMs ? new Date(gpsDepMs).toISOString() : 'null'}), arr=${gpsArrivalTime} (${gpsArrMs ? new Date(gpsArrMs).toISOString() : 'null'})`);
  log(`[TO Match] Candidates: ${candidates.length}`);

  // Debug: show raw scheduled times and parsed Manila times
  for (const c of candidates) {
    const rawDep = c.scheduled_departure ?? 'null';
    const rawArr = c.scheduled_arrival ?? 'null';
    const parsedDepMs = parseTimestampSafe(rawDep);
    const parsedArrMs = parseTimestampSafe(rawArr);
    log(`[TO Match] TO #${c.to_number ?? c.id}: rawDep=${rawDep}, rawArr=${rawArr}, parsedDep=${parsedDepMs ? new Date(parsedDepMs).toISOString() : 'null'}, parsedArr=${parsedArrMs ? new Date(parsedArrMs).toISOString() : 'null'}`);
  }

  // ── Pass 1: Both departure AND arrival contained (best match) ─────────
  for (const to of candidates) {
    const toDepMs = parseTimestampSafe(to.scheduled_departure);
    const toArrMs = parseTimestampSafe(to.scheduled_arrival);

    log(`\n  TO #${to.to_number ?? to.id}:`);
    log(`    TO departure: ${to.scheduled_departure} (${toDepMs ? new Date(toDepMs).toISOString() : 'null'})`);
    log(`    TO arrival:   ${to.scheduled_arrival} (${toArrMs ? new Date(toArrMs).toISOString() : 'null'})`);
    log(`    Trip start:   ${gpsDepartureTime} (${gpsDepMs ? new Date(gpsDepMs).toISOString() : 'null'})`);
    log(`    Trip end:     ${gpsArrivalTime} (${gpsArrMs ? new Date(gpsArrMs).toISOString() : 'null'})`);

    const containsDeparture = isTimestampContainedInTrip('containsDeparture', toDepMs, gpsDepMs, gpsArrMs, log);
    const containsArrival = isTimestampContainedInTrip('containsArrival', toArrMs, gpsDepMs, gpsArrMs, log);

    log(`    containsDeparture: ${containsDeparture}`);
    log(`    containsArrival: ${containsArrival}`);

    if (containsDeparture && containsArrival) {
      log(`    ✅ ACCEPT — trip contains both TO departure and TO arrival`);
      return to;
    }
  }

  // ── Pass 2: TO departure contained in trip ────────────────────────────
  for (const to of candidates) {
    const toDepMs = parseTimestampSafe(to.scheduled_departure);
    const toArrMs = parseTimestampSafe(to.scheduled_arrival);

    const containsDeparture = isTimestampContainedInTrip('containsDeparture', toDepMs, gpsDepMs, gpsArrMs);
    if (containsDeparture) {
      log(`  TO #${to.to_number ?? to.id}: ✅ ACCEPT — trip contains TO departure`);
      return to;
    }
  }

  // ── Pass 3: Coordinate-only match (destination proximity) ─────────────
  if (gpsDestinationCoord) {
    for (const to of candidates) {
      if (to.lat_long_destination) {
        const dist = haversineDistance(gpsDestinationCoord, to.lat_long_destination);
        log(`  TO #${to.to_number ?? to.id}: coordMatch dist=${dist.toFixed(1)}m`);
        if (dist <= TO_COORD_MATCH_THRESHOLD_M) {
          log(`  ✅ ACCEPT — coordinate match within ${TO_COORD_MATCH_THRESHOLD_M}m`);
          return to;
        }
      }
    }
  }

  log(`  ❌ REJECT — no TO matches containment or coordinate criteria`);
  return null;
}

/**
 * Check if a GPS destination coordinate is within the configured threshold
 * of a given coordinate (used for return trip destination = origin verification).
 */
export function isCoordinateClose(
  coord1: string | null,
  coord2: string | null,
  thresholdM: number = TO_COORD_MATCH_THRESHOLD_M,
): boolean {
  if (!coord1 || !coord2) return false;
  const dist = haversineDistance(coord1, coord2);
  return dist <= thresholdM;
}

/**
 * Calculate haversine distance in meters between two coordinate strings.
 */
export function haversineDistance(coord1: string | null, coord2: string | null): number {
  if (!coord1 || !coord2) return Infinity;
  const match1 = String(coord1).trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  const match2 = String(coord2).trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match1 || !match2) return Infinity;

  const lat1 = Number(match1[1]);
  const lon1 = Number(match1[2]);
  const lat2 = Number(match2[1]);
  const lon2 = Number(match2[2]);

  const R = 6371e3; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const clampedA = Math.min(1, Math.max(0, a));
  const c = 2 * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));
  return R * c;
}

/**
 * Find a driver by their full name (case-insensitive, partial match).
 * Returns the driver UUID or null if not found.
 */
export async function findDriverByName(driverName: string): Promise<string | null> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM drivers
      WHERE UPPER(full_name) = UPPER($1)
      LIMIT 1`,
    [driverName],
  );
  return result.rows[0]?.id ?? null;
}

// ── GPS Trip Log Persistence ───────────────────────────────────

/**
 * Insert a single GPS trip log record into the database.
 * Returns the inserted row or throws on failure.
 */
export async function saveGpsTripLog(logData: GpsLogInsertData): Promise<{ id: string }> {
  const pool = getPool();

  const tripType = logData.tripType ?? 'OUTBOUND';
  const existingTrip = await pool.query<{ id: string }>(
    `SELECT id
       FROM gps_trip_logs
      WHERE vehicle_id = $1
        AND trip_date = $2
        AND trip_type = $3
        AND departure_time_gps IS NOT DISTINCT FROM $4::timestamptz
        AND arrival_time_gps IS NOT DISTINCT FROM $5::timestamptz
      ORDER BY created_at DESC
      LIMIT 1`,
    [
      logData.vehicleId,
      logData.tripDate,
      tripType,
      logData.departureTimeGps,
      logData.arrivalTimeGps,
    ],
  );

  if (existingTrip.rows[0]) {
    const result = await pool.query<{ id: string }>(
      `UPDATE gps_trip_logs
          SET driver_id = COALESCE($2, driver_id),
              origin_gps_start_point = COALESCE(NULLIF($3, ''), origin_gps_start_point),
              destination_gps_end_point = COALESCE(NULLIF($4, ''), destination_gps_end_point),
              coordinates_origin = COALESCE($5, coordinates_origin),
              coordinates_destination = COALESCE($6, coordinates_destination),
              actual_route_road_taken = COALESCE(NULLIF($7, ''), actual_route_road_taken),
              gps_distance_km = $8,
              engine_hours = $9,
              max_speed_kph = $10,
              trip_status_gps = $11,
              travel_order_id = COALESCE($12, travel_order_id),
              to_status_auto = COALESCE($13, to_status_auto),
              anomaly_flag = $14,
              notes_remarks = COALESCE($15, notes_remarks),
              destination_verified = COALESCE($16, destination_verified),
               parent_trip_id = COALESCE($17, parent_trip_id)
         WHERE id = $1
         RETURNING id`,
      [
        existingTrip.rows[0].id,
        logData.driverId,
        logData.originGpsStartPoint,
        logData.destinationGpsEndPoint,
        logData.coordinatesOrigin ?? null,
        logData.coordinatesDestination ?? null,
        logData.actualRouteRoadTaken,
        logData.gpsDistanceKm,
        logData.engineHours,
        logData.maxSpeedKph,
        logData.tripStatusGps,
        logData.travelOrderId,
        logData.toStatusAuto,
        logData.anomalyFlag,
        logData.notesRemarks,
        logData.destinationVerified ?? false,
        logData.parentTripId ?? null,
      ],
    );
    return result.rows[0];
  }

  const result = await pool.query<{ id: string }>(
    `INSERT INTO gps_trip_logs
       (gps_record_no, trip_date, vehicle_id, driver_id,
        origin_gps_start_point, destination_gps_end_point,
        coordinates_origin, coordinates_destination,
        actual_route_road_taken, departure_time_gps, arrival_time_gps,
        gps_distance_km, engine_hours, max_speed_kph,
        trip_status_gps, travel_order_id, to_status_auto,
         anomaly_flag, notes_remarks,
         destination_verified, trip_type, parent_trip_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
     ON CONFLICT (gps_record_no) DO UPDATE SET
        gps_distance_km     = EXCLUDED.gps_distance_km,
        max_speed_kph       = EXCLUDED.max_speed_kph,
        engine_hours        = EXCLUDED.engine_hours,
        arrival_time_gps    = EXCLUDED.arrival_time_gps,
        trip_status_gps     = EXCLUDED.trip_status_gps,
        anomaly_flag        = EXCLUDED.anomaly_flag,
        notes_remarks       = EXCLUDED.notes_remarks,
         destination_verified = COALESCE(EXCLUDED.destination_verified, gps_trip_logs.destination_verified),
         trip_type           = COALESCE(EXCLUDED.trip_type, gps_trip_logs.trip_type),
         parent_trip_id      = COALESCE(EXCLUDED.parent_trip_id, gps_trip_logs.parent_trip_id),
         coordinates_origin  = COALESCE(EXCLUDED.coordinates_origin, gps_trip_logs.coordinates_origin),
        coordinates_destination = COALESCE(EXCLUDED.coordinates_destination, gps_trip_logs.coordinates_destination)
     RETURNING id`,
    [
      logData.gpsRecordNo,
      logData.tripDate,
      logData.vehicleId,
      logData.driverId,
      logData.originGpsStartPoint,
      logData.destinationGpsEndPoint,
      logData.coordinatesOrigin ?? null,
      logData.coordinatesDestination ?? null,
      logData.actualRouteRoadTaken,
      logData.departureTimeGps,
      logData.arrivalTimeGps,
      logData.gpsDistanceKm,
      logData.engineHours,
      logData.maxSpeedKph,
      logData.tripStatusGps,
      logData.travelOrderId,
      logData.toStatusAuto,
      logData.anomalyFlag,
      logData.notesRemarks,
      logData.destinationVerified ?? false,
      tripType,
      logData.parentTripId ?? null,
    ],
  );
  return result.rows[0];
}

/**
 * Update specific fields of an existing GPS trip log record.
 */
export async function updateGpsTripLog(
  id: string,
  updates: {
    arrivalTimeGps?: string | null;
    destinationGpsEndPoint?: string;
    coordinatesDestination?: string;
    gpsDistanceKm?: number;
    engineHours?: number;
    maxSpeedKph?: number;
    tripStatusGps?: string;
    anomalyFlag?: boolean;
    notesRemarks?: string | null;
    destinationVerified?: boolean;
    tripType?: 'OUTBOUND' | 'RETURN';
    parentTripId?: string | null;
    travelOrderId?: string | null;
    toStatusAuto?: string | null;
    travelOrderNo?: string | null;
  },
): Promise<void> {
  const pool = getPool();
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.arrivalTimeGps !== undefined) {
    setClauses.push(`arrival_time_gps = $${idx++}`);
    values.push(updates.arrivalTimeGps);
  }
  if (updates.destinationGpsEndPoint !== undefined) {
    setClauses.push(`destination_gps_end_point = $${idx++}`);
    values.push(updates.destinationGpsEndPoint);
  }
  if (updates.coordinatesDestination !== undefined) {
    setClauses.push(`coordinates_destination = $${idx++}`);
    values.push(updates.coordinatesDestination);
  }
  if (updates.gpsDistanceKm !== undefined) {
    setClauses.push(`gps_distance_km = $${idx++}`);
    values.push(updates.gpsDistanceKm);
  }
  if (updates.engineHours !== undefined) {
    setClauses.push(`engine_hours = $${idx++}`);
    values.push(updates.engineHours);
  }
  if (updates.maxSpeedKph !== undefined) {
    setClauses.push(`max_speed_kph = $${idx++}`);
    values.push(updates.maxSpeedKph);
  }
  if (updates.tripStatusGps !== undefined) {
    setClauses.push(`trip_status_gps = $${idx++}`);
    values.push(updates.tripStatusGps);
  }
  if (updates.anomalyFlag !== undefined) {
    setClauses.push(`anomaly_flag = $${idx++}`);
    values.push(updates.anomalyFlag);
  }
  if (updates.notesRemarks !== undefined) {
    setClauses.push(`notes_remarks = $${idx++}`);
    values.push(updates.notesRemarks);
  }
  if (updates.destinationVerified !== undefined) {
    setClauses.push(`destination_verified = $${idx++}`);
    values.push(updates.destinationVerified);
  }
  if (updates.tripType !== undefined) {
    setClauses.push(`trip_type = $${idx++}`);
    values.push(updates.tripType);
  }
  if (updates.parentTripId !== undefined) {
    setClauses.push(`parent_trip_id = $${idx++}`);
    values.push(updates.parentTripId);
  }
  if (updates.travelOrderId !== undefined) {
    setClauses.push(`travel_order_id = $${idx++}`);
    values.push(updates.travelOrderId);
  }
  if (updates.toStatusAuto !== undefined) {
    setClauses.push(`to_status_auto = $${idx++}`);
    values.push(updates.toStatusAuto);
  }
  if (updates.travelOrderNo !== undefined) {
    setClauses.push(`travel_order_no = $${idx++}`);
    values.push(updates.travelOrderNo);
  }

  if (setClauses.length === 0) return;

  values.push(id);
  await pool.query(
    `UPDATE gps_trip_logs SET ${setClauses.join(', ')} WHERE id = $${idx}`,
    values,
  );
}

/**
 * Resolve all relational IDs for a GPS log entry.
 * Runs vehicle lookup, travel order lookup, and driver lookup in parallel.
 */
export async function resolveGpsLogRelations(params: {
  plateNumber: string;
  driverName: string | null;
}): Promise<{
  vehicleId: string | null;
  travelOrderId: string | null;
  toStatusAuto: string | null;
  driverId: string | null;
}> {
  const { plateNumber, driverName } = params;

  // Step 1: Find the vehicle by plate number
  const vehicleId = await findVehicleByPlate(plateNumber);
  if (!vehicleId) {
    return { vehicleId: null, travelOrderId: null, toStatusAuto: null, driverId: null };
  }

  // Step 2: Find active travel order and driver in parallel
  const [travelOrder, directDriverId] = await Promise.all([
    findActiveTravelOrder(vehicleId),
    driverName ? findDriverByName(driverName) : Promise.resolve(null),
  ]);

  // Step 3: If a travel order exists, use its driver; otherwise use the directly matched driver
  const driverId = travelOrder?.driver_id ?? directDriverId ?? null;
  const travelOrderId = travelOrder?.id ?? null;
  const toStatusAuto = travelOrder?.status ?? null;

  return { vehicleId, travelOrderId, toStatusAuto, driverId };
}

// ── Trip Log Types from Tracker ─────────────────────────────────

export interface TripLogRecord {
  vehicleId?: string | null;
  plateNumber: string;
  tripDate: string;
  originGpsStartPoint: string;
  destinationGpsEndPoint: string;
  coordinatesOrigin?: string | null;
  coordinatesDestination?: string | null;
  actualRouteRoadTaken: string;
  departureTimeGps: string | null;
  arrivalTimeGps: string | null;
  gpsDistanceKm: number;
  engineHours: number;
  maxSpeedKph: number;
  tripStatus: string;
  anomalyFlag: boolean;
  driverName: string | null;
  toNumber: string | null;
}

/**
 * Generate a GPS record number in the format GPS-{YEAR}-{SEQUENTIAL}.
 *
 * The sequence is computed based on chronological order of trips:
 * - Ordered by departure_time_gps ASC, then created_at ASC, then id ASC
 * - Newer trips (by departure_time_gps) receive higher sequence numbers.
 * - The numbering resets per calendar year extracted from the trip's own
 *   departure time rather than from the clock at insert time.
 *
 * If `departureTimeGps` is null, the current local date is used as a
 * fallback.
 */
export async function generateGpsRecordNo(departureTimeGps: string | null): Promise<string> {
  const pool = getPool();
  const tripDate = departureTimeGps ? new Date(departureTimeGps) : new Date();
  const year = tripDate.getFullYear();

  // Find the next sequence number by counting existing trips in chronological order
  // for the same year. This ensures new trips get the correct sequence based on
  // departure_time_gps ASC, created_at ASC, id ASC ordering.
  const countResult = await pool.query<{ cnt: string }>(
    `WITH year_trips AS (
       SELECT 
         ROW_NUMBER() OVER (
           ORDER BY 
             departure_time_gps ASC NULLS LAST,
             created_at ASC,
             id ASC
         ) AS seq
       FROM gps_trip_logs
       WHERE EXTRACT(YEAR FROM COALESCE(departure_time_gps, trip_date, created_at)) = $1
     )
     SELECT COUNT(*) AS cnt FROM year_trips`,
    [year],
  );
  const nextSeq = (parseInt(countResult.rows[0]?.cnt || '0', 10)) + 1;
  return `GPS-${year}-${String(nextSeq).padStart(4, '0')}`;
}

/**
 * Clamp a numeric value to fit within a PostgreSQL NUMERIC(p,s) column.
 * Returns a number to avoid JS floating-point precision loss.
 */
function clampNumeric(value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(value, max);
}

/**
 * Persist a batch of trip log records from the fleet sync pipeline
 * into the gps_trip_logs database table.
 *
 * For each trip log:
 *   - Resolves the active travel order and driver
 *   - Generates a sequential GPS record number
 *   - Validates driver presence (logs without a driver are skipped)
 *   - Maps raw trip status to the gps_trip_logs status enum
 *   - Inserts or updates via ON CONFLICT (gps_record_no)
 *
 * @returns Summary of saved and failed counts.
 */
export async function persistGpsTripLogs(
  tripLogs: TripLogRecord[],
): Promise<{ saved: number; failed: number }> {
  let saved = 0;
  let failed = 0;

  for (const tripLog of tripLogs) {
    try {
      const vehicleId = tripLog.vehicleId;
      if (!vehicleId) {
        failed += 1;
        continue;
      }

      // Resolve date-matched travel order and driver in parallel.
      // A current GPS trip must not inherit an old ACTIVE/APPROVED TO
      // whose schedule does not include this trip date.
      const [travelOrder, directDriverId] = await Promise.all([
        findTravelOrderForGpsTrip(
          vehicleId,
          tripLog.tripDate,
          tripLog.departureTimeGps,
          tripLog.arrivalTimeGps,
          tripLog.coordinatesDestination ?? null,
        ),
        tripLog.driverName ? findDriverByName(tripLog.driverName) : Promise.resolve(null),
      ]);
      const driverId = travelOrder?.driver_id ?? directDriverId ?? null;
      const travelOrderId = travelOrder?.id ?? null;
      const toStatusAuto = travelOrder?.status ?? null;

      // ── HARD REJECTION: Must have valid departure and arrival times ──
      // For trips with no matched Travel Order (anomaly), we still save them
      // even if departure/arrival times are identical or missing one side.
      if (travelOrderId) {
        if (!tripLog.departureTimeGps || !tripLog.arrivalTimeGps || tripLog.departureTimeGps === tripLog.arrivalTimeGps) {
          failed += 1;
          continue;
        }

        // ── HARD REJECTION: Must have valid coordinates when distance > 0 ──
        if (Number(tripLog.gpsDistanceKm) > 0 && (!tripLog.coordinatesOrigin || !tripLog.coordinatesDestination)) {
          failed += 1;
          continue;
        }
      }

      const resolvedDriverId = driverId || null;

      // ── Clamp numeric fields ──────────────────────────────
      const clampedGpsDistanceKm = clampNumeric(Number(tripLog.gpsDistanceKm) || 0, 99999999.99);
      const clampedEngineHours = clampNumeric(Number(tripLog.engineHours) || 0, 999999.99);
      const clampedMaxSpeedKph = clampNumeric(Number(tripLog.maxSpeedKph) || 0, 9999.99);

      // Map raw trip status to gps_trip_logs enum
      const validStatuses = ['departed', 'en-route', 'arrived', 'cancelled', 'completed'];
      let tripStatusGps = 'en-route';
      if (tripLog.tripStatus === 'Moving') tripStatusGps = 'en-route';
      else if (tripLog.tripStatus === 'Parked') tripStatusGps = 'arrived';
      else if (tripLog.tripStatus === 'Idling') tripStatusGps = 'en-route';
      if (!validStatuses.includes(tripStatusGps)) tripStatusGps = 'en-route';

      // ── Anomaly Detection ─────────────────────────────────
      const noTravelOrder = !travelOrderId;
      const unauthorizedMovement =
        noTravelOrder && (tripLog.tripStatus === 'Moving' || tripLog.tripStatus === 'Idling');
      const noDriverAssigned = !resolvedDriverId;
      const anomalyFlag = tripLog.anomalyFlag || noTravelOrder || unauthorizedMovement || noDriverAssigned;

      const anomalyNotes: string[] = [];
      if (noDriverAssigned) {
        anomalyNotes.push('No driver assigned to this vehicle');
      }
      if (tripLog.anomalyFlag && tripLog.anomalyFlag === true) {
        if (tripLog.maxSpeedKph > 120) anomalyNotes.push('Speeding detected');
        if (tripLog.anomalyFlag && !anomalyNotes.length) anomalyNotes.push('Anomalous activity detected');
      }
      const notesRemarks = anomalyNotes.length > 0 ? anomalyNotes.join('; ') : null;

      // For trips with no matched Travel Order, set toStatusAuto to 'NO TO'
      const resolvedToStatusAuto = noTravelOrder ? 'NO TO' : toStatusAuto;

      // ── Ongoing Trip Tracking ─────────────────────────────
      // One row per trip: START creates the row, ONGOING updates it, END finalizes it.
      const ongoingTrip = await findOngoingTripLogSync(vehicleId, tripLog.tripDate);
      const hasDeparture = Boolean(tripLog.departureTimeGps);
      const hasArrival = Boolean(tripLog.arrivalTimeGps);

      if (ongoingTrip) {
        if (hasArrival) {
          // Trip is ending — update the existing row with arrival time, destination, final stats
          await updateGpsTripLog(ongoingTrip.id, {
            arrivalTimeGps: tripLog.arrivalTimeGps,
            destinationGpsEndPoint: tripLog.destinationGpsEndPoint || undefined,
            gpsDistanceKm: clampedGpsDistanceKm,
            engineHours: clampedEngineHours,
            maxSpeedKph: clampedMaxSpeedKph,
            tripStatusGps,
            anomalyFlag,
            notesRemarks,
            travelOrderId,
            toStatusAuto: resolvedToStatusAuto,
          });
          saved += 1;
          continue;
        } else if (hasDeparture) {
          // Trip is still ongoing — update live stats but preserve original departure & origin
          await updateGpsTripLog(ongoingTrip.id, {
            gpsDistanceKm: clampedGpsDistanceKm,
            engineHours: clampedEngineHours,
            maxSpeedKph: clampedMaxSpeedKph,
            tripStatusGps,
            anomalyFlag,
            notesRemarks,
            travelOrderId,
            toStatusAuto: resolvedToStatusAuto,
          });
          saved += 1;
          continue;
        }
      }

      // No ongoing trip to update — only create a new row if we have a departure time
      if (!hasDeparture && !hasArrival) {
        // Vehicle is off/parked; skip (departure time required per the filter)
        failed += 1;
        continue;
      }

      const gpsRecordNo = await generateGpsRecordNo(tripLog.departureTimeGps);

      await saveGpsTripLog({
        gpsRecordNo,
        tripDate: tripLog.tripDate,
        vehicleId,
        driverId: resolvedDriverId,
        originGpsStartPoint: tripLog.originGpsStartPoint || '',
        destinationGpsEndPoint: tripLog.destinationGpsEndPoint || '',
        coordinatesOrigin: tripLog.coordinatesOrigin || null,
        coordinatesDestination: tripLog.coordinatesDestination || null,
        actualRouteRoadTaken: tripLog.actualRouteRoadTaken || '',
        departureTimeGps: tripLog.departureTimeGps || null,
        arrivalTimeGps: tripLog.arrivalTimeGps || null,
        gpsDistanceKm: clampedGpsDistanceKm,
        engineHours: clampedEngineHours,
        maxSpeedKph: clampedMaxSpeedKph,
        tripStatusGps,
        travelOrderId,
        toStatusAuto: resolvedToStatusAuto,
        anomalyFlag,
        notesRemarks,
        destinationVerified: false,
        tripType: 'OUTBOUND',
        parentTripId: null,
      });

      saved += 1;
    } catch (logError) {
      console.error('persistGpsTripLogs: Error for vehicle', tripLog.plateNumber, ':', (logError as Error).message);
      failed += 1;
    }
  }

  return { saved, failed };
}

/**
 * Synchronous version of findOngoingTripLog for use within persistGpsTripLogs
 * to avoid await-in-loop issues.
 */
async function findOngoingTripLogSync(vehicleId: string, tripDate: string): Promise<{ id: string } | null> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `SELECT id
       FROM gps_trip_logs
      WHERE vehicle_id = $1
        AND trip_date = $2
        AND arrival_time_gps IS NULL
        AND departure_time_gps IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [vehicleId, tripDate],
  );
  return result.rows[0] ?? null;
}

// ── Telemetry-to-Trip-Log Sync ────────────────────────────────

interface TelemetryGroup {
  vehicleId: string;
  plateNumber: string;
  activeTripId: string | null;
  tripDate: string;
  departureTimeGps: string | null;
  arrivalTimeGps: string | null;
  originGpsStartPoint: string;
  destinationGpsEndPoint: string;
  coordinatesOrigin: string | null;
  coordinatesDestination: string | null;
  gpsDistanceKm: number;
  engineHours: number;
  maxSpeedKph: number;
  tripStatusGps: string;
  driverName: string | null;
  toNumber: string | null;
  anomalyFlag: boolean;
  notesRemarks: string | null;
  pointCount: number;
}

type TelemetryRow = {
  id?: string | null;
  vehicle_id: string | null;
  plate_number: string | null;
  event_type: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  speed_kmh: number | string | null;
  location_name: string | null;
  recorded_at: string | Date | null;
  active_trip_id: string | null;
  active_driver_id?: string | null;
  driver_id?: string | null;
  active_to_status?: string | null;
  active_to_number?: string | null;
};

type GpsTripStatus = 'EN ROUTE' | 'ARRIVED' | 'COMPLETED';

type TelemetryTripLogRow = {
  id: string;
  vehicle_id: string;
  driver_id: string | null;
  active_trip_id: string | null;
  trip_date: string;
  origin_gps_start_point: string | null;
  destination_gps_end_point: string | null;
  coordinates_origin: string | null;
  coordinates_destination: string | null;
  departure_time_gps: string | Date | null;
  arrival_time_gps: string | Date | null;
  trip_status_gps: string | null;
  trip_type: 'OUTBOUND' | 'RETURN';
  parent_trip_id: string | null;
  travel_order_id: string | null;
  to_status_auto: string | null;
  pending_return_detection: boolean | null;
  motion_started_at: string | Date | null;
};

function normalizeStopLocationName(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').replace(/,+$/g, '').trim().toLowerCase();
}

function normalizeTelemetryEvent(eventType: string | null | undefined): string {
  return String(eventType ?? '').trim().toUpperCase().replace(/\s+ALERT$/, '').replace(/\s+/g, '_');
}

function timestampToIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function tripDateFromTimestamp(value: string | Date | null | undefined): string {
  const iso = timestampToIso(value);
  return iso ? iso.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function coordinatesFromTelemetry(row: TelemetryRow | null | undefined): string | null {
  if (!row || row.latitude == null || row.longitude == null) return null;
  const lat = Number(row.latitude);
  const lng = Number(row.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? `${lat},${lng}` : null;
}

function calculateRouteDistanceKm(points: TelemetryRow[]): number {
  let meters = 0;
  let previousCoord: string | null = null;

  for (const point of points) {
    const coord = coordinatesFromTelemetry(point);
    if (!coord) continue;
    if (previousCoord) {
      const segment = haversineDistance(previousCoord, coord);
      if (Number.isFinite(segment)) meters += segment;
    }
    previousCoord = coord;
  }

  return meters / 1000;
}

async function findExistingTelemetryTripLog(params: {
  vehicleId: string;
  tripDate: string;
  departureTimeGps: string;
  arrivalTimeGps: string | null;
  activeTripId: string | null;
  tripType: 'OUTBOUND' | 'RETURN';
}): Promise<{ id: string } | null> {
  const pool = getPool();

  // Primary upsert key: one OUTBOUND and one RETURN are allowed per active trip.
  if (params.activeTripId) {
    const existing = await pool.query<{ id: string }>(
      `SELECT id
         FROM gps_trip_logs
        WHERE vehicle_id = $1
          AND active_trip_id = $2
          AND trip_type = $3
        LIMIT 1`,
      [params.vehicleId, params.activeTripId, params.tripType],
    );
    if (existing.rows[0]) return existing.rows[0];
  }

  // Fallback: vehicle_id + departure_time_gps + arrival_time_gps
  // (for cases where active_trip_id is null)
  if (params.departureTimeGps) {
    const existing = await pool.query<{ id: string }>(
      `SELECT id
         FROM gps_trip_logs
        WHERE vehicle_id = $1
          AND trip_date = $2::date
          AND departure_time_gps IS NOT DISTINCT FROM $3::timestamptz
          AND arrival_time_gps IS NOT DISTINCT FROM $4::timestamptz
          AND active_trip_id IS NULL
          AND trip_type = $5
        ORDER BY created_at DESC
        LIMIT 1`,
      [params.vehicleId, params.tripDate, params.departureTimeGps, params.arrivalTimeGps, params.tripType],
    );
    if (existing.rows[0]) return existing.rows[0];
  }

  return null;
}

async function pairReturnTrip(returnLogId: string, vehicleId: string, departureTimeGps: string | null): Promise<boolean> {
  if (!departureTimeGps) {
    console.log('[MISSION] Skipping outbound search because return trip has no departure_time_gps');
    return false;
  }

  console.log('[MISSION] Searching outbound...', { vehicleId, returnLogId, departureTimeGps });
  const pool = getPool();
  const candidate = await pool.query<{ id: string }>(
    `SELECT id
       FROM gps_trip_logs
      WHERE vehicle_id = $1
        AND trip_type = 'OUTBOUND'
        AND parent_trip_id IS NULL
        AND departure_time_gps IS NOT NULL
        AND departure_time_gps < $2::timestamptz
      ORDER BY departure_time_gps DESC
      LIMIT 1`,
    [vehicleId, departureTimeGps],
  );

  if (!candidate.rows[0]) {
    console.log('[MISSION] No outbound found');
    return false;
  }

  const outboundId = candidate.rows[0].id;
  const updateResult = await pool.query(
    `UPDATE gps_trip_logs
        SET parent_trip_id = $1
      WHERE id = $2
        AND parent_trip_id IS NULL`,
    [outboundId, returnLogId],
  );

  if (updateResult.rowCount === 0) {
    console.log('[MISSION] Outbound found but return already paired or skipped');
    return false;
  }

  console.log('[MISSION] Matched outbound', outboundId);
  console.log('[MISSION] Mission paired');
  return true;
}

async function upsertTelemetryTripLog(params: {
  vehicleId: string;
  driverId: string | null;
  activeTripId: string | null;
  tripDate: string;
  originGpsStartPoint: string;
  destinationGpsEndPoint: string;
  coordinatesOrigin: string | null;
  coordinatesDestination: string | null;
  departureTimeGps: string;
  arrivalTimeGps: string | null;
  gpsDistanceKm: number;
  engineHours: number;
  maxSpeedKph: number;
  tripStatusGps: string;
  travelOrderId: string | null;
  toStatusAuto: string | null;
  anomalyFlag: boolean;
  notesRemarks: string | null;
  tripType: 'OUTBOUND' | 'RETURN';
  parentTripId?: string | null;
  destinationVerified?: boolean;
  pendingReturnDetection?: boolean;
  motionStartedAt?: string | null;
  returnDetectedAt?: string | null;
}): Promise<{ status: 'created' | 'updated'; id: string }> {
  const pool = getPool();
  const existingLog = await findExistingTelemetryTripLog(params);

  if (existingLog) {
    const result = await pool.query<{ id: string }>(
      `UPDATE gps_trip_logs
          SET driver_id = $2,
              origin_gps_start_point = $3,
              destination_gps_end_point = $4,
              coordinates_origin = $5,
              coordinates_destination = $6,
              departure_time_gps = $7,
              arrival_time_gps = $8,
              gps_distance_km = $9,
              engine_hours = $10,
              max_speed_kph = $11,
              trip_status_gps = $12,
              travel_order_id = COALESCE($13, travel_order_id),
              to_status_auto = COALESCE($14, to_status_auto),
              anomaly_flag = $15,
              notes_remarks = $16,
              active_trip_id = COALESCE($17, active_trip_id),
              trip_type = $18,
              destination_verified = $19,
              parent_trip_id = COALESCE($20, parent_trip_id),
              pending_return_detection = $21,
              motion_started_at = $22,
              return_detected_at = COALESCE($23, return_detected_at)
        WHERE id = $1
        RETURNING id`,
      [
        existingLog.id,
        params.driverId,
        params.originGpsStartPoint,
        params.destinationGpsEndPoint,
        params.coordinatesOrigin,
        params.coordinatesDestination,
        params.departureTimeGps,
        params.arrivalTimeGps,
        params.gpsDistanceKm,
        params.engineHours,
        params.maxSpeedKph,
        params.tripStatusGps,
        params.travelOrderId,
        params.toStatusAuto,
        params.anomalyFlag,
        params.notesRemarks,
        params.activeTripId,
        params.tripType,
        params.destinationVerified ?? false,
        params.parentTripId ?? null,
        params.pendingReturnDetection ?? false,
        params.motionStartedAt ?? null,
        params.returnDetectedAt ?? null,
      ],
    );
    if (params.tripType === 'RETURN') {
      await pairReturnTrip(result.rows[0].id, params.vehicleId, params.departureTimeGps);
    }
    return { status: 'updated', id: result.rows[0].id };
  }

  const gpsRecordNo = await generateGpsRecordNo(params.departureTimeGps);
  const insertResult = await pool.query<{ id: string }>(
    `INSERT INTO gps_trip_logs
       (gps_record_no, trip_date, vehicle_id, driver_id,
        origin_gps_start_point, destination_gps_end_point,
        coordinates_origin, coordinates_destination,
        actual_route_road_taken, departure_time_gps, arrival_time_gps,
        gps_distance_km, engine_hours, max_speed_kph,
        trip_status_gps, travel_order_id, to_status_auto,
        anomaly_flag, notes_remarks, active_trip_id, trip_type,
        destination_verified, parent_trip_id, pending_return_detection,
        motion_started_at, return_detected_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
     RETURNING id`,
    [
      gpsRecordNo,
      params.tripDate,
      params.vehicleId,
      params.driverId,
      params.originGpsStartPoint,
      params.destinationGpsEndPoint,
      params.coordinatesOrigin,
      params.coordinatesDestination,
      '',
      params.departureTimeGps,
      params.arrivalTimeGps,
      params.gpsDistanceKm,
      params.engineHours,
      params.maxSpeedKph,
      params.tripStatusGps,
      params.travelOrderId,
      params.toStatusAuto,
      params.anomalyFlag,
      params.notesRemarks,
      params.activeTripId,
      params.tripType,
      params.destinationVerified ?? false,
      params.parentTripId ?? null,
      params.pendingReturnDetection ?? false,
      params.motionStartedAt ?? null,
      params.returnDetectedAt ?? null,
    ],
  );
  if (params.tripType === 'RETURN') {
    await pairReturnTrip(insertResult.rows[0].id, params.vehicleId, params.departureTimeGps);
  }
  return { status: 'created', id: insertResult.rows[0].id };
}

async function determineTripType(params: {
  coordinatesOrigin: string | null;
}): Promise<'OUTBOUND' | 'RETURN'> {
  if (!params.coordinatesOrigin) return 'OUTBOUND';

  // Check if the trip started near the default depot/base location.
  // A trip originating at the base is classified as OUTBOUND (leaving the depot).
  // A trip ending at the base is classified as RETURN (coming back to the depot).
  const defaultCoord = `${DEFAULT_ORIGIN.latitude},${DEFAULT_ORIGIN.longitude}`;
  const distanceFromBase = haversineDistance(defaultCoord, params.coordinatesOrigin);
  const startsNearHome = distanceFromBase <= DEFAULT_BASE_RADIUS_METERS;

  return startsNearHome ? 'OUTBOUND' : 'RETURN';
}

/**
 * Sync GPS trip logs from gps_telemetry records.
 *
 * Reads telemetry records ordered by vehicle and recorded_at, walks each
 * vehicle's ignition sequence, and upserts one gps_trip_logs row per real trip.
 *
 * @returns Summary of created, updated, skipped, and failed counts.
 */
export async function syncGpsTripLogsFromTelemetry(): Promise<{
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}> {
  const pool = getPool();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  let rows: any[];
  try {
    const result = await pool.query(
      `SELECT
        gt.*,
        to_data.to_number AS active_to_number,
        to_data.status AS active_to_status,
        d.full_name AS active_driver_name,
        to_data.driver_id AS active_driver_id
      FROM gps_telemetry gt
      LEFT JOIN LATERAL (
        SELECT to_number, status, driver_id
        FROM travel_orders
        WHERE vehicle_id = gt.vehicle_id
          AND status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
          AND DATE(scheduled_departure) = DATE(gt.recorded_at)
        ORDER BY created_at DESC
        LIMIT 1
      ) to_data ON true
      LEFT JOIN drivers d ON d.id = to_data.driver_id
      WHERE gt.recorded_at IS NOT NULL
      ORDER BY gt.vehicle_id, gt.recorded_at ASC`,
    );
    rows = result.rows;
  } catch (err) {
    console.error('[syncGpsTripLogsFromTelemetry] Query failed:', (err as Error).message);
    return { created: 0, updated: 0, skipped: 0, failed: 0 };
  }

  if (rows.length === 0) {
    return { created: 0, updated: 0, skipped: 0, failed: 0 };
  }

  const rowsByVehicle = new Map<string, TelemetryRow[]>();
  for (const row of rows) {
    if (!row.vehicle_id) {
      skipped += 1;
      continue;
    }
    if (!rowsByVehicle.has(row.vehicle_id)) {
      rowsByVehicle.set(row.vehicle_id, []);
    }
    rowsByVehicle.get(row.vehicle_id)!.push(row);
  }

  console.log(`[GPS TRIP] Telemetry rows=${rows.length} vehicle_streams=${rowsByVehicle.size}`);

  const fleetConfig = getFleetConfig();
  const defaultOriginCoord = `${fleetConfig.base.latitude},${fleetConfig.base.longitude}`;

  const countResult = (result: { status: 'created' | 'updated' }) => {
    if (result.status === 'created') created += 1;
    else updated += 1;
  };

  const getTripLog = async (
    vehicleId: string,
    activeTripId: string | null,
    tripType: 'OUTBOUND' | 'RETURN',
  ): Promise<TelemetryTripLogRow | null> => {
    if (!activeTripId) return null;
    const result = await pool.query<TelemetryTripLogRow>(
      `SELECT id, vehicle_id, driver_id, active_trip_id, trip_date,
              origin_gps_start_point, destination_gps_end_point,
              coordinates_origin, coordinates_destination,
              departure_time_gps, arrival_time_gps, trip_status_gps,
              trip_type, parent_trip_id, travel_order_id, to_status_auto,
              pending_return_detection, motion_started_at
         FROM gps_trip_logs
        WHERE vehicle_id = $1
          AND active_trip_id = $2
          AND trip_type = $3
        LIMIT 1`,
      [vehicleId, activeTripId, tripType],
    );
    return result.rows[0] ?? null;
  };

  const telemetryPoints = async (
    vehicleId: string,
    activeTripId: string | null,
    fromTime: string | null,
    toTime: string | null,
  ): Promise<TelemetryRow[]> => {
    if (!activeTripId) return [];
    const result = await pool.query<TelemetryRow>(
      `SELECT vehicle_id, plate_number, event_type, latitude, longitude,
              speed_kmh, location_name, recorded_at, active_trip_id
         FROM gps_telemetry
        WHERE vehicle_id = $1
          AND active_trip_id = $2
          AND ($3::timestamptz IS NULL OR recorded_at >= $3::timestamptz)
          AND ($4::timestamptz IS NULL OR recorded_at <= $4::timestamptz)
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
        ORDER BY recorded_at ASC`,
      [vehicleId, activeTripId, fromTime, toTime],
    );
    return result.rows;
  };

  const updateTripMetrics = async (
    id: string,
    vehicleId: string,
    activeTripId: string | null,
    fromTime: string | null,
    toTime: string | null,
  ) => {
    const points = await telemetryPoints(vehicleId, activeTripId, fromTime, toTime);
    const gpsDistanceKm = calculateRouteDistanceKm(points);
    const maxSpeedKph = points.reduce((max, point) => Math.max(max, Number(point.speed_kmh) || 0), 0);
    const startMs = fromTime ? new Date(fromTime).getTime() : NaN;
    const endMs = (toTime ?? points[points.length - 1]?.recorded_at) ? new Date(String(toTime ?? points[points.length - 1]?.recorded_at)).getTime() : NaN;
    const engineHours = Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, (endMs - startMs) / 3600000) : 0;
    await pool.query(
      `UPDATE gps_trip_logs
          SET gps_distance_km = $2,
              max_speed_kph = $3,
              engine_hours = $4
        WHERE id = $1`,
      [id, gpsDistanceKm, maxSpeedKph, engineHours],
    );
  };

  const insertTripStop = async (
    tripLog: TelemetryTripLogRow,
    row: TelemetryRow,
  ): Promise<{ inserted: boolean; stopOrder: number | null }> => {
    const locationName = String(row.location_name ?? '').trim();
    if (!locationName) {
      console.log('[gps-trip-stop] skipped missing location', { gpsTripLogId: tripLog.id });
      return { inserted: false, stopOrder: null };
    }

    const latestStop = await pool.query<{ stop_order: number; location_name: string }>(
      `SELECT stop_order, location_name
         FROM gps_trip_log_stops
        WHERE gps_trip_log_id = $1
        ORDER BY stop_order DESC
        LIMIT 1`,
      [tripLog.id],
    );
    const latest = latestStop.rows[0];
    if (latest && normalizeStopLocationName(latest.location_name) === normalizeStopLocationName(locationName)) {
      console.log('[gps-trip-stop] skipped duplicate same location', { gpsTripLogId: tripLog.id, locationName });
      return { inserted: false, stopOrder: latest.stop_order };
    }

    const nextStopOrder = (latest?.stop_order ?? 0) + 1;
    const latitude = row.latitude == null ? null : Number(row.latitude);
    const longitude = row.longitude == null ? null : Number(row.longitude);
    const coordinates = coordinatesFromTelemetry(row);
    const arrivedAt = timestampToIso(row.recorded_at);
    if (!arrivedAt) {
      console.log('[gps-trip-stop] skipped missing arrived_at', { gpsTripLogId: tripLog.id });
      return { inserted: false, stopOrder: null };
    }

    await pool.query(
      `INSERT INTO gps_trip_log_stops
         (gps_trip_log_id, active_trip_id, vehicle_id, stop_order,
          location_name, coordinates, latitude, longitude, arrived_at,
          idle_minutes, telemetry_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (gps_trip_log_id, stop_order) DO NOTHING`,
      [
        tripLog.id,
        tripLog.active_trip_id,
        tripLog.vehicle_id,
        nextStopOrder,
        locationName,
        coordinates,
        Number.isFinite(latitude) ? latitude : null,
        Number.isFinite(longitude) ? longitude : null,
        arrivedAt,
        null,
        row.id ?? null,
      ],
    );

    console.log(`[gps-trip-stop] inserted stop_order=${nextStopOrder}`, {
      gpsTripLogId: tripLog.id,
      activeTripId: tripLog.active_trip_id,
      locationName,
    });
    return { inserted: true, stopOrder: nextStopOrder };
  };

  for (const [vehicleId, telemetryRows] of rowsByVehicle) {
    for (const row of telemetryRows) {
      try {
        const eventType = normalizeTelemetryEvent(row.event_type);
        const activeTripId = row.active_trip_id ?? null;
        const recordedAt = timestampToIso(row.recorded_at);
        if (!activeTripId || !recordedAt) {
          skipped += 1;
          continue;
        }

        // Inherit travel_order_id and driver_id from telemetry (telemetry-first)
        const inheritedTravelOrderId = row.active_to_number ? (row as any).travel_order_id ?? null : null;
        const inheritedDriverId = row.active_driver_id ?? row.driver_id ?? null;

        if (eventType === 'IGNITION_ON') {
          const result = await upsertTelemetryTripLog({
            vehicleId,
            driverId: inheritedDriverId,
            activeTripId,
            tripDate: tripDateFromTimestamp(row.recorded_at),
            originGpsStartPoint: row.location_name || '',
            destinationGpsEndPoint: row.location_name || '',
            coordinatesOrigin: coordinatesFromTelemetry(row),
            coordinatesDestination: coordinatesFromTelemetry(row),
            departureTimeGps: recordedAt,
            arrivalTimeGps: null,
            gpsDistanceKm: 0,
            engineHours: 0,
            maxSpeedKph: Number(row.speed_kmh) || 0,
            tripStatusGps: 'EN ROUTE',
            travelOrderId: inheritedTravelOrderId,
            toStatusAuto: inheritedTravelOrderId ? 'MATCHED' : 'UNMATCHED',
            anomalyFlag: !inheritedTravelOrderId,
            notesRemarks: null,
            tripType: 'OUTBOUND',
            destinationVerified: false,
            pendingReturnDetection: false,
            motionStartedAt: null,
            returnDetectedAt: null,
          });
          countResult(result);
          console.log('[gps-trip-log] opened outbound', { vehicleId, activeTripId, status: result.status });
          continue;
        }

        const outbound = await getTripLog(vehicleId, activeTripId, 'OUTBOUND');
        if (!outbound) {
          skipped += 1;
          continue;
        }

        if (eventType === 'LOCATION_UPDATE') {
          const returnTrip = await getTripLog(vehicleId, activeTripId, 'RETURN');
          const currentCoord = coordinatesFromTelemetry(row);

          if (outbound.pending_return_detection && outbound.motion_started_at && !returnTrip) {
            const distanceAtArrival = haversineDistance(outbound.coordinates_destination, outbound.coordinates_origin);
            const distanceNow = haversineDistance(currentCoord, outbound.coordinates_origin);
            console.log(`[return-detection] distance_at_arrival=${Number.isFinite(distanceAtArrival) ? distanceAtArrival.toFixed(2) : 'Infinity'}`);
            console.log(`[return-detection] distance_now=${Number.isFinite(distanceNow) ? distanceNow.toFixed(2) : 'Infinity'}`);

            if (
              Number.isFinite(distanceAtArrival) &&
              Number.isFinite(distanceNow) &&
              distanceNow < distanceAtArrival - fleetConfig.trip.returnDirectionMarginMeters
            ) {
                const result = await upsertTelemetryTripLog({
                  vehicleId,
                  driverId: outbound.driver_id,
                  activeTripId,
                  tripDate: tripDateFromTimestamp(outbound.motion_started_at),
                  originGpsStartPoint: outbound.destination_gps_end_point || '',
                  destinationGpsEndPoint: fleetConfig.base.address,
                  coordinatesOrigin: outbound.coordinates_destination,
                  coordinatesDestination: defaultOriginCoord,
                  departureTimeGps: timestampToIso(outbound.motion_started_at) ?? recordedAt,
                  arrivalTimeGps: recordedAt,
                  gpsDistanceKm: 0,
                  engineHours: 0,
                  maxSpeedKph: Number(row.speed_kmh) || 0,
                  tripStatusGps: 'EN ROUTE',
                  travelOrderId: outbound.travel_order_id,
                  toStatusAuto: outbound.travel_order_id ? 'MATCHED' : 'UNMATCHED',
                  anomalyFlag: !outbound.travel_order_id,
                  notesRemarks: null,
                  tripType: 'RETURN',
                  parentTripId: outbound.id,
                  destinationVerified: false,
                  pendingReturnDetection: false,
                  motionStartedAt: null,
                  returnDetectedAt: recordedAt,
                });
              countResult(result);
              await pool.query(
                `UPDATE gps_trip_logs
                    SET pending_return_detection = FALSE
                  WHERE id = $1`,
                [outbound.id],
              );
              await updateTripMetrics(result.id, vehicleId, activeTripId, timestampToIso(outbound.motion_started_at), recordedAt);
              console.log('[return-detection] action=RETURN', { vehicleId, activeTripId });
              console.log('[gps-trip-log] opened return', { vehicleId, activeTripId, status: result.status });
              continue;
            }

            await pool.query(
              `UPDATE gps_trip_logs
                  SET destination_gps_end_point = $2,
                      coordinates_destination = $3,
                      arrival_time_gps = $4,
                      trip_status_gps = 'EN ROUTE',
                      pending_return_detection = FALSE,
                      motion_started_at = NULL
                WHERE id = $1`,
              [outbound.id, row.location_name || outbound.destination_gps_end_point || '', currentCoord, recordedAt],
            );
            await updateTripMetrics(outbound.id, vehicleId, activeTripId, timestampToIso(outbound.departure_time_gps), recordedAt);
            console.log('[return-detection] action=OUTBOUND_CONTINUED', { vehicleId, activeTripId });
            console.log('[return-detection] outbound continued, waiting for future stops', { vehicleId, activeTripId });
            continue;
          }

          const activeLog = returnTrip ?? outbound;
          const startTime = timestampToIso(activeLog.departure_time_gps);
          await pool.query(
            `UPDATE gps_trip_logs
                SET destination_gps_end_point = $2,
                    coordinates_destination = $3,
                    arrival_time_gps = $4,
                    trip_status_gps = 'EN ROUTE'
              WHERE id = $1`,
            [activeLog.id, row.location_name || activeLog.destination_gps_end_point || '', currentCoord, recordedAt],
          );
          await updateTripMetrics(activeLog.id, vehicleId, activeTripId, startTime, recordedAt);
          console.log('[gps-trip-log] updated en route', { vehicleId, activeTripId, tripType: activeLog.trip_type });
          continue;
        }

        if (eventType === 'IDLING_TOO_LONG') {
          const currentCoord = coordinatesFromTelemetry(row);
          await insertTripStop(outbound, row);
          await pool.query(
            `UPDATE gps_trip_logs
            SET destination_gps_end_point = $2,
                coordinates_destination = $3,
                arrival_time_gps = $4,
                trip_status_gps = 'ARRIVED',
                destination_verified = FALSE,
                to_status_auto = COALESCE(to_status_auto, 'UNMATCHED'),
                pending_return_detection = TRUE,
                motion_started_at = NULL
              WHERE id = $1`,
            [outbound.id, row.location_name || outbound.destination_gps_end_point || '', currentCoord, recordedAt],
          );
          await updateTripMetrics(outbound.id, vehicleId, activeTripId, timestampToIso(outbound.departure_time_gps), recordedAt);
          console.log('[gps-trip-log] arrived at stop', { vehicleId, activeTripId });
          continue;
        }

        if (eventType === 'MOTION_STARTED') {
          await pool.query(
            `UPDATE gps_trip_logs
                SET pending_return_detection = TRUE,
                    motion_started_at = $2
              WHERE id = $1`,
            [outbound.id, recordedAt],
          );
          console.log('[return-detection] pending after motion started', { vehicleId, activeTripId });
          continue;
        }

        if (eventType === 'IGNITION_OFF') {
          const returnTrip = await getTripLog(vehicleId, activeTripId, 'RETURN');
          const activeLog = returnTrip ?? outbound;
          const currentCoord = coordinatesFromTelemetry(row) ?? activeLog.coordinates_destination;
          const destinationVerified =
            activeLog.trip_type === 'RETURN' &&
            isCoordinateClose(currentCoord, defaultOriginCoord, fleetConfig.arrival.radiusMeters);
          await pool.query(
            `UPDATE gps_trip_logs
                SET destination_gps_end_point = $2,
                    coordinates_destination = $3,
                    arrival_time_gps = $4,
                    trip_status_gps = 'COMPLETED',
                    destination_verified = $5,
                    pending_return_detection = FALSE,
                    motion_started_at = NULL
              WHERE id = $1`,
            [
              activeLog.id,
              row.location_name || activeLog.destination_gps_end_point || '',
              currentCoord,
              recordedAt,
              destinationVerified,
            ],
          );
          await updateTripMetrics(activeLog.id, vehicleId, activeTripId, timestampToIso(activeLog.departure_time_gps), recordedAt);
          console.log('[gps-trip-log] completed', { vehicleId, activeTripId, tripType: activeLog.trip_type });
        }
      } catch (rowErr) {
        console.error('[syncGpsTripLogsFromTelemetry] Error processing telemetry row:', (rowErr as Error).message);
        failed += 1;
      }
    }
  }

  console.log(`[syncGpsTripLogsFromTelemetry] Done: ${created} created, ${updated} updated, ${skipped} skipped, ${failed} failed`);
  return { created, updated, skipped, failed };
}

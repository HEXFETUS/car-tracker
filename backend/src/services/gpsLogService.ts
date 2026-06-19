// ── GPS Trip Log Service ──────────────────────────────────────
//
// Database persistence layer for automated GPS trip log ingestion.
// Called by the cron sync pipeline after each fleet telemetry cycle.

import { getPool } from '../db/db.js';
import { createGpsAlert, getVehiclePlate } from './gpsAlertService.js';

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
  locationName?: string | null;
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
            to_number, location_name
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
export function matchTravelOrderToGpsTrip(
  gpsDepartureTime: string | null,
  gpsArrivalTime: string | null,
  gpsDestinationCoord: string | null,
  candidates: TravelOrderWithTimes[],
): TravelOrderWithTimes | null {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // If we have no GPS timestamps and no coordinates, fall back to the first candidate
  if (!gpsDepartureTime && !gpsArrivalTime && !gpsDestinationCoord) return candidates[0];

  const gpsDepMs = gpsDepartureTime ? new Date(gpsDepartureTime).getTime() : null;
  const gpsArrMs = gpsArrivalTime ? new Date(gpsArrivalTime).getTime() : null;

  // First pass: look for a TO whose scheduled range fully contains the GPS trip
  // AND has matching destination coordinates
  for (const to of candidates) {
    const toDepMs = to.scheduled_departure ? new Date(to.scheduled_departure).getTime() : null;
    const toArrMs = to.scheduled_arrival ? new Date(to.scheduled_arrival).getTime() : null;

    // Time-based containment check
    const timeMatches = (() => {
      if (toDepMs !== null && toArrMs !== null && gpsDepMs !== null && gpsArrMs !== null) {
        return gpsDepMs >= toDepMs && gpsArrMs <= toArrMs;
      }
      if (toDepMs !== null && gpsDepMs !== null && toArrMs === null) {
        const diffMs = Math.abs(gpsDepMs - toDepMs);
        return diffMs <= 2 * 60 * 60 * 1000; // within 2 hours
      }
      return false;
    })();

    // Coordinate-based match check
    const coordMatches = gpsDestinationCoord && to.lat_long_destination
      ? haversineDistance(gpsDestinationCoord, to.lat_long_destination) <= 200
      : false;

    if (timeMatches && coordMatches) {
      return to;
    }
  }

  // Second pass: coordinate-only match
  if (gpsDestinationCoord) {
    for (const to of candidates) {
      if (to.lat_long_destination) {
        const dist = haversineDistance(gpsDestinationCoord, to.lat_long_destination);
        if (dist <= 200) {
          return to;
        }
      }
    }
  }

  // Third pass: time-only containment or closest departure
  for (const to of candidates) {
    const toDepMs = to.scheduled_departure ? new Date(to.scheduled_departure).getTime() : null;
    const toArrMs = to.scheduled_arrival ? new Date(to.scheduled_arrival).getTime() : null;

    if (toDepMs !== null && toArrMs !== null && gpsDepMs !== null && gpsArrMs !== null) {
      if (gpsDepMs >= toDepMs && gpsArrMs <= toArrMs) {
        return to;
      }
    }
    if (toDepMs !== null && gpsDepMs !== null && toArrMs === null) {
      const diffMs = Math.abs(gpsDepMs - toDepMs);
      if (diffMs <= 2 * 60 * 60 * 1000) {
        return to;
      }
    }
  }

  // Fourth pass: find the TO with closest scheduled departure to GPS departure
  if (gpsDepMs !== null) {
    let bestMatch: TravelOrderWithTimes | null = null;
    let bestDiff = Infinity;

    for (const to of candidates) {
      const toDepMs = to.scheduled_departure ? new Date(to.scheduled_departure).getTime() : null;
      if (toDepMs !== null) {
        const diff = Math.abs(gpsDepMs - toDepMs);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestMatch = to;
        }
      }
    }

    if (bestMatch) return bestMatch;
  }

  // Fallback: return the first candidate
  return candidates[0];
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
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
  const result = await pool.query<{ id: string }>(
    `INSERT INTO gps_trip_logs
       (gps_record_no, trip_date, vehicle_id, driver_id,
        origin_gps_start_point, destination_gps_end_point,
        coordinates_origin, coordinates_destination,
        actual_route_road_taken, departure_time_gps, arrival_time_gps,
        gps_distance_km, engine_hours, max_speed_kph,
        trip_status_gps, travel_order_id, to_status_auto,
        anomaly_flag, notes_remarks,
        destination_verified, trip_type, parent_trip_id, location_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
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
        location_name       = COALESCE(EXCLUDED.location_name, gps_trip_logs.location_name),
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
      logData.tripType ?? 'OUTBOUND',
      logData.parentTripId ?? null,
      logData.locationName ?? null,
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
    locationName?: string | null;
    travelOrderId?: string | null;
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
  if (updates.locationName !== undefined) {
    setClauses.push(`location_name = $${idx++}`);
    values.push(updates.locationName);
  }
  if (updates.travelOrderId !== undefined) {
    setClauses.push(`travel_order_id = $${idx++}`);
    values.push(updates.travelOrderId);
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
 * Generate a GPS record number in the format GPS-{YEAR}-{SEQUENTIAL}
 * by querying the max existing sequence number for the current year.
 */
export async function generateGpsRecordNo(): Promise<string> {
  const pool = getPool();
  const year = new Date().getFullYear();
  const result = await pool.query<{ max_seq: string | null }>(
    `SELECT MAX(CAST(SPLIT_PART(gps_record_no, '-', 3) AS INTEGER)) AS max_seq
       FROM gps_trip_logs
      WHERE gps_record_no LIKE $1`,
    [`GPS-${year}-%`],
  );
  const nextSeq = (parseInt(result.rows[0]?.max_seq || '0', 10)) + 1;
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

      // Resolve travel order and driver in parallel
      const [travelOrder, directDriverId] = await Promise.all([
        findActiveTravelOrder(vehicleId),
        tripLog.driverName ? findDriverByName(tripLog.driverName) : Promise.resolve(null),
      ]);
      const driverId = travelOrder?.driver_id ?? directDriverId ?? null;
      const travelOrderId = travelOrder?.id ?? null;
      const toStatusAuto = travelOrder?.status ?? null;

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
      const unauthorizedMovement =
        !travelOrderId && (tripLog.tripStatus === 'Moving' || tripLog.tripStatus === 'Idling');
      const noDriverAssigned = !resolvedDriverId;
      const anomalyFlag = tripLog.anomalyFlag || unauthorizedMovement || noDriverAssigned;

      const anomalyNotes: string[] = [];
      if (unauthorizedMovement && !tripLog.toNumber) anomalyNotes.push('No travel order linked to this trip');
      if (noDriverAssigned) anomalyNotes.push('No driver assigned to this vehicle');
      if (tripLog.anomalyFlag && tripLog.anomalyFlag === true) {
        if (tripLog.maxSpeedKph > 120) anomalyNotes.push('Speeding detected');
        if (tripLog.anomalyFlag && !anomalyNotes.length) anomalyNotes.push('Anomalous activity detected');
      }
      const notesRemarks = anomalyNotes.length > 0 ? anomalyNotes.join('; ') : null;

      // ── Ongoing Trip Tracking ─────────────────────────────
      // One row per trip: START creates the row, ONGOING updates it, END finalizes it.
      const ongoingTrip = await findOngoingTripLogSync(vehicleId);
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

      const gpsRecordNo = await generateGpsRecordNo();

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
        toStatusAuto,
        anomalyFlag,
        notesRemarks,
        destinationVerified: false,
        tripType: 'OUTBOUND',
        parentTripId: null,
        locationName: null,
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
async function findOngoingTripLogSync(vehicleId: string): Promise<{ id: string } | null> {
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
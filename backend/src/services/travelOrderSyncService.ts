import { getPool } from '../db/db.js';
import { getFleetConfig } from './fleetConfigService.js';
import { haversineDistance } from './gpsLogService.js';

const DEFAULT_DEPARTURE_WINDOW_MS = Number(process.env.TO_SYNC_DEPARTURE_WINDOW_MINUTES ?? 120) * 60 * 1000;
const DEFAULT_RECENT_COMPLETED_WINDOW_MS = Number(process.env.TO_SYNC_RECENT_COMPLETED_MINUTES ?? 30) * 60 * 1000;
const MINIMUM_MATCH_SCORE = Number(process.env.TO_SYNC_MINIMUM_SCORE ?? 80);

export interface TravelOrderSyncRow {
  id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  status: string;
  scheduled_departure: string | null;
  scheduled_arrival: string | null;
  lat_long_destination: string | null;
  to_number: string | null;
}

export interface CandidateTripRow {
  id: string;
  vehicle_id: string;
  driver_id: string | null;
  active_trip_id: string;
  departure_time_gps: string | null;
  arrival_time_gps: string | null;
  coordinates_destination: string | null;
  travel_order_id: string | null;
  to_status_auto: string | null;
  trip_status_gps: string | null;
  latest_latitude: number | null;
  latest_longitude: number | null;
  latest_recorded_at: string | null;
}

export interface ScoredTripCandidate {
  trip: CandidateTripRow;
  travelOrder?: TravelOrderSyncRow;
  score: number;
  departureDeltaMs: number | null;
  reasons: string[];
}

export interface TravelOrderSyncResult {
  linked: boolean;
  reason: string;
  travelOrderId: string | null;
  gpsTripLogId: string | null;
  activeTripId: string | null;
  score: number | null;
  telemetryBackfilled: number;
}

function parseSyncTimestamp(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  let normalized = raw.replace(' ', 'T');
  if (/[+-]\d\d$/.test(normalized)) {
    normalized = `${normalized}:00`;
  } else if (!normalized.endsWith('Z') && !/[+-]\d\d:?\d\d$/.test(normalized)) {
    normalized = `${normalized}+08:00`;
  }
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function logSync(message: string, details?: Record<string, unknown>): void {
  if (details) {
    console.log(`[TO Sync] ${message}`, details);
  } else {
    console.log(`[TO Sync] ${message}`);
  }
}

function coordFromLatestTelemetry(candidate: CandidateTripRow): string | null {
  if (candidate.latest_latitude == null || candidate.latest_longitude == null) return null;
  return `${candidate.latest_latitude},${candidate.latest_longitude}`;
}

export function scoreTravelOrderTripCandidate(
  travelOrder: TravelOrderSyncRow,
  candidate: CandidateTripRow,
  options: { departureWindowMs?: number; destinationRadiusMeters?: number } = {},
): ScoredTripCandidate | null {
  if (!travelOrder.vehicle_id || travelOrder.vehicle_id !== candidate.vehicle_id) return null;
  if (!candidate.active_trip_id) return null;
  if (candidate.travel_order_id && candidate.travel_order_id !== travelOrder.id) return null;
  if (candidate.to_status_auto === 'manual' && candidate.travel_order_id !== travelOrder.id) return null;

  const scheduledDepartureMs = parseSyncTimestamp(travelOrder.scheduled_departure);
  const ignitionOnMs = parseSyncTimestamp(candidate.departure_time_gps);
  if (scheduledDepartureMs === null || ignitionOnMs === null) return null;

  const departureWindowMs = options.departureWindowMs ?? DEFAULT_DEPARTURE_WINDOW_MS;
  const departureDeltaMs = Math.abs(ignitionOnMs - scheduledDepartureMs);
  if (departureDeltaMs > departureWindowMs) return null;

  let score = 50;
  const reasons = ['vehicle'];

  if (travelOrder.driver_id && candidate.driver_id) {
    if (travelOrder.driver_id === candidate.driver_id) {
      score += 25;
      reasons.push('driver');
    } else {
      score -= 20;
      reasons.push('driver_mismatch');
    }
  }

  score += Math.max(0, 40 * (1 - departureDeltaMs / departureWindowMs));
  reasons.push('closest_departure');

  const destinationRadiusMeters = options.destinationRadiusMeters ?? getFleetConfig().trip.coordMatchThresholdM;
  const latestCoord = coordFromLatestTelemetry(candidate);
  const candidateDestination = candidate.coordinates_destination ?? latestCoord;
  if (travelOrder.lat_long_destination && candidateDestination) {
    const distanceM = haversineDistance(travelOrder.lat_long_destination, candidateDestination);
    if (distanceM <= destinationRadiusMeters) {
      score += 25;
      reasons.push('destination');
    }
  }

  if (candidate.arrival_time_gps && travelOrder.scheduled_arrival) {
    const arrivalMs = parseSyncTimestamp(candidate.arrival_time_gps);
    const scheduledArrivalMs = parseSyncTimestamp(travelOrder.scheduled_arrival);
    if (arrivalMs !== null && scheduledArrivalMs !== null && Math.abs(arrivalMs - scheduledArrivalMs) <= departureWindowMs) {
      score += 10;
      reasons.push('arrival');
    }
  }

  return { trip: candidate, travelOrder, score, departureDeltaMs, reasons };
}

export async function syncTravelOrderToActiveTrip(travelOrderId: string): Promise<TravelOrderSyncResult> {
  const pool = getPool();
  const toResult = await pool.query<TravelOrderSyncRow>(
    `SELECT id, vehicle_id, driver_id, status, scheduled_departure, scheduled_arrival,
            lat_long_destination, to_number
       FROM travel_orders
      WHERE id = $1
      LIMIT 1`,
    [travelOrderId],
  );
  const travelOrder = toResult.rows[0];
  if (!travelOrder) {
    return { linked: false, reason: 'travel_order_not_found', travelOrderId, gpsTripLogId: null, activeTripId: null, score: null, telemetryBackfilled: 0 };
  }
  if (String(travelOrder.status).toUpperCase() === 'CANCELLED') {
    return { linked: false, reason: 'cancelled_travel_order', travelOrderId, gpsTripLogId: null, activeTripId: null, score: null, telemetryBackfilled: 0 };
  }
  if (!travelOrder.vehicle_id) {
    return { linked: false, reason: 'missing_vehicle', travelOrderId, gpsTripLogId: null, activeTripId: null, score: null, telemetryBackfilled: 0 };
  }

  const recentCompletedWindowMs = DEFAULT_RECENT_COMPLETED_WINDOW_MS;
  const candidatesResult = await pool.query<CandidateTripRow>(
    `SELECT g.id, g.vehicle_id, g.driver_id, g.active_trip_id,
            g.departure_time_gps, g.arrival_time_gps, g.coordinates_destination,
            g.travel_order_id, g.to_status_auto, g.trip_status_gps,
            latest.latitude AS latest_latitude,
            latest.longitude AS latest_longitude,
            latest.recorded_at AS latest_recorded_at
       FROM gps_trip_logs g
       LEFT JOIN LATERAL (
         SELECT latitude, longitude, recorded_at
           FROM gps_telemetry gt
          WHERE gt.vehicle_id = g.vehicle_id
            AND gt.active_trip_id = g.active_trip_id
          ORDER BY gt.recorded_at DESC
          LIMIT 1
       ) latest ON true
      WHERE g.vehicle_id = $1
        AND g.active_trip_id IS NOT NULL
        AND (g.travel_order_id IS NULL OR g.travel_order_id = $2)
        AND COALESCE(g.to_status_auto, '') <> 'manual'
        AND (
          g.arrival_time_gps IS NULL
          OR g.arrival_time_gps >= NOW() - ($3::text || ' milliseconds')::interval
        )
      ORDER BY g.departure_time_gps DESC
      LIMIT 20`,
    [travelOrder.vehicle_id, travelOrder.id, recentCompletedWindowMs],
  );

  const scored = candidatesResult.rows
    .map((candidate) => scoreTravelOrderTripCandidate(travelOrder, candidate))
    .filter((candidate): candidate is ScoredTripCandidate => candidate !== null)
    .sort((a, b) => b.score - a.score || (a.departureDeltaMs ?? Infinity) - (b.departureDeltaMs ?? Infinity));

  const best = scored[0];
  if (!best || best.score < MINIMUM_MATCH_SCORE) {
    return { linked: false, reason: 'no_confident_candidate', travelOrderId, gpsTripLogId: null, activeTripId: null, score: best?.score ?? null, telemetryBackfilled: 0 };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const backfillResult = await client.query(
      `UPDATE gps_telemetry
          SET travel_order_id = $1,
              driver_id = COALESCE(driver_id, $2)
        WHERE active_trip_id = $3
          AND vehicle_id = $4
          AND travel_order_id IS NULL`,
      [travelOrder.id, travelOrder.driver_id, best.trip.active_trip_id, travelOrder.vehicle_id],
    );
    const updateResult = await client.query<{ id: string; active_trip_id: string }>(
      `UPDATE gps_trip_logs
          SET travel_order_id = $1,
              to_status_auto = 'matched',
              driver_id = COALESCE(driver_id, $2)
        WHERE active_trip_id = $3
          AND vehicle_id = $4
          AND COALESCE(to_status_auto, '') <> 'manual'
          AND (travel_order_id IS NULL OR travel_order_id = $1)
        RETURNING id, active_trip_id`,
      [travelOrder.id, travelOrder.driver_id, best.trip.active_trip_id, travelOrder.vehicle_id],
    );
    const linkedTrip = updateResult.rows[0];
    if (!linkedTrip) {
      await client.query('ROLLBACK');
      return { linked: false, reason: 'candidate_already_claimed', travelOrderId, gpsTripLogId: null, activeTripId: null, score: best.score, telemetryBackfilled: 0 };
    }
    await client.query('COMMIT');

    return {
      linked: true,
      reason: best.reasons.join(','),
      travelOrderId: travelOrder.id,
      gpsTripLogId: linkedTrip.id,
      activeTripId: linkedTrip.active_trip_id,
      score: best.score,
      telemetryBackfilled: backfillResult.rowCount ?? 0,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function evaluateTravelOrderForTrip(
  trip: CandidateTripRow,
  travelOrder: TravelOrderSyncRow,
  options: { departureWindowMs?: number; destinationRadiusMeters?: number } = {},
): ScoredTripCandidate | null {
  const departureWindowMs = options.departureWindowMs ?? DEFAULT_DEPARTURE_WINDOW_MS;
  const destinationRadiusMeters = options.destinationRadiusMeters ?? getFleetConfig().trip.coordMatchThresholdM;
  const reasons: string[] = [];

  const vehicleMatches = Boolean(travelOrder.vehicle_id && travelOrder.vehicle_id === trip.vehicle_id);
  logSync('vehicle match result', {
    gpsTripLogId: trip.id,
    travelOrderId: travelOrder.id,
    tripVehicleId: trip.vehicle_id,
    travelOrderVehicleId: travelOrder.vehicle_id,
    matched: vehicleMatches,
  });
  if (!vehicleMatches) {
    logSync('rejected TO reason=vehicle_mismatch', { gpsTripLogId: trip.id, travelOrderId: travelOrder.id });
    return null;
  }
  reasons.push('vehicle');

  if (travelOrder.driver_id && trip.driver_id) {
    const driverMatches = travelOrder.driver_id === trip.driver_id;
    logSync('driver match result', {
      gpsTripLogId: trip.id,
      travelOrderId: travelOrder.id,
      tripDriverId: trip.driver_id,
      travelOrderDriverId: travelOrder.driver_id,
      matched: driverMatches,
    });
    if (!driverMatches) {
      logSync('rejected TO reason=driver_mismatch', { gpsTripLogId: trip.id, travelOrderId: travelOrder.id });
      return null;
    }
    reasons.push('driver');
  } else {
    logSync('driver match result', {
      gpsTripLogId: trip.id,
      travelOrderId: travelOrder.id,
      tripDriverId: trip.driver_id,
      travelOrderDriverId: travelOrder.driver_id,
      matched: null,
      reason: 'missing_driver_on_one_side',
    });
  }

  const tripDepartureMs = parseSyncTimestamp(trip.departure_time_gps);
  const tripArrivalMs = parseSyncTimestamp(trip.arrival_time_gps);
  const scheduledDepartureMs = parseSyncTimestamp(travelOrder.scheduled_departure);
  const scheduledArrivalMs = parseSyncTimestamp(travelOrder.scheduled_arrival);
  if (tripDepartureMs === null || scheduledDepartureMs === null) {
    logSync('rejected TO reason=missing_departure_timestamp', {
      gpsTripLogId: trip.id,
      travelOrderId: travelOrder.id,
      tripDeparture: trip.departure_time_gps,
      scheduledDeparture: travelOrder.scheduled_departure,
    });
    return null;
  }

  const departureDeltaMs = Math.abs(tripDepartureMs - scheduledDepartureMs);
  const withinDepartureTolerance = departureDeltaMs <= departureWindowMs;
  const effectiveTripArrivalMs = tripArrivalMs ?? tripDepartureMs;
  const effectiveScheduledArrivalMs = scheduledArrivalMs ?? scheduledDepartureMs;
  const overlapsWindow =
    tripDepartureMs <= effectiveScheduledArrivalMs + departureWindowMs &&
    effectiveTripArrivalMs >= scheduledDepartureMs - departureWindowMs;
  logSync('time window result', {
    gpsTripLogId: trip.id,
    travelOrderId: travelOrder.id,
    tripDeparture: trip.departure_time_gps,
    tripArrival: trip.arrival_time_gps,
    scheduledDeparture: travelOrder.scheduled_departure,
    scheduledArrival: travelOrder.scheduled_arrival,
    withinDepartureTolerance,
    overlapsWindow,
  });
  logSync('closest IGNITION_ON comparison', {
    gpsTripLogId: trip.id,
    travelOrderId: travelOrder.id,
    departureDeltaMinutes: Math.round(departureDeltaMs / 60000),
    toleranceMinutes: Math.round(departureWindowMs / 60000),
  });
  if (!withinDepartureTolerance && !overlapsWindow) {
    logSync('rejected TO reason=outside_time_window', { gpsTripLogId: trip.id, travelOrderId: travelOrder.id });
    return null;
  }

  let score = 50;
  if (reasons.includes('driver')) score += 25;
  score += Math.max(0, 40 * (1 - Math.min(departureDeltaMs, departureWindowMs) / departureWindowMs));
  reasons.push('closest_departure');
  if (overlapsWindow) {
    score += 15;
    reasons.push('time_window');
  }

  const latestCoord = coordFromLatestTelemetry(trip);
  const candidateDestination = trip.coordinates_destination ?? latestCoord;
  if (travelOrder.lat_long_destination && candidateDestination) {
    const distanceM = haversineDistance(travelOrder.lat_long_destination, candidateDestination);
    if (distanceM <= destinationRadiusMeters) {
      score += 25;
      reasons.push('destination');
    } else {
      logSync('destination too far', {
        gpsTripLogId: trip.id,
        travelOrderId: travelOrder.id,
        distanceMeters: Math.round(distanceM),
        radiusMeters: destinationRadiusMeters,
      });
    }
  }

  if (tripArrivalMs !== null && scheduledArrivalMs !== null && Math.abs(tripArrivalMs - scheduledArrivalMs) <= departureWindowMs) {
    score += 10;
    reasons.push('arrival');
  }

  logSync('final score', { gpsTripLogId: trip.id, travelOrderId: travelOrder.id, score, reasons });
  return { trip, travelOrder, score, departureDeltaMs, reasons };
}

async function linkTripToTravelOrder(
  trip: CandidateTripRow,
  travelOrder: TravelOrderSyncRow,
  score: number,
  reasons: string[],
): Promise<TravelOrderSyncResult> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const alreadyLinked = await client.query<{ id: string }>(
      `SELECT id
         FROM gps_trip_logs
        WHERE travel_order_id = $1
          AND active_trip_id <> $2
          AND COALESCE(to_status_auto, '') <> 'manual'
        LIMIT 1`,
      [travelOrder.id, trip.active_trip_id],
    );
    if (alreadyLinked.rows[0]) {
      await client.query('ROLLBACK');
      logSync('rejected TO reason=already_linked_to_another_trip', {
        gpsTripLogId: trip.id,
        travelOrderId: travelOrder.id,
        existingGpsTripLogId: alreadyLinked.rows[0].id,
      });
      return { linked: false, reason: 'already_linked_to_another_trip', travelOrderId: travelOrder.id, gpsTripLogId: trip.id, activeTripId: trip.active_trip_id, score, telemetryBackfilled: 0 };
    }

    const backfillResult = await client.query(
      `UPDATE gps_telemetry
          SET travel_order_id = $1,
              driver_id = COALESCE(driver_id, $2)
        WHERE active_trip_id = $3
          AND vehicle_id = $4
          AND travel_order_id IS NULL`,
      [travelOrder.id, travelOrder.driver_id, trip.active_trip_id, trip.vehicle_id],
    );
    const updateResult = await client.query<{ id: string; active_trip_id: string }>(
      `UPDATE gps_trip_logs
          SET travel_order_id = $1,
              to_status_auto = 'matched',
              driver_id = COALESCE(driver_id, $2)
        WHERE active_trip_id = $3
          AND vehicle_id = $4
          AND COALESCE(to_status_auto, '') <> 'manual'
          AND (travel_order_id IS NULL OR travel_order_id = $1)
        RETURNING id, active_trip_id`,
      [travelOrder.id, travelOrder.driver_id, trip.active_trip_id, trip.vehicle_id],
    );
    const linkedTrip = updateResult.rows[0];
    if (!linkedTrip) {
      await client.query('ROLLBACK');
      logSync('rejected TO reason=manual_override_protected_or_candidate_claimed', {
        gpsTripLogId: trip.id,
        travelOrderId: travelOrder.id,
      });
      return { linked: false, reason: 'manual_override_protected', travelOrderId: travelOrder.id, gpsTripLogId: trip.id, activeTripId: trip.active_trip_id, score, telemetryBackfilled: 0 };
    }
    await client.query('COMMIT');

    logSync('winning TO', {
      gpsTripLogId: linkedTrip.id,
      activeTripId: linkedTrip.active_trip_id,
      travelOrderId: travelOrder.id,
      score,
      telemetryBackfilled: backfillResult.rowCount ?? 0,
    });

    return {
      linked: true,
      reason: reasons.join(','),
      travelOrderId: travelOrder.id,
      gpsTripLogId: linkedTrip.id,
      activeTripId: linkedTrip.active_trip_id,
      score,
      telemetryBackfilled: backfillResult.rowCount ?? 0,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function syncGpsTripLogToTravelOrder(gpsTripLogId: string): Promise<TravelOrderSyncResult> {
  const pool = getPool();
  const tripResult = await pool.query<CandidateTripRow>(
    `SELECT g.id, g.vehicle_id, g.driver_id, g.active_trip_id,
            g.departure_time_gps, g.arrival_time_gps, g.coordinates_destination,
            g.travel_order_id, g.to_status_auto, g.trip_status_gps,
            latest.latitude AS latest_latitude,
            latest.longitude AS latest_longitude,
            latest.recorded_at AS latest_recorded_at
       FROM gps_trip_logs g
       LEFT JOIN LATERAL (
         SELECT latitude, longitude, recorded_at
           FROM gps_telemetry gt
          WHERE gt.vehicle_id = g.vehicle_id
            AND gt.active_trip_id = g.active_trip_id
          ORDER BY gt.recorded_at DESC
          LIMIT 1
       ) latest ON true
      WHERE g.id = $1
      LIMIT 1`,
    [gpsTripLogId],
  );
  const trip = tripResult.rows[0];
  if (!trip) return { linked: false, reason: 'gps_trip_log_not_found', travelOrderId: null, gpsTripLogId, activeTripId: null, score: null, telemetryBackfilled: 0 };
  if (!trip.active_trip_id) return { linked: false, reason: 'missing_active_trip_id', travelOrderId: null, gpsTripLogId: trip.id, activeTripId: null, score: null, telemetryBackfilled: 0 };
  if (trip.to_status_auto === 'manual') return { linked: false, reason: 'manual_override_protected', travelOrderId: trip.travel_order_id, gpsTripLogId: trip.id, activeTripId: trip.active_trip_id, score: null, telemetryBackfilled: 0 };
  if (trip.travel_order_id) return { linked: false, reason: 'already_linked', travelOrderId: trip.travel_order_id, gpsTripLogId: trip.id, activeTripId: trip.active_trip_id, score: null, telemetryBackfilled: 0 };

  const tripDepartureMs = parseSyncTimestamp(trip.departure_time_gps);
  if (tripDepartureMs === null) return { linked: false, reason: 'missing_departure_timestamp', travelOrderId: null, gpsTripLogId: trip.id, activeTripId: trip.active_trip_id, score: null, telemetryBackfilled: 0 };

  const tripDate = String(trip.departure_time_gps ?? '').slice(0, 10);
  const toResult = await pool.query<TravelOrderSyncRow>(
    `SELECT id, vehicle_id, driver_id, status, scheduled_departure, scheduled_arrival,
            lat_long_destination, to_number
       FROM travel_orders
      WHERE status IN ('APPROVED', 'ACTIVE')
        AND scheduled_departure IS NOT NULL
        AND scheduled_departure::date BETWEEN $1::date - INTERVAL '1 day' AND $1::date + INTERVAL '1 day'
      ORDER BY scheduled_departure ASC`,
    [tripDate],
  );
  logSync('candidate TOs found', { gpsTripLogId: trip.id, count: toResult.rows.length, tripDate });
  if (toResult.rows.length === 0) {
    logSync('no approved TO', { gpsTripLogId: trip.id, vehicleId: trip.vehicle_id });
    return { linked: false, reason: 'no_approved_to', travelOrderId: null, gpsTripLogId: trip.id, activeTripId: trip.active_trip_id, score: null, telemetryBackfilled: 0 };
  }

  const scored = toResult.rows
    .map((travelOrder) => evaluateTravelOrderForTrip(trip, travelOrder))
    .filter((candidate): candidate is ScoredTripCandidate => candidate !== null)
    .sort((a, b) => b.score - a.score || (a.departureDeltaMs ?? Infinity) - (b.departureDeltaMs ?? Infinity));

  const best = scored[0];
  if (!best || best.score < MINIMUM_MATCH_SCORE) {
    const reason = best ? 'score_below_threshold' : 'no_confident_candidate';
    logSync(`no TO matched reason=${reason}`, { gpsTripLogId: trip.id, bestScore: best?.score ?? null });
    return { linked: false, reason, travelOrderId: null, gpsTripLogId: trip.id, activeTripId: trip.active_trip_id, score: best?.score ?? null, telemetryBackfilled: 0 };
  }

  const matchedTO = best.travelOrder;
  if (!matchedTO) {
    return { linked: false, reason: 'winning_to_not_found', travelOrderId: null, gpsTripLogId: trip.id, activeTripId: trip.active_trip_id, score: best.score, telemetryBackfilled: 0 };
  }
  return linkTripToTravelOrder(trip, matchedTO, best.score, best.reasons);
}

export async function syncUnlinkedGpsTripLogsToTravelOrders(limit = 200): Promise<{
  checked: number;
  linked: number;
  results: TravelOrderSyncResult[];
}> {
  const pool = getPool();
  const trips = await pool.query<{ id: string }>(
    `SELECT id
       FROM gps_trip_logs
      WHERE travel_order_id IS NULL
        AND active_trip_id IS NOT NULL
        AND COALESCE(to_status_auto, '') <> 'manual'
        AND trip_status_gps IN ('EN ROUTE', 'COMPLETED', 'ARRIVED', 'RETURNED')
      ORDER BY departure_time_gps DESC
      LIMIT $1`,
    [limit],
  );
  logSync('unlinked gps_trip_logs found', { count: trips.rows.length });
  const results: TravelOrderSyncResult[] = [];
  for (const trip of trips.rows) {
    results.push(await syncGpsTripLogToTravelOrder(trip.id));
  }
  return {
    checked: trips.rows.length,
    linked: results.filter((result) => result.linked).length,
    results,
  };
}

export async function syncApprovedTravelOrdersToActiveTrips(): Promise<{
  checked: number;
  linked: number;
  results: TravelOrderSyncResult[];
}> {
  const pool = getPool();
  const orders = await pool.query<{ id: string }>(
    `SELECT to_.id
       FROM travel_orders to_
      WHERE to_.status IN ('APPROVED', 'ACTIVE')
        AND to_.vehicle_id IS NOT NULL
        AND to_.scheduled_departure IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM gps_trip_logs g
           WHERE g.travel_order_id = to_.id
             AND COALESCE(g.to_status_auto, '') <> 'manual'
        )
      ORDER BY to_.scheduled_departure ASC
      LIMIT 100`,
  );

  const results: TravelOrderSyncResult[] = [];
  for (const order of orders.rows) {
    results.push(await syncTravelOrderToActiveTrip(order.id));
  }

  return {
    checked: orders.rows.length,
    linked: results.filter((result) => result.linked).length,
    results,
  };
}

export async function getActiveTripTravelOrderOverrides(): Promise<{
  driverOverrides: Record<string, string>;
  toNumberOverrides: Record<string, string>;
  toDestinationOverrides: Record<string, string>;
}> {
  const pool = getPool();
  const result = await pool.query<{
    vehicle_id: string;
    driver_name: string | null;
    to_number: string | null;
    lat_long_destination: string | null;
  }>(
    `SELECT DISTINCT ON (g.vehicle_id)
            g.vehicle_id,
            d.full_name AS driver_name,
            to_.to_number,
            to_.lat_long_destination
       FROM gps_trip_logs g
       JOIN travel_orders to_ ON to_.id = g.travel_order_id
       LEFT JOIN drivers d ON d.id = COALESCE(g.driver_id, to_.driver_id)
      WHERE g.active_trip_id IS NOT NULL
        AND g.arrival_time_gps IS NULL
        AND COALESCE(g.to_status_auto, '') <> 'manual'
      ORDER BY g.vehicle_id, g.departure_time_gps DESC`,
  );

  const driverOverrides: Record<string, string> = {};
  const toNumberOverrides: Record<string, string> = {};
  const toDestinationOverrides: Record<string, string> = {};
  for (const row of result.rows) {
    if (row.driver_name) driverOverrides[row.vehicle_id] = row.driver_name;
    if (row.to_number) toNumberOverrides[row.vehicle_id] = row.to_number;
    if (row.lat_long_destination) toDestinationOverrides[row.vehicle_id] = row.lat_long_destination;
  }
  return { driverOverrides, toNumberOverrides, toDestinationOverrides };
}

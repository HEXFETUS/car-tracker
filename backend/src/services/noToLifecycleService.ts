/**
 * No-TO Trip Lifecycle Service
 *
 * Implements the full lifecycle state machine for GPS trips without a
 * matching Travel Order (No-TO). Mirrors the TO lifecycle from
 * businessTripLifecycleService.ts, except the destination is inferred
 * dynamically from the farthest confirmed stop rather than a planned
 * Travel Order destination.
 *
 * Lifecycle States:
 *   WAITING_AT_BASE → OUTBOUND → ARRIVED_AT_DESTINATION → RETURNING → COMPLETED
 *                                          ↘ PAUSED_AWAY_FROM_BASE → RETURNING
 *
 * Destination Detection:
 *   For every LOCATION_UPDATE/MOVING telemetry point, compute the
 *   distance from origin. If it exceeds the previous farthest distance,
 *   update candidateDestination. Arrival is confirmed when the vehicle
 *   idles for >= FleetConfig.trip.idleLimitMinutes at the candidate.
 *
 * Trip Completion:
 *   Only completes when the vehicle returns near the origin AND
 *   either ignition OFF or idle >= idleLimitMinutes.
 */

import { getPool } from '../db/db.js';
import { getFleetConfig } from './fleetConfigService.js';

// ── Types ─────────────────────────────────────────────────────────

type BusinessTripStatus =
  | 'WAITING_AT_BASE'
  | 'OUTBOUND'
  | 'ARRIVED_AT_DESTINATION'
  | 'RETURNING'
  | 'PAUSED_AWAY_FROM_BASE'
  | 'COMPLETED';

type TelemetryRow = {
  id: string | null;
  vehicle_id: string;
  plate_number: string | null;
  event_type: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  speed_kmh: number | string | null;
  location_name: string | null;
  recorded_at: string | Date | null;
  active_trip_id: string | null;
  driver_id: string | null;
};

type NoToLifecycleTrip = {
  status: BusinessTripStatus;
  hadLeftBase: boolean;
  startedAt: string;
  endedAt: string | null;
  destinationReachedAt: string | null;
  returnedToBaseAt: string | null;
  pausedAt: string | null;
  pauseLocation: string | null;
  resumedAt: string | null;
  originCoord: string;
  destinationCoord: string | null;
  originName: string;
  destinationName: string;
  arrivedLocationName: string | null;
  arrivedCoordinates: string | null;
  lastCoord: string | null;
  lastLocationName: string | null;
  maxSpeedKph: number;
  activeTripIds: Set<string>;
  points: TelemetryRow[];
  // No-TO specific fields
  farthestDistanceM: number;
  candidateDestinationAddress: string | null;
  candidateDestinationCoordinates: string | null;
  endAddress: string | null;
  endCoordinates: string | null;
  endTime: string | null;
  vehicleId: string;
  driverId: string | null;
  plateNumber: string | null;
};

// ── Constants ─────────────────────────────────────────────────────

const BASE_RADIUS_M = Number(process.env.BUSINESS_TRIP_BASE_RADIUS_METERS ?? 300);
const PAUSE_RESUME_RADIUS_M = Number(process.env.BUSINESS_TRIP_PAUSE_RESUME_RADIUS_METERS ?? 300);
const RETURN_DIRECTION_MARGIN_M = Number(process.env.RETURN_DIRECTION_MARGIN_METERS ?? 100);

// ── Utility Functions ─────────────────────────────────────────────

function normalizeTelemetryEvent(eventType: string | null | undefined): string {
  return String(eventType ?? '').trim().toUpperCase().replace(/\s+ALERT$/, '').replace(/\s+/g, '_');
}

function timestampToIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function parseTime(value: string | Date | null | undefined): number | null {
  const iso = timestampToIso(value);
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function coordinate(row: Pick<TelemetryRow, 'latitude' | 'longitude'> | null | undefined): string | null {
  if (!row || row.latitude == null || row.longitude == null) return null;
  const lat = Number(row.latitude);
  const lng = Number(row.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? `${lat},${lng}` : null;
}

function parseCoord(value: string | null | undefined): { lat: number; lng: number } | null {
  const match = String(value ?? '').trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function haversineDistance(coord1: string | null | undefined, coord2: string | null | undefined): number {
  const a = parseCoord(coord1);
  const b = parseCoord(coord2);
  if (!a || !b) return Infinity;
  const radius = 6371e3;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function calculateRouteDistanceKm(points: TelemetryRow[]): number {
  let meters = 0;
  let previous: string | null = null;
  for (const point of points) {
    const current = coordinate(point);
    if (previous && current) {
      const distance = haversineDistance(previous, current);
      if (Number.isFinite(distance)) meters += distance;
    }
    if (current) previous = current;
  }
  return meters / 1000;
}

function isMoving(row: TelemetryRow): boolean {
  return normalizeTelemetryEvent(row.event_type) === 'LOCATION_UPDATE' && Number(row.speed_kmh) > 0;
}

function isIdling(row: TelemetryRow): boolean {
  const eventType = normalizeTelemetryEvent(row.event_type);
  return eventType === 'IDLING' || (eventType === 'LOCATION_UPDATE' && Number(row.speed_kmh) === 0);
}

function tripDateFromTimestamp(value: string): string {
  return value.slice(0, 10);
}

async function generateNoToRecordNo(departureTime: string): Promise<string> {
  const pool = getPool();
  const year = new Date(departureTime).getFullYear();
  const result = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt
       FROM gps_no_to_logs
      WHERE EXTRACT(YEAR FROM COALESCE(departure_time, trip_date, created_at)) = $1`,
    [year],
  );
  return `NO-TO-${year}-${String(Number(result.rows[0]?.cnt ?? 0) + 1).padStart(4, '0')}`;
}

/**
 * Check if a coordinate is near the base (origin + default base).
 */
function isNearBase(coord: string, defaultBaseCoord: string, originCoord: string): { near: boolean; distanceM: number } {
  const originDistance = haversineDistance(coord, originCoord);
  const defaultBaseDistance = haversineDistance(coord, defaultBaseCoord);
  const distanceM = Math.min(originDistance, defaultBaseDistance);
  return { near: distanceM <= BASE_RADIUS_M, distanceM };
}

// ── Lifecycle Builder ─────────────────────────────────────────────

/**
 * Build No-TO lifecycle trips from a stream of telemetry rows.
 *
 * Processes telemetry chronologically and reconstructs logical trips
 * using the same state machine as TO trips, with dynamic destination
 * detection (farthest point from origin where the vehicle idled).
 *
 * Returns an array of completed NoToLifecycleTrip objects.
 */
export function buildNoToLifecycleTrips(
  rows: TelemetryRow[],
  defaultBaseCoord: string,
  idleLimitMs: number,
): NoToLifecycleTrip[] {
  const completed: NoToLifecycleTrip[] = [];
  let current: NoToLifecycleTrip | null = null;

  // Track idling at candidate destination for arrival detection
  let idleStartAt: number | null = null;
  let lastMovingCoord: string | null = null;
  let lastMovingTime: number | null = null;
  // Track return trend — monitor if distance is decreasing
  let previousDistanceFromOrigin = Infinity;
  let returnDistanceImprovementCount = 0;
  const MIN_RETURN_POINTS = 3;

  for (const row of rows) {
    const recordedAt = timestampToIso(row.recorded_at);
    const coord = coordinate(row);
    if (!recordedAt || !coord) continue;

    const eventType = normalizeTelemetryEvent(row.event_type);
    const speed = Number(row.speed_kmh) || 0;
    const rowMs = parseTime(recordedAt) ?? 0;

    // ── Start a new trip when ignition ON or movement detected ──
    if (!current) {
      const isIgnitionOn = eventType === 'IGNITION_ON';
      const isMovingEvent = eventType === 'LOCATION_UPDATE' && speed > 0;

      if (!isIgnitionOn && !isMovingEvent) continue;

      current = {
        status: 'OUTBOUND',
        hadLeftBase: false,
        startedAt: recordedAt,
        endedAt: null,
        destinationReachedAt: null,
        returnedToBaseAt: null,
        pausedAt: null,
        pauseLocation: null,
        resumedAt: null,
        originCoord: coord,
        destinationCoord: coord,
        originName: row.location_name ?? 'Unknown',
        destinationName: row.location_name ?? '',
        arrivedLocationName: null,
        arrivedCoordinates: null,
        lastCoord: coord,
        lastLocationName: row.location_name,
        maxSpeedKph: speed,
        activeTripIds: new Set(row.active_trip_id ? [row.active_trip_id] : []),
        points: [row],
        // No-TO specific
        farthestDistanceM: 0,
        candidateDestinationAddress: null,
        candidateDestinationCoordinates: null,
        endAddress: null,
        endCoordinates: null,
        endTime: null,
        vehicleId: row.vehicle_id,
        driverId: row.driver_id ?? null,
        plateNumber: row.plate_number ?? null,
      };

      lastMovingCoord = coord;
      lastMovingTime = rowMs;
      previousDistanceFromOrigin = 0;
      returnDistanceImprovementCount = 0;
      idleStartAt = null;
      continue;
    }

    // ── For existing trips, accumulate data ──
    current.points.push(row);
    current.lastCoord = coord;
    current.lastLocationName = row.location_name ?? current.lastLocationName;
    current.maxSpeedKph = Math.max(current.maxSpeedKph, speed);
    if (row.active_trip_id) current.activeTripIds.add(row.active_trip_id);

    const distanceFromOrigin = haversineDistance(coord, current.originCoord);

    // ── Check if at base ──
    const baseResult = isNearBase(coord, defaultBaseCoord, current.originCoord);

    // ── Track whether vehicle has left base ──
    if (!baseResult.near && current.hadLeftBase === false) {
      current.hadLeftBase = true;
    }

    // ── Destination Detection ──
    // For every moving/LOCATION_UPDATE telemetry, check if distance from
    // origin exceeds the farthest previously recorded distance.
    if (eventType === 'LOCATION_UPDATE' || isMoving(row)) {
      lastMovingCoord = coord;
      lastMovingTime = rowMs;

      if (distanceFromOrigin > current.farthestDistanceM) {
        current.farthestDistanceM = distanceFromOrigin;
        current.candidateDestinationAddress = row.location_name ?? null;
        current.candidateDestinationCoordinates = coord;
        current.destinationCoord = coord;
        current.destinationName = row.location_name ?? current.destinationName;
      }
    }

    // ── Arrival Detection ──
    // If we haven't confirmed arrival yet, check if vehicle is idling
    // at/near the candidate destination for >= idleLimitMs.
    if (
      !current.destinationReachedAt &&
      current.candidateDestinationCoordinates &&
      current.farthestDistanceM > 0
    ) {
      const distToCandidate = haversineDistance(coord, current.candidateDestinationCoordinates);
      const idleLimitConfig = idleLimitMs;

      if ((isIdling(row) || speed === 0) && distToCandidate <= BASE_RADIUS_M) {
        if (idleStartAt === null) {
          idleStartAt = rowMs;
        } else if (rowMs - idleStartAt >= idleLimitConfig) {
          // Arrival confirmed
          current.destinationReachedAt = recordedAt;
          current.status = 'ARRIVED_AT_DESTINATION';
          current.arrivedCoordinates = current.candidateDestinationCoordinates;
          current.arrivedLocationName = current.candidateDestinationAddress;
          // The destination is the farthest confirmed point
          current.destinationCoord = current.candidateDestinationCoordinates;
          current.destinationName = current.candidateDestinationAddress ?? current.destinationName;
          idleStartAt = null;
        }
      } else {
        // Reset idle timer if not idling near candidate
        idleStartAt = null;
      }
    } else {
      // Reset if not in candidate area
      idleStartAt = null;
    }

    // ── Second Destination (re-outbound): If returning but starts moving away again ──
    if (
      current.status === 'RETURNING' &&
      distanceFromOrigin > previousDistanceFromOrigin + RETURN_DIRECTION_MARGIN_M
    ) {
      current.status = 'OUTBOUND';
      returnDistanceImprovementCount = 0;
    }

    // ── Detect RETURNING after arrival ──
    if (
      current.destinationReachedAt &&
      current.status === 'ARRIVED_AT_DESTINATION'
    ) {
      // Check if distance from origin is decreasing (returning)
      if (distanceFromOrigin < previousDistanceFromOrigin - RETURN_DIRECTION_MARGIN_M) {
        returnDistanceImprovementCount++;
        if (returnDistanceImprovementCount >= MIN_RETURN_POINTS) {
          current.status = 'RETURNING';
        }
      } else {
        returnDistanceImprovementCount = Math.max(0, returnDistanceImprovementCount - 1);
      }
    }

    if (current.status === 'OUTBOUND' || current.status === 'RETURNING') {
      if (distanceFromOrigin < previousDistanceFromOrigin - RETURN_DIRECTION_MARGIN_M) {
        returnDistanceImprovementCount++;
        if (
          returnDistanceImprovementCount >= MIN_RETURN_POINTS &&
          current.hadLeftBase
        ) {
          // Only transition if we're already moving back toward base
        }
      } else {
        returnDistanceImprovementCount = Math.max(0, returnDistanceImprovementCount - 1);
      }
    }

    previousDistanceFromOrigin = distanceFromOrigin;

    // ── Trip Completion: Returned near base + idle or ignition OFF ──
    if (baseResult.near && current.hadLeftBase && current.destinationReachedAt) {
      const isTripped = eventType === 'IGNITION_OFF' || (isIdling(row) && current.status === 'RETURNING');

      if (isTripped) {
        // Check idle duration at base
        if (isIdling(row)) {
          if (idleStartAt === null) {
            idleStartAt = rowMs;
          } else if (rowMs - idleStartAt >= idleLimitMs) {
            // Idle long enough at base — complete trip
            current.status = 'COMPLETED';
            current.endedAt = recordedAt;
            current.returnedToBaseAt = recordedAt;
            current.endAddress = row.location_name ?? current.originName;
            current.endCoordinates = coord;
            current.endTime = recordedAt;
            completed.push(current);
            current = null;
            idleStartAt = null;
            returnDistanceImprovementCount = 0;
            continue;
          }
        } else {
          idleStartAt = null;
        }

        if (eventType === 'IGNITION_OFF') {
          // Immediate completion on ignition OFF at base
          current.status = 'COMPLETED';
          current.endedAt = recordedAt;
          current.returnedToBaseAt = recordedAt;
          current.endAddress = row.location_name ?? current.originName;
          current.endCoordinates = coord;
          current.endTime = recordedAt;
          completed.push(current);
          current = null;
          idleStartAt = null;
          returnDistanceImprovementCount = 0;
          continue;
        }
      }
    }

    // ── Returned near base without reaching destination → complete as unmatched ──
    if (baseResult.near && current.hadLeftBase && !current.destinationReachedAt) {
      // If vehicle went out and came back without ever idling at farthest point
      current.status = 'COMPLETED';
      current.endedAt = recordedAt;
      current.returnedToBaseAt = recordedAt;
      current.endAddress = row.location_name ?? current.originName;
      current.endCoordinates = coord;
      current.endTime = recordedAt;
      // destination is the farthest point reached
      completed.push(current);
      current = null;
      idleStartAt = null;
      returnDistanceImprovementCount = 0;
      continue;
    }

    // ── Ignition OFF away from base → PAUSED_AWAY_FROM_BASE ──
    if (eventType === 'IGNITION_OFF' && !baseResult.near && current.hadLeftBase) {
      current.status = 'PAUSED_AWAY_FROM_BASE';
      current.pausedAt = recordedAt;
      current.pauseLocation = coord;
      current.endedAt = null;
      continue;
    }

    // ── Resume from pause ──
    if (eventType === 'IGNITION_ON' && current.status === 'PAUSED_AWAY_FROM_BASE') {
      const resumeDistance = haversineDistance(coord, current.pauseLocation);
      if (resumeDistance <= PAUSE_RESUME_RADIUS_M) {
        current.status = current.destinationReachedAt ? 'RETURNING' : 'OUTBOUND';
        current.resumedAt = recordedAt;
      }
    }

    // ── Moving after pause ──
    if (current.status === 'PAUSED_AWAY_FROM_BASE' && isMoving(row)) {
      // Vehicle started moving again, treat as resume even without ignition ON
      const resumeDistance = haversineDistance(coord, current.pauseLocation);
      if (resumeDistance <= PAUSE_RESUME_RADIUS_M * 3) {
        current.status = current.destinationReachedAt ? 'RETURNING' : 'OUTBOUND';
        current.resumedAt = recordedAt;
      }
    }
  }

  // ── Finalize any remaining active trip ──
  if (current) {
    if (current.destinationReachedAt) {
      current.endTime = timestampToIso(current.points[current.points.length - 1]?.recorded_at) ?? current.startedAt;
      current.endAddress = current.lastLocationName ?? current.originName;
      current.endCoordinates = current.lastCoord;
      current.endedAt = current.endTime;
    }
    completed.push(current);
  }

  return completed;
}

// ── Upsert ─────────────────────────────────────────────────────────

/**
 * Upsert a No-TO lifecycle trip into the database.
 * This replaces the old upsertNoToTrip logic with full lifecycle fields.
 */
export async function upsertNoToTripLifecycle(trip: NoToLifecycleTrip): Promise<'created' | 'updated'> {
  const pool = getPool();
  const fleetConfig = getFleetConfig();
  const gpsDistanceKm = calculateRouteDistanceKm(trip.points);
  const endTime = trip.endTime ?? trip.startedAt;
  const engineHours = Math.max(0, (new Date(endTime).getTime() - new Date(trip.startedAt).getTime()) / 3600000);
  const anomalyReason = 'Vehicle completed trip without matching approved travel order.';

  // ── Find existing no-TO log by active_trip_ids ──
  const activeTripIdArray = Array.from(trip.activeTripIds);
  let noToLogId: string | null = null;
  let status: 'created' | 'updated' = 'created';

  if (activeTripIdArray.length > 0) {
    const existing = await pool.query<{ id: string }>(
      `SELECT n.id
         FROM gps_no_to_logs n
         JOIN gps_no_to_log_active_trips nat ON nat.gps_no_to_log_id = n.id
        WHERE n.vehicle_id = $1
          AND n.trip_date = $2::date
          AND nat.active_trip_id = ANY($3::uuid[])
        ORDER BY n.created_at DESC
        LIMIT 1`,
      [trip.vehicleId, tripDateFromTimestamp(trip.startedAt), activeTripIdArray],
    );
    noToLogId = existing.rows[0]?.id ?? null;
    if (noToLogId) status = 'updated';
  }

  if (noToLogId) {
    // ── UPDATE existing log ──
    await pool.query(
      `UPDATE gps_no_to_logs
          SET driver_id = COALESCE($2, driver_id),
              origin_address = $3,
              origin_coordinates = $4,
              destination_address = $5,
              destination_coordinates = $6,
              departure_time = $7::timestamptz AT TIME ZONE 'UTC',
              arrival_time = $8::timestamptz AT TIME ZONE 'UTC',
              distance_km = $9,
              engine_hours = $10,
              max_speed_kph = $11,
              status = CASE WHEN status = 'linked' THEN status ELSE 'unmatched' END,
              anomaly_flag = true,
              anomaly_reason = $12,
              business_trip_status = $13,
              arrived_location_name = $14,
              arrived_coordinates = $15,
              destination_reached_at = $16::timestamptz AT TIME ZONE 'UTC',
              returned_to_base_at = $17::timestamptz AT TIME ZONE 'UTC',
              paused_at = $18::timestamptz AT TIME ZONE 'UTC',
              pause_location = $19,
              resumed_at = $20::timestamptz AT TIME ZONE 'UTC',
              end_address = $21,
              end_coordinates = $22,
              end_time = $23::timestamptz AT TIME ZONE 'UTC',
              farthest_distance_m = $24,
              candidate_destination_address = $25,
              candidate_destination_coordinates = $26
        WHERE id = $1`,
      [
        noToLogId,
        trip.driverId,
        trip.originName,
        trip.originCoord,
        trip.destinationName,
        trip.destinationCoord,
        trip.startedAt,
        endTime,
        Number(gpsDistanceKm.toFixed(2)),
        Number(engineHours.toFixed(2)),
        Number(trip.maxSpeedKph.toFixed(2)),
        anomalyReason,
        trip.status,
        trip.arrivedLocationName,
        trip.arrivedCoordinates,
        trip.destinationReachedAt,
        trip.returnedToBaseAt,
        trip.pausedAt,
        trip.pauseLocation,
        trip.resumedAt,
        trip.endAddress,
        trip.endCoordinates,
        trip.endTime,
        Number(trip.farthestDistanceM.toFixed(2)),
        trip.candidateDestinationAddress,
        trip.candidateDestinationCoordinates,
      ],
    );
  } else {
    // ── INSERT new log ──
    const noToRecordNo = await generateNoToRecordNo(trip.startedAt);
    const insertColumns = [
      'no_to_record_no',
      'vehicle_id',
      'driver_id',
      'trip_date',
      'origin_address',
      'origin_coordinates',
      'destination_address',
      'destination_coordinates',
      'departure_time',
      'arrival_time',
      'distance_km',
      'engine_hours',
      'max_speed_kph',
      'status',
      'anomaly_flag',
      'anomaly_reason',
      'business_trip_status',
      'arrived_location_name',
      'arrived_coordinates',
      'destination_reached_at',
      'returned_to_base_at',
      'paused_at',
      'pause_location',
      'resumed_at',
      'end_address',
      'end_coordinates',
      'end_time',
      'farthest_distance_m',
      'candidate_destination_address',
      'candidate_destination_coordinates',
    ];
    const insertValues = [
      noToRecordNo,
      trip.vehicleId,
      trip.driverId,
      tripDateFromTimestamp(trip.startedAt),
      trip.originName,
      trip.originCoord,
      trip.destinationName,
      trip.destinationCoord,
      trip.startedAt,
      endTime,
      Number(gpsDistanceKm.toFixed(2)),
      Number(engineHours.toFixed(2)),
      Number(trip.maxSpeedKph.toFixed(2)),
      'unmatched',
      true,
      anomalyReason,
      trip.status,
      trip.arrivedLocationName,
      trip.arrivedCoordinates,
      trip.destinationReachedAt,
      trip.returnedToBaseAt,
      trip.pausedAt,
      trip.pauseLocation,
      trip.resumedAt,
      trip.endAddress,
      trip.endCoordinates,
      trip.endTime,
      Number(trip.farthestDistanceM.toFixed(2)),
      trip.candidateDestinationAddress,
      trip.candidateDestinationCoordinates,
    ];
    const columnPlaceholders = insertValues.map((_, i) => `$${i + 1}`);
    const insertSql = `INSERT INTO gps_no_to_logs
       (${insertColumns.join(', ')})
     VALUES (${columnPlaceholders.join(', ')})
     RETURNING id`;

    console.log('[no-to-insert-debug]', {
      insertColumnCount: insertColumns.length,
      insertValueCount: insertValues.length,
      placeholderCount: columnPlaceholders.length,
      insertColumns,
    });

    const inserted = await pool.query<{ id: string }>(
      insertSql,
      insertValues,
    );
    noToLogId = inserted.rows[0].id;
  }

  // ── Sync active trip sessions ──
  await pool.query(`DELETE FROM gps_no_to_log_active_trips WHERE gps_no_to_log_id = $1`, [noToLogId]);

  for (const activeTripId of trip.activeTripIds) {
    const activePoints = trip.points.filter((point) => point.active_trip_id === activeTripId);
    const startTime = timestampToIso(activePoints[0]?.recorded_at);
    const endTimeForSession = timestampToIso(activePoints[activePoints.length - 1]?.recorded_at);
    await pool.query(
      `INSERT INTO gps_no_to_log_active_trips
         (gps_no_to_log_id, active_trip_id, start_time, end_time)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (gps_no_to_log_id, active_trip_id)
       DO UPDATE SET
         start_time = LEAST(COALESCE(gps_no_to_log_active_trips.start_time, EXCLUDED.start_time), EXCLUDED.start_time),
         end_time = GREATEST(COALESCE(gps_no_to_log_active_trips.end_time, EXCLUDED.end_time), EXCLUDED.end_time)`,
      [noToLogId, activeTripId, startTime, endTimeForSession],
    );

    await pool.query(
      `UPDATE gps_telemetry
          SET travel_order_id = NULL,
              driver_id = COALESCE(driver_id, $2)
        WHERE vehicle_id = $1
          AND active_trip_id = $3
          AND ($4::timestamptz IS NULL OR recorded_at >= $4::timestamptz)
          AND ($5::timestamptz IS NULL OR recorded_at <= $5::timestamptz)`,
      [trip.vehicleId, trip.driverId, activeTripId, startTime, endTimeForSession],
    );
  }

  return status;
}

// ── Main Sync Function ────────────────────────────────────────────

/**
 * Sync No-TO logs from telemetry using the lifecycle state machine.
 *
 * Scans telemetry for each vehicle, builds logical No-TO lifecycle trips
 * (with dynamic destination detection), and persists them.
 */
export async function syncNoToLogsFromTelemetry(): Promise<{
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}> {
  const pool = getPool();
  const fleetConfig = getFleetConfig();
  const defaultBaseCoord = `${fleetConfig.base.latitude},${fleetConfig.base.longitude}`;
  const idleLimitMs = (fleetConfig.trip.idleLimitMinutes ?? 10) * 60 * 1000;

  console.log('[no-to-lifecycle-sync] Starting...');

  // ── Fetch telemetry rows ────────────────────────────────────
  const telemetryResult = await pool.query<TelemetryRow>(
    `SELECT id, vehicle_id, plate_number, event_type, latitude, longitude,
            speed_kmh, location_name, recorded_at, active_trip_id, driver_id
       FROM gps_telemetry
      WHERE recorded_at IS NOT NULL
        AND vehicle_id IS NOT NULL
        AND active_trip_id IS NOT NULL
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      ORDER BY vehicle_id, recorded_at ASC`,
  );

  // ── Fetch all vehicles ──────────────────────────────────────
  const vehicleResult = await pool.query<{ id: string; plate_number: string }>(
    `SELECT id, plate_number FROM vehicles WHERE id IS NOT NULL`,
  );
  const allVehicleIds = new Set(vehicleResult.rows.map((v) => v.id));

  // ── Fetch all travel orders for exclusion ────────────────────
  const ordersResult = await pool.query<{ id: string; vehicle_id: string }>(
    `SELECT id, vehicle_id FROM travel_orders
      WHERE vehicle_id IS NOT NULL
        AND scheduled_departure IS NOT NULL
        AND status IN ('APPROVED', 'ACTIVE', 'COMPLETED')`,
  );

  const vehiclesWithOrders = new Set<string>();
  for (const order of ordersResult.rows) {
    vehiclesWithOrders.add(order.vehicle_id);
  }

  // ── Build excluded active_trip_id set (TO-linked sessions) ──
  const excludedActiveTripIds = new Set<string>();

  const toLinkedTelemetry = await pool.query<{ active_trip_id: string }>(
    `SELECT DISTINCT active_trip_id
       FROM gps_telemetry
      WHERE active_trip_id IS NOT NULL
        AND travel_order_id IS NOT NULL`,
  );
  for (const row of toLinkedTelemetry.rows) {
    excludedActiveTripIds.add(row.active_trip_id);
  }

  const toLinkedSessions = await pool.query<{ active_trip_id: string }>(
    `SELECT DISTINCT glat.active_trip_id
       FROM gps_trip_log_active_trips glat
       JOIN gps_trip_logs gl ON gl.id = glat.gps_trip_log_id
      WHERE gl.travel_order_id IS NOT NULL`,
  );
  for (const row of toLinkedSessions.rows) {
    excludedActiveTripIds.add(row.active_trip_id);
  }

  console.log('[no-to-lifecycle-sync] Excluding TO-linked active trips', {
    excludedActiveTripCount: excludedActiveTripIds.size,
  });

  // ── Delete stale no-TO logs whose active_trip_id is now TO-linked ──
  if (excludedActiveTripIds.size > 0) {
    const deleteResult = await pool.query(
      `DELETE FROM gps_no_to_logs
        WHERE id IN (
          SELECT n.id
            FROM gps_no_to_logs n
            JOIN gps_no_to_log_active_trips nat ON nat.gps_no_to_log_id = n.id
           WHERE nat.active_trip_id = ANY($1::uuid[])
        )`,
      [Array.from(excludedActiveTripIds)],
    );
    console.log('[no-to-lifecycle-sync] Deleted stale TO-linked no-TO logs', {
      deleted: deleteResult.rowCount,
    });
  }

  // ── Filter out excluded sessions and group by vehicle ───────
  const rowsByVehicle = new Map<string, TelemetryRow[]>();

  for (const row of telemetryResult.rows) {
    if (!row.active_trip_id || !row.vehicle_id) continue;

    if (excludedActiveTripIds.has(row.active_trip_id)) continue;

    if (!rowsByVehicle.has(row.vehicle_id)) {
      rowsByVehicle.set(row.vehicle_id, []);
    }
    rowsByVehicle.get(row.vehicle_id)!.push(row);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  // ── Process each vehicle's telemetry ────────────────────────
  for (const [vehicleId, rows] of rowsByVehicle) {
    if (!allVehicleIds.has(vehicleId)) {
      skipped += rows.length;
      continue;
    }

    try {
      const trips = buildNoToLifecycleTrips(rows, defaultBaseCoord, idleLimitMs);

      if (trips.length === 0) {
        skipped += rows.length;
        continue;
      }

      for (const trip of trips) {
        try {
          const result = await upsertNoToTripLifecycle(trip);
          if (result === 'created') created += 1;
          else updated += 1;
        } catch (error) {
          failed += 1;
          console.error('[no-to-lifecycle-sync] Failed to persist trip:', (error as Error).message);
        }
      }
    } catch (error) {
      failed += rows.length;
      console.error('[no-to-lifecycle-sync] Error processing vehicle', vehicleId, (error as Error).message);
    }
  }

  console.log(`[no-to-lifecycle-sync] Done: ${created} created, ${updated} updated, ${skipped} skipped, ${failed} failed`);
  return { created, updated, skipped, failed };
}
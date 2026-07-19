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
import { createNotificationForRoles } from './notificationService.js';

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
  is_to_linked?: boolean;
};

type NoToLifecycleTrip = {
  status: BusinessTripStatus;
  hadLeftBase: boolean;
  startedAt: string;
  endedAt: string | null;
  destinationReachedAt: string | null;
  arrivalAt: string | null;
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
const CONTINUATION_MAX_GAP_MS = Number(process.env.NO_TO_CONTINUATION_MAX_HOURS ?? 24) * 60 * 60 * 1000;
const BASE_ANCHOR_MAX_GAP_MS = Number(process.env.NO_TO_BASE_ANCHOR_MAX_MINUTES ?? 120) * 60 * 1000;

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
  const eventType = normalizeTelemetryEvent(row.event_type);
  return (eventType === 'LOCATION_UPDATE' || eventType === 'MOTION_STARTED')
    && Number(row.speed_kmh) > 0;
}

function isIdling(row: TelemetryRow): boolean {
  const eventType = normalizeTelemetryEvent(row.event_type);
  return eventType === 'IDLING' || eventType === 'IDLING_TOO_LONG' || (eventType === 'LOCATION_UPDATE' && Number(row.speed_kmh) === 0);
}

function tripDateFromTimestamp(value: string): string {
  return value.slice(0, 10);
}

async function generateNoToRecordNo(departureTime: string): Promise<string> {
  const pool = getPool();
  const year = new Date(departureTime).getFullYear();
  // Use MAX of the numeric suffix instead of COUNT(*) so that gaps from
  // deleted/linked-then-removed records are skipped and we never generate
  // a record number that already exists.
  const result = await pool.query<{ max_seq: string | null }>(
    `SELECT MAX(CAST(split_part(no_to_record_no, '-', 4) AS INTEGER)) AS max_seq
       FROM gps_no_to_logs
      WHERE EXTRACT(YEAR FROM COALESCE(departure_time, trip_date, created_at)) = $1`,
    [year],
  );
  const nextSeq = (Number(result.rows[0]?.max_seq ?? 0)) + 1;
  return `NO-TO-${year}-${String(nextSeq).padStart(4, '0')}`;
}

/** Check if a coordinate is near this logical journey's starting point. */
function isNearOrigin(coord: string, originCoord: string): { near: boolean; distanceM: number } {
  const distanceM = haversineDistance(coord, originCoord);
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
  let lastBaseRow: TelemetryRow | null = null;

  // Track idling at candidate destination for arrival detection
  let idleStartAt: number | null = null;
  let baseIdleStartAt: number | null = null;
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
    const fleetBaseResult = isNearOrigin(coord, defaultBaseCoord);

    // A TO-linked telemetry interval is a hard journey boundary. The same
    // tracker active_trip_id may continue before or after that bounded window.
    if (row.is_to_linked) {
      if (current) completed.push(current);
      current = null;
      lastBaseRow = null;
      idleStartAt = null;
      baseIdleStartAt = null;
      lastMovingCoord = null;
      lastMovingTime = null;
      previousDistanceFromOrigin = Infinity;
      returnDistanceImprovementCount = 0;
      continue;
    }

    // Keep the most recent real telemetry point at the configured fleet base.
    // When polling misses the exact departure, this becomes the canonical
    // Origin instead of the first point received several kilometres away.
    if (!current && fleetBaseResult.near) {
      lastBaseRow = row;
    }

    // A tracker may allocate a new active_trip_id after an ignition cycle
    // while the vehicle is still away from its original origin. It is a
    // continuation only when the new session starts near the previous
    // session's final coordinate. This prevents a later, unrelated journey
    // from being absorbed by an old unfinished chain for the same vehicle.
    if (
      current &&
      row.active_trip_id &&
      !current.activeTripIds.has(row.active_trip_id)
    ) {
      const distanceFromPreviousSession = haversineDistance(current.lastCoord, coord);
      const previousRecordedAt = parseTime(current.points[current.points.length - 1]?.recorded_at);
      const continuationGapMs = previousRecordedAt == null ? Infinity : rowMs - previousRecordedAt;
      const isContinuous =
        current.hadLeftBase &&
        Number.isFinite(distanceFromPreviousSession) &&
        distanceFromPreviousSession <= PAUSE_RESUME_RADIUS_M * 3 &&
        continuationGapMs >= 0 &&
        continuationGapMs <= CONTINUATION_MAX_GAP_MS;

      if (!isContinuous) {
        current = null;
        idleStartAt = null;
        baseIdleStartAt = null;
        lastMovingCoord = null;
        lastMovingTime = null;
        previousDistanceFromOrigin = Infinity;
        returnDistanceImprovementCount = 0;
      }
    }

    // ── Start a new trip when ignition ON or movement detected ──
    if (!current) {
      const isIgnitionOn = eventType === 'IGNITION_ON';
      const isMovingEvent = isMoving(row);

      if (!isIgnitionOn && !isMovingEvent) continue;

      const lastBaseAt = parseTime(lastBaseRow?.recorded_at);
      const canUseLastBase = !fleetBaseResult.near
        && lastBaseRow != null
        && lastBaseAt != null
        && rowMs >= lastBaseAt
        && rowMs - lastBaseAt <= BASE_ANCHOR_MAX_GAP_MS;
      const configuredBase = parseCoord(defaultBaseCoord);
      const syntheticBaseRow: TelemetryRow | null = !fleetBaseResult.near && !canUseLastBase && configuredBase
        ? {
            ...row,
            id: null,
            event_type: 'ORIGIN_ANCHOR',
            latitude: configuredBase.lat,
            longitude: configuredBase.lng,
            speed_kmh: 0,
            location_name: 'Fleet base',
          }
        : null;
      const originRow = canUseLastBase ? lastBaseRow! : (syntheticBaseRow ?? row);
      const originCoord = coordinate(originRow) ?? coord;
      const originAt = canUseLastBase
        ? (timestampToIso(originRow.recorded_at) ?? recordedAt)
        : recordedAt;
      const initialPoints = originRow === row ? [row] : [originRow, row];
      const initialActiveTripIds = new Set(
        initialPoints.flatMap((point) => point.active_trip_id ? [point.active_trip_id] : []),
      );

      current = {
        status: 'OUTBOUND',
        hadLeftBase: !fleetBaseResult.near,
        startedAt: originAt,
        endedAt: null,
        destinationReachedAt: null,
        arrivalAt: null,
        returnedToBaseAt: null,
        pausedAt: null,
        pauseLocation: null,
        resumedAt: null,
        originCoord,
        destinationCoord: coord,
        originName: originRow.location_name ?? 'Fleet base',
        destinationName: row.location_name ?? '',
        arrivedLocationName: null,
        arrivedCoordinates: null,
        lastCoord: coord,
        lastLocationName: row.location_name,
        maxSpeedKph: speed,
        activeTripIds: initialActiveTripIds,
        points: initialPoints,
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
      previousDistanceFromOrigin = haversineDistance(coord, originCoord);
      returnDistanceImprovementCount = 0;
      idleStartAt = null;
      baseIdleStartAt = null;
      lastBaseRow = null;
      continue;
    }

    // ── For existing trips, accumulate data ──
    current.points.push(row);
    current.lastCoord = coord;
    current.lastLocationName = row.location_name ?? current.lastLocationName;
    current.maxSpeedKph = Math.max(current.maxSpeedKph, speed);
    if (row.active_trip_id) current.activeTripIds.add(row.active_trip_id);

    const distanceFromOrigin = haversineDistance(coord, current.originCoord);

    // Arrival remains relative to the journey's actual origin, while trip
    // departure/completion is relative to the configured fleet base.
    const baseResult = fleetBaseResult;

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
        current.arrivalAt = recordedAt;
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

    // ── Trip Completion: Returned to configured base ──
    if (baseResult.near && current.hadLeftBase) {
      const ignitionOffAtBase = eventType === 'IGNITION_OFF';
      if (isIdling(row)) {
        baseIdleStartAt ??= rowMs;
      } else {
        baseIdleStartAt = null;
      }
      const idledAtBaseLongEnough = baseIdleStartAt !== null && rowMs - baseIdleStartAt >= idleLimitMs;

      if (ignitionOffAtBase || idledAtBaseLongEnough) {
        current.status = 'COMPLETED';
        current.endedAt = recordedAt;
        current.returnedToBaseAt = recordedAt;
        current.endAddress = row.location_name ?? current.originName;
        current.endCoordinates = coord;
        current.endTime = recordedAt;
        completed.push(current);
        lastBaseRow = row;
        current = null;
        idleStartAt = null;
        baseIdleStartAt = null;
        returnDistanceImprovementCount = 0;
        continue;
      }
    } else {
      baseIdleStartAt = null;
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
    // The latest point is not an End until the lifecycle reaches COMPLETED.
    // Details may show it as the map's current red marker, but End stays blank.
    completed.push(current);
  }

  // ── Filter out trips that never had a LOCATION_UPDATE ──
  // A trip with only IGNITION_ON → IGNITION_OFF and no actual movement
  // (no LOCATION_UPDATE events) should not create a no-TO log.
  return completed.filter((trip) =>
    trip.hadLeftBase
    && trip.points.some((p) => normalizeTelemetryEvent(p.event_type) === 'LOCATION_UPDATE'),
  );
}

// ── Upsert ─────────────────────────────────────────────────────────

/**
 * Upsert a No-TO lifecycle trip into the database.
 * This replaces the old upsertNoToTrip logic with full lifecycle fields.
 */
export async function upsertNoToTripLifecycle(trip: NoToLifecycleTrip): Promise<'created' | 'updated'> {
  const pool = getPool();
  const gpsDistanceKm = calculateRouteDistanceKm(trip.points);
  const lastTelemetryAt = timestampToIso(trip.points[trip.points.length - 1]?.recorded_at);
  const metricsEndTime = trip.endTime ?? lastTelemetryAt ?? trip.startedAt;
  const engineHours = Math.max(0, (new Date(metricsEndTime).getTime() - new Date(trip.startedAt).getTime()) / 3600000);
  const anomalyReason = 'Vehicle completed trip without matching approved travel order.';

  // A tracker session can contain several origin-to-return journeys. The first
  // telemetry timestamp is the stable identity within a vehicle; active-trip
  // IDs remain route membership metadata only.
  const activeTripIdArray = Array.from(trip.activeTripIds);
  let noToLogId: string | null = null;
  let status: 'created' | 'updated' = 'created';

  const existing = await pool.query<{ id: string }>(
    `SELECT id
       FROM gps_no_to_logs
      WHERE vehicle_id = $1
        AND departure_time = $2::timestamptz AT TIME ZONE 'UTC'
      ORDER BY created_at ASC, id ASC
      LIMIT 1`,
    [trip.vehicleId, trip.startedAt],
  );
  noToLogId = existing.rows[0]?.id ?? null;
  if (noToLogId) status = 'updated';

  if (noToLogId) {
    // ── UPDATE existing log ──
    // Determine primary active_trip_id (prefer first/earliest)
    const primaryActiveTripId = activeTripIdArray.length > 0 ? activeTripIdArray[0] : null;

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
              candidate_destination_coordinates = $26,
              active_trip_id = $27,
              parent_trip_id = CASE
                WHEN status = 'unmatched'
                 AND converted_gps_trip_log_id IS NULL
                 AND travel_order_id IS NULL
                THEN NULL
                ELSE parent_trip_id
              END,
              updated_at = current_timestamp
        WHERE id = $1`,
      [
        noToLogId,
        trip.driverId,
        trip.originName,
        trip.originCoord,
        trip.destinationName,
        trip.destinationCoord,
        trip.startedAt,
        trip.arrivalAt,
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
        primaryActiveTripId,
      ],
    );
  } else {
    // ── INSERT new log ──
    const noToRecordNo = await generateNoToRecordNo(trip.startedAt);
    const primaryActiveTripId = activeTripIdArray.length > 0 ? activeTripIdArray[0] : null;
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
      'active_trip_id',
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
      trip.arrivalAt,
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
      primaryActiveTripId,
    ];
    const insertSql = `INSERT INTO gps_no_to_logs
       (${insertColumns.join(', ')})
     VALUES (${insertColumns.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING id`;

    console.log('[no-to-insert-debug]', {
      insertColumnCount: insertColumns.length,
      insertValueCount: insertValues.length,
    });

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const inserted = await pool.query<{ id: string }>(insertSql, insertValues);
        noToLogId = inserted.rows[0]?.id ?? null;
        if (noToLogId) break;
      } catch (err: any) {
        lastError = err;
        // If duplicate key on no_to_record_no, regenerate and retry
        if (err?.code === '23505' && err?.constraint === 'gps_no_to_logs_no_to_record_no_key') {
          const newNo = await generateNoToRecordNo(trip.startedAt);
          insertValues[0] = newNo;
          continue;
        }
        // Otherwise rethrow
        throw err;
      }
    }

    if (!noToLogId && lastError) {
      throw lastError;
    }
  }

  // ── Sync active trip sessions ──
  if (!noToLogId) {
    console.warn('[no-to-upsert] Skipping active trip sync — no noToLogId');
    return status;
  }

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
          SET driver_id = COALESCE(driver_id, $2)
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
type NoToSyncResult = {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
};

async function syncNoToLogsFromTelemetryUnlocked(
  options: { notifyNewTrips?: boolean } = {},
): Promise<NoToSyncResult> {
  const pool = getPool();
  const notifyNewTrips = options.notifyNewTrips ?? true;
  const fleetConfig = getFleetConfig();
  const defaultBaseCoord = `${fleetConfig.base.latitude},${fleetConfig.base.longitude}`;
  const idleLimitMs = (fleetConfig.trip.idleLimitMinutes ?? 10) * 60 * 1000;

  console.log('[no-to-lifecycle-sync] Starting...');

  // ── Fetch telemetry rows ────────────────────────────────────
  const telemetryResult = await pool.query<TelemetryRow>(
    `SELECT telemetry.id, telemetry.vehicle_id, telemetry.plate_number,
            telemetry.event_type, telemetry.latitude, telemetry.longitude,
            telemetry.speed_kmh, telemetry.location_name, telemetry.recorded_at,
            telemetry.active_trip_id, telemetry.driver_id,
            (telemetry.travel_order_id IS NOT NULL OR EXISTS (
              SELECT 1
                FROM gps_trip_log_active_trips linked_session
                JOIN gps_trip_logs linked_log
                  ON linked_log.id = linked_session.gps_trip_log_id
                 AND linked_log.travel_order_id IS NOT NULL
               WHERE linked_session.active_trip_id = telemetry.active_trip_id
                 AND (linked_session.start_time IS NULL OR telemetry.recorded_at >= linked_session.start_time)
                 AND (linked_session.end_time IS NULL OR telemetry.recorded_at <= linked_session.end_time)
            )) AS is_to_linked
       FROM gps_telemetry telemetry
      WHERE telemetry.recorded_at IS NOT NULL
        AND telemetry.vehicle_id IS NOT NULL
        AND telemetry.active_trip_id IS NOT NULL
        AND telemetry.latitude IS NOT NULL
        AND telemetry.longitude IS NOT NULL
      ORDER BY telemetry.vehicle_id, telemetry.recorded_at ASC`,
  );

  // ── Fetch all vehicles ──────────────────────────────────────
  const vehicleResult = await pool.query<{ id: string; plate_number: string }>(
    `SELECT id, plate_number FROM vehicles WHERE id IS NOT NULL`,
  );
  const allVehicleIds = new Set(vehicleResult.rows.map((v) => v.id));

  // Delete only a No-TO journey whose own bounded telemetry windows no longer
  // contain an unlinked point. Other journeys may legitimately reuse the same
  // tracker active_trip_id outside those windows.
  const staleLinkedResult = await pool.query(
    `DELETE FROM gps_no_to_logs no_to_log
      WHERE EXISTS (
        SELECT 1
          FROM gps_no_to_log_active_trips session
         WHERE session.gps_no_to_log_id = no_to_log.id
      )
        AND NOT EXISTS (
          SELECT 1
            FROM gps_no_to_log_active_trips session
            JOIN gps_telemetry telemetry
              ON telemetry.vehicle_id = no_to_log.vehicle_id
             AND telemetry.active_trip_id = session.active_trip_id
             AND (session.start_time IS NULL OR telemetry.recorded_at >= session.start_time)
             AND (session.end_time IS NULL OR telemetry.recorded_at <= session.end_time)
           WHERE session.gps_no_to_log_id = no_to_log.id
             AND telemetry.travel_order_id IS NULL
             AND NOT EXISTS (
               SELECT 1
                 FROM gps_trip_log_active_trips linked_session
                 JOIN gps_trip_logs linked_log
                   ON linked_log.id = linked_session.gps_trip_log_id
                  AND linked_log.travel_order_id IS NOT NULL
                WHERE linked_session.active_trip_id = telemetry.active_trip_id
                  AND (linked_session.start_time IS NULL OR telemetry.recorded_at >= linked_session.start_time)
                  AND (linked_session.end_time IS NULL OR telemetry.recorded_at <= linked_session.end_time)
             )
        )`,
  );
  if ((staleLinkedResult.rowCount ?? 0) > 0) {
    console.log('[no-to-lifecycle-sync] Deleted fully TO-linked No-TO journeys', {
      deleted: staleLinkedResult.rowCount,
    });
  }

  // Remove unmatched tracker sessions that never became a trip because every
  // bounded telemetry point remained inside the configured fleet-base radius.
  const nonTripResult = await pool.query(
    `DELETE FROM gps_no_to_logs no_to_log
      WHERE no_to_log.status = 'unmatched'
        AND EXISTS (
          SELECT 1
            FROM gps_no_to_log_active_trips session
           WHERE session.gps_no_to_log_id = no_to_log.id
        )
        AND NOT EXISTS (
          SELECT 1
            FROM gps_no_to_log_active_trips session
            JOIN gps_telemetry telemetry
              ON telemetry.vehicle_id = no_to_log.vehicle_id
             AND telemetry.active_trip_id = session.active_trip_id
             AND (session.start_time IS NULL OR telemetry.recorded_at >= session.start_time)
             AND (session.end_time IS NULL OR telemetry.recorded_at <= session.end_time)
           WHERE session.gps_no_to_log_id = no_to_log.id
             AND telemetry.latitude IS NOT NULL
             AND telemetry.longitude IS NOT NULL
             AND haversine_distance(
               $1,
               telemetry.latitude::text || ',' || telemetry.longitude::text
             ) > $2
        )`,
    [defaultBaseCoord, BASE_RADIUS_M],
  );
  if ((nonTripResult.rowCount ?? 0) > 0) {
    console.log('[no-to-lifecycle-sync] Deleted stationary base non-trips', {
      deleted: nonTripResult.rowCount,
    });
  }

  // ── Filter out excluded sessions and group by vehicle ───────
  // Repair records produced by the previous cross-session grouping. If the
  // row's primary active trip never had a location update, its movement and
  // end fields necessarily came from a different session. Delete only
  // unmatched rows so the valid sessions can be rebuilt below.
  const invalidMergedResult = await pool.query(
    `DELETE FROM gps_no_to_logs n
      WHERE n.status = 'unmatched'
        AND n.active_trip_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
            FROM gps_telemetry t
           WHERE t.vehicle_id = n.vehicle_id
             AND t.active_trip_id = n.active_trip_id
             AND UPPER(TRIM(t.event_type)) = 'LOCATION_UPDATE'
        )`,
  );
  if ((invalidMergedResult.rowCount ?? 0) > 0) {
    console.log('[no-to-lifecycle-sync] Deleted invalid merged no-TO logs', {
      deleted: invalidMergedResult.rowCount,
    });
  }

  // Shared active_trip_id values do not make two logical journeys a parent and
  // child. Remove legacy links so every stable journey remains visible.
  const detachedParentResult = await pool.query(
    `UPDATE gps_no_to_logs child
        SET parent_trip_id = NULL,
            updated_at = current_timestamp
      WHERE child.parent_trip_id IS NOT NULL`,
  );
  if ((detachedParentResult.rowCount ?? 0) > 0) {
    console.log('[no-to-lifecycle-sync] Detached stale parent links', {
      detached: detachedParentResult.rowCount,
    });
  }

  // Process a vehicle's sessions chronologically so active_trip_id changes
  // away from the original origin can be joined into one logical journey.
  const rowsByVehicle = new Map<string, TelemetryRow[]>();

  for (const row of telemetryResult.rows) {
    if (!row.active_trip_id || !row.vehicle_id) continue;

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
      let vehiclePersistFailed = false;

      if (trips.length === 0) {
        skipped += rows.length;
      }

      for (const trip of trips) {
        try {
          const result = await upsertNoToTripLifecycle(trip);
          if (result === 'created') {
            created += 1;
            // Create notification for all roles when a new no-TO trip is detected
            try {
              if (notifyNewTrips) {
                const plate = trip.plateNumber ?? trip.vehicleId;
                await createNotificationForRoles(['SUPERADMIN', 'ADMIN', 'DISPATCHER', 'HR', 'VIEWER'], {
                  type: 'gps_alert',
                  title: 'No Travel Order Alert',
                  message: `Vehicle ${plate} completed a trip without an approved travel order.\nOrigin: ${trip.originName}\nDestination: ${trip.destinationName}`,
                  targetUrl: '/gps-logs',
                  targetTab: 'alerts',
                  entityId: trip.vehicleId,
                });
              }
            } catch (notifError) {
              console.error(`[no-to-lifecycle-sync] Failed to create notification for vehicle=${trip.vehicleId}:`, (notifError as Error).message);
            }
          } else {
            updated += 1;
          }
        } catch (error) {
          vehiclePersistFailed = true;
          failed += 1;
          console.error('[no-to-lifecycle-sync] Failed to persist trip:', (error as Error).message);
        }
      }

      // The full telemetry history was rebuilt successfully for this vehicle.
      // Remove unmatched legacy identities that the current lifecycle no
      // longer produces (for example, a paused fragment superseded by a
      // completed base-return journey). Linked/converted records are retained.
      if (!vehiclePersistFailed) {
        const tripStarts = trips.map((trip) => trip.startedAt);
        const reconciled = await pool.query(
          `DELETE FROM gps_no_to_logs no_to_log
            WHERE no_to_log.vehicle_id = $1
              AND no_to_log.status = 'unmatched'
              AND NOT EXISTS (
                SELECT 1
                  FROM unnest($2::timestamptz[]) produced(started_at)
                 WHERE no_to_log.departure_time = produced.started_at AT TIME ZONE 'UTC'
              )`,
          [vehicleId, tripStarts],
        );
        if ((reconciled.rowCount ?? 0) > 0) {
          console.log('[no-to-lifecycle-sync] Deleted superseded No-TO journeys', {
            vehicleId,
            deleted: reconciled.rowCount,
          });
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

let noToSyncQueue: Promise<void> = Promise.resolve();

/**
 * Serialize full-history No-TO reconstruction within the backend process.
 * Session advisory locks cannot be used through a transaction-mode pooler:
 * the lock can survive after the pooled connection is returned.
 */
export async function syncNoToLogsFromTelemetry(
  options: { notifyNewTrips?: boolean } = {},
): Promise<NoToSyncResult> {
  const queuedSync = noToSyncQueue.then(() => syncNoToLogsFromTelemetryUnlocked(options));
  noToSyncQueue = queuedSync.then(
    () => undefined,
    () => undefined,
  );
  return queuedSync;
}

import { getPool } from '../db/db.js';
import { getFleetConfig } from './fleetConfigService.js';

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
  travel_order_id: string | null;
};

type TravelOrderRow = {
  id: string;
  vehicle_id: string;
  driver_id: string | null;
  status: string;
  scheduled_departure: string | Date | null;
  scheduled_arrival: string | Date | null;
  lat_long_origin: string | null;
  lat_long_destination: string | null;
  origin_location: string | null;
  destination_target: string | null;
  to_number: string | null;
  travel_date: string | null;
};

type LifecycleTrip = {
  travelOrder: TravelOrderRow;
  matchedToTravelOrder: boolean;
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
  matchedDestinationDistanceM: number | null;
  matchedOriginDistanceM: number | null;
  authoritativeTravelOrderLink: boolean;
  anomalyReason: string | null;
  travelDate: string;
};

const DEPARTURE_WINDOW_MS = Number(process.env.TO_SYNC_DEPARTURE_WINDOW_MINUTES ?? 120) * 60 * 1000;
const BASE_RADIUS_M = Number(process.env.BUSINESS_TRIP_BASE_RADIUS_METERS ?? 300);
const DESTINATION_RADIUS_M = Number(process.env.BUSINESS_TRIP_DESTINATION_RADIUS_METERS ?? 700);
const PAUSE_RESUME_RADIUS_M = Number(process.env.BUSINESS_TRIP_PAUSE_RESUME_RADIUS_METERS ?? 300);

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

function countSqlPlaceholders(sql: string): number {
  return new Set(Array.from(sql.matchAll(/\$(\d+)/g), (match) => Number(match[1]))).size;
}

function isMoving(row: TelemetryRow): boolean {
  return normalizeTelemetryEvent(row.event_type) === 'LOCATION_UPDATE' && Number(row.speed_kmh) > 0;
}

function isTripStartSignal(row: TelemetryRow): boolean {
  const eventType = normalizeTelemetryEvent(row.event_type);
  return eventType === 'MOTION_STARTED' || (eventType === 'LOCATION_UPDATE' && Number(row.speed_kmh) > 0);
}

function tripDateFromTimestamp(value: string): string {
  return value.slice(0, 10);
}

function manilaDateFromTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return tripDateFromTimestamp(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

async function generateGpsRecordNo(departureTimeGps: string): Promise<string> {
  const pool = getPool();
  const year = new Date(departureTimeGps).getFullYear();
  const result = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt
       FROM gps_trip_logs
      WHERE EXTRACT(YEAR FROM COALESCE(departure_time_gps, trip_date, created_at)) = $1`,
    [year],
  );
  return `GPS-${year}-${String(Number(result.rows[0]?.cnt ?? 0) + 1).padStart(4, '0')}`;
}

export async function syncTravelDateGpsLogs(): Promise<{ created: number; updated: number }> {
  const pool = getPool();
  const updatedResult = await pool.query(
    `UPDATE gps_trip_logs g
        SET trip_date = to_.scheduled_departure::date,
            trip_status_gps = CASE
              WHEN to_.status = 'CANCELLED' AND g.trip_status_gps = 'pending' THEN 'cancelled'
              ELSE g.trip_status_gps
            END
       FROM travel_orders to_
      WHERE to_.id = g.travel_order_id
        AND to_.scheduled_departure IS NOT NULL
        AND (
          g.trip_date IS DISTINCT FROM to_.scheduled_departure::date
          OR (to_.status = 'CANCELLED' AND g.trip_status_gps = 'pending')
        )`,
  );

  const createdResult = await pool.query<{ id: string }>(
    `WITH eligible_orders AS MATERIALIZED (
       SELECT to_.id,
              to_.vehicle_id,
              to_.driver_id,
              to_.scheduled_departure,
              to_.scheduled_departure::date AS travel_date,
              to_.origin_location,
              to_.destination_target,
              to_.lat_long_origin,
              to_.lat_long_destination,
              EXTRACT(YEAR FROM to_.scheduled_departure)::integer AS record_year
         FROM travel_orders to_
        WHERE to_.status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
          AND to_.scheduled_departure IS NOT NULL
          AND to_.scheduled_departure::date <= (NOW() AT TIME ZONE 'Asia/Manila')::date
          AND to_.vehicle_id IS NOT NULL
          AND to_.driver_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM gps_trip_logs g WHERE g.travel_order_id = to_.id
          )
     ), years AS (
       SELECT DISTINCT record_year FROM eligible_orders
     ), locks AS MATERIALIZED (
       SELECT record_year, pg_advisory_xact_lock(730000 + record_year) AS locked
         FROM years
        ORDER BY record_year
     ), max_sequences AS (
       SELECT y.record_year,
              COALESCE(MAX(
                CASE
                  WHEN g.gps_record_no ~ ('^GPS-' || y.record_year || '-[0-9]+$')
                  THEN split_part(g.gps_record_no, '-', 3)::integer
                END
              ), 0) AS max_sequence
         FROM years y
         LEFT JOIN gps_trip_logs g ON true
        GROUP BY y.record_year
     ), numbered AS (
       SELECT e.*,
              m.max_sequence + ROW_NUMBER() OVER (
                PARTITION BY e.record_year
                ORDER BY e.travel_date ASC, e.scheduled_departure ASC, e.id ASC
              ) AS record_sequence
         FROM eligible_orders e
         JOIN locks l USING (record_year)
         JOIN max_sequences m USING (record_year)
     )
     INSERT INTO gps_trip_logs (
       gps_record_no, trip_date, vehicle_id, driver_id,
       origin_gps_start_point, destination_gps_end_point,
       coordinates_origin, coordinates_destination,
       actual_route_road_taken, departure_time_gps, arrival_time_gps,
       gps_distance_km, engine_hours, max_speed_kph,
       trip_status_gps, travel_order_id, to_status_auto,
       anomaly_flag, notes_remarks, active_trip_id, trip_type,
       destination_verified, business_trip_status
     )
     SELECT 'GPS-' || record_year || '-' || LPAD(record_sequence::text, 4, '0'),
            travel_date, vehicle_id, driver_id,
            COALESCE(origin_location, ''), COALESCE(destination_target, ''),
            lat_long_origin, lat_long_destination,
            '', NULL, NULL, 0, 0, 0,
            'pending', id, 'matched', FALSE, NULL, NULL, 'OUTBOUND', FALSE, 'WAITING_AT_BASE'
       FROM numbered
     ON CONFLICT DO NOTHING
     RETURNING id`,
  );

  return {
    created: createdResult.rows.length,
    updated: updatedResult.rowCount ?? 0,
  };
}

export async function syncCompleteTravelOrderSessions(): Promise<{ sessions: number; points: number }> {
  const pool = getPool();
  const result = await pool.query<{ sessions: number; points: number }>(
    `WITH session_stats AS MATERIALIZED (
       SELECT gt.vehicle_id,
              gt.active_trip_id,
              MIN(gt.recorded_at) AS session_start,
              MAX(gt.recorded_at) AS session_end,
              (ARRAY_AGG(CONCAT(gt.latitude, ',', gt.longitude) ORDER BY gt.recorded_at ASC))[1] AS start_coordinates,
              COUNT(*) FILTER (WHERE gt.travel_order_id IS NULL) AS unlinked_points,
              COUNT(DISTINCT gt.travel_order_id) FILTER (WHERE gt.travel_order_id IS NOT NULL) AS linked_order_count,
              (ARRAY_AGG(DISTINCT gt.travel_order_id) FILTER (WHERE gt.travel_order_id IS NOT NULL))[1] AS linked_travel_order_id
         FROM gps_telemetry gt
        WHERE gt.active_trip_id IS NOT NULL
          AND gt.latitude IS NOT NULL
          AND gt.longitude IS NOT NULL
        GROUP BY gt.vehicle_id, gt.active_trip_id
     ), validated AS MATERIALIZED (
       SELECT stats.vehicle_id, stats.active_trip_id, stats.session_start, stats.session_end,
              stats.linked_travel_order_id AS travel_order_id, target_order.driver_id,
              target_log.id AS gps_trip_log_id
         FROM session_stats stats
         JOIN travel_orders target_order
           ON target_order.id = stats.linked_travel_order_id
          AND target_order.vehicle_id = stats.vehicle_id
          AND target_order.status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
          AND target_order.driver_id IS NOT NULL
          AND target_order.scheduled_departure IS NOT NULL
          AND target_order.lat_long_origin IS NOT NULL
         JOIN gps_trip_logs target_log
           ON target_log.travel_order_id = target_order.id
          AND target_log.vehicle_id = stats.vehicle_id
          AND COALESCE(target_log.to_status_auto, '') <> 'manual'
         JOIN gps_trip_log_active_trips target_session
           ON target_session.gps_trip_log_id = target_log.id
          AND target_session.active_trip_id = stats.active_trip_id
        WHERE stats.unlinked_points > 0
          AND stats.linked_order_count = 1
          AND (stats.session_start AT TIME ZONE 'Asia/Manila')::date = (stats.session_end AT TIME ZONE 'Asia/Manila')::date
          AND target_order.scheduled_departure::date = (stats.session_start AT TIME ZONE 'Asia/Manila')::date
          AND stats.session_start BETWEEN
              (target_order.scheduled_departure AT TIME ZONE 'Asia/Manila') - INTERVAL '2 hours'
              AND COALESCE(target_order.scheduled_arrival AT TIME ZONE 'Asia/Manila',
                           (target_order.scheduled_departure AT TIME ZONE 'Asia/Manila') + INTERVAL '12 hours')
          AND haversine_distance(target_order.lat_long_origin, stats.start_coordinates) <= 300
          AND NOT EXISTS (
            SELECT 1 FROM travel_orders competing_order
             WHERE competing_order.id <> target_order.id
               AND competing_order.vehicle_id = stats.vehicle_id
               AND competing_order.status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
               AND competing_order.scheduled_departure::date = target_order.scheduled_departure::date
               AND competing_order.lat_long_origin IS NOT NULL
               AND haversine_distance(competing_order.lat_long_origin, stats.start_coordinates) <= 300
          )
     ), updated_telemetry AS (
       UPDATE gps_telemetry telemetry
          SET travel_order_id = validated.travel_order_id,
              driver_id = COALESCE(telemetry.driver_id, validated.driver_id)
         FROM validated
        WHERE telemetry.vehicle_id = validated.vehicle_id
          AND telemetry.active_trip_id = validated.active_trip_id
          AND telemetry.travel_order_id IS NULL
       RETURNING telemetry.id
     ), updated_sessions AS (
       UPDATE gps_trip_log_active_trips session
          SET start_time = LEAST(COALESCE(session.start_time, validated.session_start), validated.session_start),
              end_time = GREATEST(COALESCE(session.end_time, validated.session_end), validated.session_end)
         FROM validated
        WHERE session.gps_trip_log_id = validated.gps_trip_log_id
          AND session.active_trip_id = validated.active_trip_id
       RETURNING session.id
     )
     SELECT (SELECT COUNT(*)::integer FROM updated_sessions) AS sessions,
            (SELECT COUNT(*)::integer FROM updated_telemetry) AS points`,
  );
  return result.rows[0] ?? { sessions: 0, points: 0 };
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

function chooseOriginCoord(order: TravelOrderRow, defaultBaseCoord: string): string {
  return parseCoord(order.lat_long_origin) ? String(order.lat_long_origin) : defaultBaseCoord;
}

function isNearBase(coord: string | null, order: TravelOrderRow, defaultBaseCoord: string): { near: boolean; distanceM: number } {
  const originCoord = chooseOriginCoord(order, defaultBaseCoord);
  const originDistance = haversineDistance(coord, originCoord);
  const defaultBaseDistance = haversineDistance(coord, defaultBaseCoord);
  const distanceM = Math.min(originDistance, defaultBaseDistance);
  return { near: distanceM <= BASE_RADIUS_M, distanceM };
}

function findTravelOrderToStart(
  row: TelemetryRow,
  orders: TravelOrderRow[],
  defaultBaseCoord: string,
): TravelOrderRow | null {
  const rowMs = parseTime(row.recorded_at);
  const coord = coordinate(row);
  if (rowMs == null || !coord) return null;

  return orders
    .filter((order) => {
      const depMs = parseTime(order.scheduled_departure);
      if (depMs == null) return false;
      if (rowMs < depMs - DEPARTURE_WINDOW_MS || rowMs > depMs + DEPARTURE_WINDOW_MS) return false;
      return isNearBase(coord, order, defaultBaseCoord).near;
    })
    .sort((a, b) => Math.abs(rowMs - (parseTime(a.scheduled_departure) ?? rowMs)) - Math.abs(rowMs - (parseTime(b.scheduled_departure) ?? rowMs)))[0] ?? null;
}

function findTravelOrderForSession(
  row: TelemetryRow,
  orders: TravelOrderRow[],
  defaultBaseCoord: string,
): TravelOrderRow | null {
  const recordedAt = timestampToIso(row.recorded_at);
  const coord = coordinate(row);
  if (!recordedAt || !coord) return null;
  const eventDate = manilaDateFromTimestamp(recordedAt);

  return orders
    .filter((order) => order.travel_date === eventDate && isNearBase(coord, order, defaultBaseCoord).near)
    .sort((a, b) => {
      const rowMs = parseTime(row.recorded_at) ?? 0;
      return Math.abs(rowMs - (parseTime(a.scheduled_departure) ?? rowMs))
        - Math.abs(rowMs - (parseTime(b.scheduled_departure) ?? rowMs));
    })[0] ?? null;
}

function finalizeTripAtLastPoint(trip: LifecycleTrip, defaultBaseCoord: string): void {
  const lastPoint = trip.points[trip.points.length - 1];
  const lastRecordedAt = timestampToIso(lastPoint?.recorded_at) ?? trip.startedAt;
  const lastCoord = coordinate(lastPoint) ?? trip.lastCoord;
  const baseResult = isNearBase(lastCoord, trip.travelOrder, defaultBaseCoord);

  trip.status = 'COMPLETED';
  trip.endedAt = lastRecordedAt;
  trip.destinationCoord = lastCoord;
  trip.destinationName = lastPoint?.location_name || trip.lastLocationName || trip.destinationName;
  if (baseResult.near && trip.hadLeftBase) {
    trip.returnedToBaseAt = lastRecordedAt;
    trip.matchedOriginDistanceM = baseResult.distanceM;
  }
}

export function buildLifecycleTrips(rows: TelemetryRow[], orders: TravelOrderRow[]): LifecycleTrip[] {
  const fleetConfig = getFleetConfig();
  const defaultBaseCoord = `${fleetConfig.base.latitude},${fleetConfig.base.longitude}`;
  const completed: LifecycleTrip[] = [];
  let current: LifecycleTrip | null = null;
  let lastAtBase = new Map<string, boolean>();
  let previousActiveTripId: string | null = null;

  // An active_trip_id represents one continuous ignition session. A linked
  // travel order is valid for the whole session only when that session began
  // on the order's Manila travel date. This preserves genuine overnight
  // sessions while preventing a new next-day ignition session from inheriting
  // a stale travel-order link.
  const sessionStarts = new Map<string, { timestamp: number; travelDate: string }>();
  for (const row of rows) {
    if (!row.active_trip_id) continue;
    const recordedAt = timestampToIso(row.recorded_at);
    if (!recordedAt) continue;
    const timestamp = new Date(recordedAt).getTime();
    const existing = sessionStarts.get(row.active_trip_id);
    if (!Number.isFinite(timestamp) || (existing && existing.timestamp <= timestamp)) continue;
    sessionStarts.set(row.active_trip_id, {
      timestamp,
      travelDate: manilaDateFromTimestamp(recordedAt),
    });
  }

  const directlyLinkedOrder = (row: TelemetryRow): TravelOrderRow | null => {
    if (!row.travel_order_id) return null;
    const order = orders.find((candidate) =>
      candidate.id === row.travel_order_id
      && candidate.vehicle_id === row.vehicle_id
      && ['APPROVED', 'ACTIVE', 'COMPLETED'].includes(String(candidate.status).toUpperCase())
    ) ?? null;
    if (!order) return null;

    const recordedAt = timestampToIso(row.recorded_at);
    if (!recordedAt) return null;
    const sessionTravelDate = row.active_trip_id
      ? sessionStarts.get(row.active_trip_id)?.travelDate
      : manilaDateFromTimestamp(recordedAt);
    const orderTravelDate = order.travel_date
      ?? (order.scheduled_departure ? manilaDateFromTimestamp(timestampToIso(order.scheduled_departure) ?? '') : null);
    return sessionTravelDate && orderTravelDate === sessionTravelDate ? order : null;
  };

  for (const row of rows) {
    const recordedAt = timestampToIso(row.recorded_at);
    const coord = coordinate(row);
    if (!recordedAt || !coord) continue;

    const directOrder = directlyLinkedOrder(row);
    const newSession = Boolean(row.active_trip_id && row.active_trip_id !== previousActiveTripId);
    previousActiveTripId = row.active_trip_id ?? previousActiveTripId;
    const sessionOrder = !directOrder && newSession
      ? findTravelOrderForSession(row, orders, defaultBaseCoord)
      : null;
    const eventTravelDate = manilaDateFromTimestamp(recordedAt);
    const directOrderChanged = Boolean(current && directOrder && directOrder.id !== current.travelOrder.id);
    if (current && directOrder?.id === current.travelOrder.id) {
      current.authoritativeTravelOrderLink = true;
    }
    const inferredSessionChanged = Boolean(
      current
      && !directOrder
      && !current.authoritativeTravelOrderLink
      && newSession
      && (
        (sessionOrder && sessionOrder.id !== current.travelOrder.id)
        || (!sessionOrder && eventTravelDate > current.travelDate)
      ),
    );
    const authoritativeSessionChanged = Boolean(
      current
      && current.authoritativeTravelOrderLink
      && newSession
      && eventTravelDate > current.travelDate,
    );

    if (current && (directOrderChanged || inferredSessionChanged || authoritativeSessionChanged)) {
      finalizeTripAtLastPoint(current, defaultBaseCoord);
      if (directOrderChanged && directOrder) {
        current.anomalyReason = `Telemetry travel order changed to ${directOrder.to_number || directOrder.id}.`;
      }
      completed.push(current);
      current = null;
      lastAtBase = new Map();
    }

    if (current) {
      current.points.push(row);
      current.lastCoord = coord;
      current.lastLocationName = row.location_name ?? current.lastLocationName;
      current.maxSpeedKph = Math.max(current.maxSpeedKph, Number(row.speed_kmh) || 0);
      if (row.active_trip_id) current.activeTripIds.add(row.active_trip_id);

      const destinationDistance = current.travelOrder.lat_long_destination
        ? haversineDistance(coord, current.travelOrder.lat_long_destination)
        : Infinity;
      const baseResult = isNearBase(coord, current.travelOrder, defaultBaseCoord);
      const eventType = normalizeTelemetryEvent(row.event_type);

      if (!baseResult.near) {
        current.hadLeftBase = true;
      } else if (!current.destinationReachedAt && current.hadLeftBase) {
        console.log('[lifecycle-split] Returned to base before TO destination', {
          vehicleId: row.vehicle_id,
          segmentStart: current.startedAt,
          segmentEnd: row.recorded_at,
          points: current.points.length,
          sessions: current.activeTripIds.size,
        });
        current.status = 'COMPLETED';
        if (!current.authoritativeTravelOrderLink) {
          current.matchedToTravelOrder = false;
        } else {
          current.anomalyReason = 'Vehicle returned to base without reaching the planned destination.';
        }
        current.returnedToBaseAt = recordedAt;
        current.endedAt = recordedAt;
        current.destinationCoord = coord;
        current.destinationName = row.location_name || current.originName;
        current.matchedOriginDistanceM = baseResult.distanceM;
        completed.push(current);
        current = null;
        lastAtBase = new Map();
        continue;
      }

      if (!current.destinationReachedAt && destinationDistance <= DESTINATION_RADIUS_M) {
        current.destinationReachedAt = recordedAt;
        current.status = 'ARRIVED_AT_DESTINATION';
        current.arrivedCoordinates = coord;
        current.arrivedLocationName = row.location_name || null;
        current.matchedDestinationDistanceM = destinationDistance;
      } else if (current.destinationReachedAt && current.status === 'ARRIVED_AT_DESTINATION' && isMoving(row) && destinationDistance > DESTINATION_RADIUS_M) {
        current.status = 'RETURNING';
      }

      if (current.destinationReachedAt && baseResult.near && isMoving(row)) {
        current.status = 'COMPLETED';
        current.returnedToBaseAt = recordedAt;
        current.endedAt = recordedAt;
        current.destinationCoord = coord;
        current.destinationName = row.location_name || current.originName;
        current.matchedOriginDistanceM = baseResult.distanceM;
        completed.push(current);
        current = null;
        lastAtBase = new Map();
        continue;
      }

      if (eventType === 'IGNITION_OFF' && current.destinationReachedAt && !baseResult.near) {
        current.status = 'PAUSED_AWAY_FROM_BASE';
        current.pausedAt = recordedAt;
        current.pauseLocation = coord;
        current.endedAt = null;
      } else if (eventType === 'IGNITION_ON' && current.status === 'PAUSED_AWAY_FROM_BASE') {
        const resumeDistance = haversineDistance(coord, current.pauseLocation);
        if (resumeDistance <= PAUSE_RESUME_RADIUS_M) {
          current.status = 'RETURNING';
          current.resumedAt = recordedAt;
        }
      }
      continue;
    }

    for (const order of orders) {
      lastAtBase.set(order.id, isNearBase(coord, order, defaultBaseCoord).near);
    }

    if (!isTripStartSignal(row)) continue;
    const order: TravelOrderRow | null = directOrder
      ?? sessionOrder
      ?? findTravelOrderToStart(row, orders, defaultBaseCoord);
    if (!order || (!directOrder && !lastAtBase.get(order.id))) continue;

    const originCoord = coord;
    current = {
      travelOrder: order,
      matchedToTravelOrder: true,
      status: 'OUTBOUND',
      hadLeftBase: !isNearBase(coord, order, defaultBaseCoord).near,
      startedAt: recordedAt,
      endedAt: null,
      destinationReachedAt: null,
      returnedToBaseAt: null,
      pausedAt: null,
      pauseLocation: null,
      resumedAt: null,
      originCoord,
      destinationCoord: coord,
      originName: row.location_name || order.origin_location || fleetConfig.base.address,
      destinationName: row.location_name || order.destination_target || '',
      arrivedLocationName: null,
      arrivedCoordinates: null,
      lastCoord: coord,
      lastLocationName: row.location_name,
      maxSpeedKph: Number(row.speed_kmh) || 0,
      activeTripIds: new Set(row.active_trip_id ? [row.active_trip_id] : []),
      points: [row],
      matchedDestinationDistanceM: null,
      matchedOriginDistanceM: null,
      authoritativeTravelOrderLink: Boolean(directOrder),
      anomalyReason: null,
      travelDate: order.travel_date ?? tripDateFromTimestamp(recordedAt),
    };
  }

  if (current) completed.push(current);
  return completed;
}

async function upsertLifecycleTrip(trip: LifecycleTrip): Promise<'created' | 'updated'> {
  if (!trip.matchedToTravelOrder) {
    return upsertNoToTrip(trip);
  }

  const pool = getPool();
  const existing = trip.matchedToTravelOrder
    ? await pool.query<{ id: string }>(
      `SELECT id
         FROM gps_trip_logs
        WHERE travel_order_id = $1
          AND vehicle_id = $2
          AND COALESCE(to_status_auto, '') <> 'manual'
        ORDER BY departure_time_gps DESC
        LIMIT 1`,
      [trip.travelOrder.id, trip.travelOrder.vehicle_id],
    )
    : { rows: [] };

  const gpsDistanceKm = calculateRouteDistanceKm(trip.points);
  const endTime = trip.returnedToBaseAt ?? timestampToIso(trip.points[trip.points.length - 1]?.recorded_at) ?? trip.startedAt;
  const engineHours = Math.max(0, (new Date(endTime).getTime() - new Date(trip.startedAt).getTime()) / 3600000);
  const tripStatusGps = trip.status === 'COMPLETED' ? 'completed' : trip.destinationReachedAt ? 'arrived' : 'en-route';
  // gps_trip_logs.active_trip_id is a legacy single-session field. Lifecycle
  // trips use gps_trip_log_active_trips because one physical session can span
  // multiple logical trips, and some databases still have a unique index here.
  const primaryActiveTripId = null;
  const anomalyFlag = !trip.matchedToTravelOrder || Boolean(trip.anomalyReason);
  const notes = trip.anomalyReason ?? (!trip.matchedToTravelOrder
    ? 'Vehicle completed trip without matching approved travel order.'
    : trip.status === 'PAUSED_AWAY_FROM_BASE'
      ? 'Trip paused away from base'
      : null);
  const travelOrderId = trip.matchedToTravelOrder ? trip.travelOrder.id : null;
  const driverId = trip.matchedToTravelOrder ? trip.travelOrder.driver_id : trip.points[0]?.driver_id ?? null;
  const toStatusAuto = trip.matchedToTravelOrder ? 'matched' : 'no_to';

  let gpsTripLogId = existing.rows[0]?.id ?? null;
  let status: 'created' | 'updated' = 'updated';
  if (gpsTripLogId) {
    // Only freeze destination/end fields once the lifecycle reaches a terminal
    // state. Otherwise, keep the original TO destination/coords on the log;
    // live tracking is handled by coordinates_destination updates from the
    // telemetry-driven path. This avoids showing a live mid-route location
    // as the trip End address in the modal.
    const settled = ['ARRIVED_AT_DESTINATION', 'COMPLETED', 'PAUSED_AWAY_FROM_BASE'].includes(trip.status);
    // When the lifecycle is still en-route (not settled), explicitly clear
    // end-state fields so the next lifecycle rebuild won't preserve stale
    // "destination/arrival" values from previous syncs. When settled, write
    // the terminal values.
    await pool.query(
      `UPDATE gps_trip_logs
          SET driver_id = COALESCE($3, driver_id),
              travel_order_id = $2,
              origin_gps_start_point = $4,
              destination_gps_end_point = CASE WHEN $5::boolean THEN $6 ELSE NULL END,
              coordinates_origin = $7,
              coordinates_destination = CASE WHEN $5::boolean THEN $8 ELSE NULL END,
              departure_time_gps = $9,
              arrival_time_gps = CASE WHEN $5::boolean THEN $10::timestamptz ELSE NULL END,
              gps_distance_km = $11,
              engine_hours = $12,
              max_speed_kph = $13,
              trip_status_gps = $14,
              to_status_auto = $27,
              anomaly_flag = $15,
              notes_remarks = COALESCE($16, notes_remarks),
              active_trip_id = $17,
              trip_type = 'OUTBOUND',
              destination_verified = $18,
              business_trip_status = $19,
              destination_reached_at = $20,
              returned_to_base_at = $21,
              paused_at = $22,
              pause_location = $23,
              resumed_at = $24,
              matched_destination_distance_m = $25,
              matched_origin_distance_m = $26,
              arrived_location_name = $28,
              arrived_coordinates = $29,
              trip_date = $30::date
        WHERE id = $1`,
      [
        gpsTripLogId,
        travelOrderId,
        driverId,
        trip.originName,
        settled,
        trip.destinationName,
        trip.originCoord,
        trip.destinationCoord,
        trip.startedAt,
        trip.returnedToBaseAt,
        gpsDistanceKm,
        engineHours,
        trip.maxSpeedKph,
        tripStatusGps,
        anomalyFlag,
        notes,
        primaryActiveTripId,
        Boolean(trip.destinationReachedAt),
        trip.status,
        trip.destinationReachedAt,
        trip.returnedToBaseAt,
        trip.pausedAt,
        trip.pauseLocation,
        trip.resumedAt,
        trip.matchedDestinationDistanceM,
        trip.matchedOriginDistanceM,
        toStatusAuto,
        trip.arrivedLocationName,
        trip.arrivedCoordinates,
        trip.travelDate,
      ],
    );
  } else {
    status = 'created';
    const gpsRecordNo = await generateGpsRecordNo(trip.travelDate);
    const insertColumns = [
      'gps_record_no',
      'trip_date',
      'vehicle_id',
      'driver_id',
      'origin_gps_start_point',
      'destination_gps_end_point',
      'coordinates_origin',
      'coordinates_destination',
      'actual_route_road_taken',
      'departure_time_gps',
      'arrival_time_gps',
      'gps_distance_km',
      'engine_hours',
      'max_speed_kph',
      'trip_status_gps',
      'travel_order_id',
      'to_status_auto',
      'anomaly_flag',
      'notes_remarks',
      'active_trip_id',
      'trip_type',
      'destination_verified',
      'business_trip_status',
      'destination_reached_at',
      'returned_to_base_at',
      'paused_at',
      'pause_location',
      'resumed_at',
      'arrived_location_name',
      'arrived_coordinates',
      'matched_destination_distance_m',
      'matched_origin_distance_m',
    ];
    const insertValues = [
      gpsRecordNo,
      trip.travelDate,
      trip.travelOrder.vehicle_id,
      driverId,
      trip.originName,
      trip.destinationName,
      trip.originCoord,
      trip.destinationCoord,
      '',
      trip.startedAt,
      trip.returnedToBaseAt,
      gpsDistanceKm,
      engineHours,
      trip.maxSpeedKph,
      tripStatusGps,
      travelOrderId,
      toStatusAuto,
      anomalyFlag,
      notes,
      primaryActiveTripId,
      'OUTBOUND',
      Boolean(trip.destinationReachedAt),
      trip.status,
      trip.destinationReachedAt,
      trip.returnedToBaseAt,
      trip.pausedAt,
      trip.pauseLocation,
      trip.resumedAt,
      trip.arrivedLocationName,
      trip.arrivedCoordinates,
      trip.matchedDestinationDistanceM,
      trip.matchedOriginDistanceM,
    ];
    const insertPlaceholders = insertColumns.map((_, index) => `$${index + 1}`);
    const insertSql = `INSERT INTO gps_trip_logs
        (${insertColumns.join(', ')})
       VALUES (${insertPlaceholders.join(', ')})
       RETURNING id`;
    console.log({
      insertColumnCount: insertColumns.length,
      paramsLength: insertValues.length,
      placeholderCount: countSqlPlaceholders(insertSql),
    });
    const inserted = await pool.query<{ id: string }>(
      insertSql,
      insertValues,
    );
    gpsTripLogId = inserted.rows[0].id;
  }

  await pool.query(
    `DELETE FROM gps_trip_log_active_trips
      WHERE gps_trip_log_id = $1`,
    [gpsTripLogId],
  );

  for (const activeTripId of trip.activeTripIds) {
    const activePoints = trip.points.filter((point) => point.active_trip_id === activeTripId);
    let startTime = timestampToIso(activePoints[0]?.recorded_at);
    let endTimeForSession = timestampToIso(activePoints[activePoints.length - 1]?.recorded_at);
    if (trip.authoritativeTravelOrderLink && travelOrderId) {
      const fullSession = await pool.query<{ start_time: string | Date; end_time: string | Date }>(
        `SELECT MIN(recorded_at) AS start_time, MAX(recorded_at) AS end_time
           FROM gps_telemetry
          WHERE vehicle_id = $1
            AND active_trip_id = $2
          HAVING COUNT(DISTINCT travel_order_id) FILTER (WHERE travel_order_id IS NOT NULL) <= 1
             AND BOOL_AND(travel_order_id IS NULL OR travel_order_id = $3)`,
        [trip.travelOrder.vehicle_id, activeTripId, travelOrderId],
      );
      if (fullSession.rows[0]) {
        startTime = timestampToIso(fullSession.rows[0].start_time) ?? startTime;
        endTimeForSession = timestampToIso(fullSession.rows[0].end_time) ?? endTimeForSession;
      }
    }
    await pool.query(
      `INSERT INTO gps_trip_log_active_trips
         (gps_trip_log_id, active_trip_id, start_time, end_time)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (gps_trip_log_id, active_trip_id)
       DO UPDATE SET
         start_time = LEAST(COALESCE(gps_trip_log_active_trips.start_time, EXCLUDED.start_time), EXCLUDED.start_time),
         end_time = GREATEST(COALESCE(gps_trip_log_active_trips.end_time, EXCLUDED.end_time), EXCLUDED.end_time)`,
      [gpsTripLogId, activeTripId, startTime, endTimeForSession],
    );
    await pool.query(
      `UPDATE gps_telemetry
          SET driver_id = COALESCE(driver_id, $1)
        WHERE vehicle_id = $2
          AND active_trip_id = $3
          AND ($4::timestamptz IS NULL OR recorded_at >= $4::timestamptz)
          AND ($5::timestamptz IS NULL OR recorded_at <= $5::timestamptz)`,
      [driverId, trip.travelOrder.vehicle_id, activeTripId, startTime, endTimeForSession],
    );
  }

  await pool.query(
    `WITH bounded_route AS (
       SELECT g.id,
              g.trip_status_gps,
              to_.lat_long_origin AS planned_origin_coordinates,
              (ARRAY_AGG(gt.recorded_at ORDER BY gt.recorded_at ASC))[1] AS first_at,
              (ARRAY_AGG(gt.location_name ORDER BY gt.recorded_at ASC))[1] AS first_address,
              (ARRAY_AGG(CONCAT(gt.latitude, ',', gt.longitude) ORDER BY gt.recorded_at ASC))[1] AS first_coordinates,
              (ARRAY_AGG(gt.recorded_at ORDER BY gt.recorded_at DESC))[1] AS last_at,
              (ARRAY_AGG(gt.location_name ORDER BY gt.recorded_at DESC))[1] AS last_address,
              (ARRAY_AGG(CONCAT(gt.latitude, ',', gt.longitude) ORDER BY gt.recorded_at DESC))[1] AS last_coordinates
         FROM gps_trip_logs g
         JOIN travel_orders to_ ON to_.id = g.travel_order_id
         JOIN gps_trip_log_active_trips session ON session.gps_trip_log_id = g.id
         JOIN gps_telemetry gt
           ON gt.vehicle_id = g.vehicle_id
          AND gt.active_trip_id = session.active_trip_id
          AND (session.start_time IS NULL OR gt.recorded_at >= session.start_time)
          AND (session.end_time IS NULL OR gt.recorded_at <= session.end_time)
        WHERE g.id = $1
          AND gt.latitude IS NOT NULL
          AND gt.longitude IS NOT NULL
        GROUP BY g.id, to_.lat_long_origin
     ), canonical AS (
       SELECT route.*,
              CASE WHEN route.planned_origin_coordinates IS NULL THEN NULL
                   ELSE haversine_distance(route.planned_origin_coordinates, route.last_coordinates)
              END AS end_distance_from_origin_m
         FROM bounded_route route
     )
     UPDATE gps_trip_logs g
        SET origin_gps_start_point = COALESCE(canonical.first_address, g.origin_gps_start_point),
            coordinates_origin = canonical.first_coordinates,
            departure_time_gps = canonical.first_at,
            destination_gps_end_point = COALESCE(canonical.last_address, g.destination_gps_end_point),
            coordinates_destination = canonical.last_coordinates,
            arrival_time_gps = CASE WHEN LOWER(canonical.trip_status_gps) = 'completed' THEN canonical.last_at ELSE g.arrival_time_gps END,
            returned_to_base_at = CASE
              WHEN LOWER(canonical.trip_status_gps) = 'completed' AND canonical.end_distance_from_origin_m <= $2
              THEN canonical.last_at ELSE g.returned_to_base_at END,
            matched_origin_distance_m = canonical.end_distance_from_origin_m
       FROM canonical
      WHERE g.id = canonical.id`,
    [gpsTripLogId, BASE_RADIUS_M],
  );

  return status;
}

async function upsertNoToTrip(trip: LifecycleTrip): Promise<'created' | 'updated'> {
  const pool = getPool();
  const gpsDistanceKm = calculateRouteDistanceKm(trip.points);
  const endTime = trip.returnedToBaseAt ?? timestampToIso(trip.points[trip.points.length - 1]?.recorded_at) ?? trip.startedAt;
  const engineHours = Math.max(0, (new Date(endTime).getTime() - new Date(trip.startedAt).getTime()) / 3600000);
  const driverId = trip.points[0]?.driver_id ?? trip.travelOrder.driver_id ?? null;
  const anomalyReason = 'Vehicle completed trip without matching approved travel order.';

  const activeTripIdArray = Array.from(trip.activeTripIds);
  const existing = await pool.query<{ id: string }>(
    `SELECT n.id
       FROM gps_no_to_logs n
      WHERE n.vehicle_id = $1
        AND n.trip_date = $2::date
        AND n.active_trip_id = ANY($3::uuid[])
        AND n.departure_time IS NOT DISTINCT FROM $4::timestamp
      ORDER BY n.created_at ASC
      LIMIT 1`,
    [
      trip.travelOrder.vehicle_id,
      tripDateFromTimestamp(trip.startedAt),
      activeTripIdArray,
      trip.startedAt,
    ],
  );

  let noToLogId = existing.rows[0]?.id ?? null;
  let status: 'created' | 'updated' = noToLogId ? 'updated' : 'created';

  if (noToLogId) {
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
              anomaly_reason = $12
        WHERE id = $1`,
      [
        noToLogId,
        driverId,
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
      ],
    );
  } else {
    const noToRecordNo = await generateNoToRecordNo(trip.startedAt);
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO gps_no_to_logs
         (no_to_record_no, vehicle_id, driver_id, trip_date,
          origin_address, origin_coordinates, destination_address, destination_coordinates,
          departure_time, arrival_time, distance_km, engine_hours, max_speed_kph,
          status, anomaly_flag, anomaly_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz AT TIME ZONE 'UTC',$10::timestamptz AT TIME ZONE 'UTC',$11,$12,$13,'unmatched',true,$14)
       RETURNING id`,
      [
        noToRecordNo,
        trip.travelOrder.vehicle_id,
        driverId,
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
        anomalyReason,
      ],
    );
    noToLogId = inserted.rows[0].id;
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
          SET travel_order_id = NULL,
              driver_id = COALESCE(driver_id, $2)
        WHERE vehicle_id = $1
          AND active_trip_id = $3
          AND ($4::timestamptz IS NULL OR recorded_at >= $4::timestamptz)
          AND ($5::timestamptz IS NULL OR recorded_at <= $5::timestamptz)`,
      [trip.travelOrder.vehicle_id, driverId, activeTripId, startTime, endTimeForSession],
    );
  }

  return status;
}

export async function syncBusinessTripLogsFromTelemetry(): Promise<{
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}> {
  const pool = getPool();
  const travelDateSync = await syncTravelDateGpsLogs();
  await syncCompleteTravelOrderSessions();
  const [telemetryResult, ordersResult] = await Promise.all([
    pool.query<TelemetryRow>(
      `SELECT id, vehicle_id, plate_number, event_type, latitude, longitude,
              speed_kmh, location_name, recorded_at, active_trip_id, driver_id,
              travel_order_id
         FROM gps_telemetry
        WHERE recorded_at IS NOT NULL
          AND vehicle_id IS NOT NULL
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
        ORDER BY vehicle_id, recorded_at ASC`,
    ),
    pool.query<TravelOrderRow>(
      `SELECT id, vehicle_id, driver_id, status, scheduled_departure,
              scheduled_arrival, lat_long_origin, lat_long_destination,
              origin_location, destination_target, to_number,
              scheduled_departure::date::text AS travel_date
         FROM travel_orders
        WHERE vehicle_id IS NOT NULL
          AND status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
        ORDER BY vehicle_id, scheduled_departure ASC`,
    ),
  ]);

  const ordersByVehicle = new Map<string, TravelOrderRow[]>();
  for (const order of ordersResult.rows) {
    if (!ordersByVehicle.has(order.vehicle_id)) ordersByVehicle.set(order.vehicle_id, []);
    ordersByVehicle.get(order.vehicle_id)!.push(order);
  }

  const rowsByVehicle = new Map<string, TelemetryRow[]>();
  for (const row of telemetryResult.rows) {
    if (!rowsByVehicle.has(row.vehicle_id)) rowsByVehicle.set(row.vehicle_id, []);
    rowsByVehicle.get(row.vehicle_id)!.push(row);
  }

  let created = travelDateSync.created;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const [vehicleId, rows] of rowsByVehicle) {
    const orders = ordersByVehicle.get(vehicleId) ?? [];
    if (orders.length === 0) {
      skipped += rows.length;
      continue;
    }

    const trips = buildLifecycleTrips(rows, orders);
    if (trips.length === 0) {
      skipped += rows.length;
      continue;
    }

    for (const trip of trips) {
      // No-TO persistence is owned exclusively by noToLifecycleService. Having
      // both lifecycle services write gps_no_to_logs in the same scheduler
      // cycle exposes partially rebuilt rows and lets the TO-oriented state
      // machine overwrite the canonical fleet-base completion result.
      if (!trip.matchedToTravelOrder) {
        skipped += trip.points.length;
        continue;
      }

      try {
        const result = await upsertLifecycleTrip(trip);
        if (result === 'created') created += 1;
        else updated += 1;
      } catch (error) {
        failed += 1;
        console.error('[business-trip-sync] failed to persist lifecycle trip:', (error as Error).message);
      }
    }
  }

  console.log(`[business-trip-sync] Done: ${created} created, ${updated} updated, ${skipped} skipped, ${failed} failed`);
  return { created, updated, skipped, failed };
}

/**
 * Sync No-TO logs from telemetry.
 *
 * Scans telemetry for vehicle movement segments (based on ignition cycles)
 * that do NOT match any approved/active/completed travel order.
 * For each unmatched segment, it creates or updates a gps_no_to_logs entry.
 *
 * This is idempotent: uses vehicle_id + active_trip_id + departure_time to
 * detect existing no-TO logs and avoids duplicates.
 *
 * @returns Summary of created, updated, skipped, failed counts.
 */
export async function syncNoToLogsFromTelemetry(): Promise<{
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}> {
  const pool = getPool();
  console.log('[no-to-sync] Starting...');

  // ── Fetch telemetry rows grouped by ignition cycles ─────────
  // We need the full telemetry stream with coordinates to detect
  // base-to-base movement loops.
  const telemetryResult = await pool.query<TelemetryRow>(
    `SELECT id, vehicle_id, plate_number, event_type, latitude, longitude,
            speed_kmh, location_name, recorded_at, active_trip_id, driver_id,
            travel_order_id
       FROM gps_telemetry
      WHERE recorded_at IS NOT NULL
        AND vehicle_id IS NOT NULL
        AND active_trip_id IS NOT NULL
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      ORDER BY vehicle_id, recorded_at ASC`,
  );

  // ── Fetch all vehicles ─────────────────────────────────────
  const vehicleResult = await pool.query<{ id: string; plate_number: string }>(
    `SELECT id, plate_number FROM vehicles WHERE id IS NOT NULL`,
  );
  const allVehicleIds = new Set(vehicleResult.rows.map((v) => v.id));

  // ── Fetch all travel orders for matching ────────────────────
  const ordersResult = await pool.query<TravelOrderRow>(
    `SELECT id, vehicle_id, driver_id, status, scheduled_departure,
            scheduled_arrival, lat_long_origin, lat_long_destination,
            origin_location, destination_target, to_number
       FROM travel_orders
      WHERE vehicle_id IS NOT NULL
        AND scheduled_departure IS NOT NULL
        AND status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
      ORDER BY vehicle_id, scheduled_departure ASC`,
  );

  const ordersByVehicle = new Map<string, TravelOrderRow[]>();
  for (const order of ordersResult.rows) {
    if (!ordersByVehicle.has(order.vehicle_id)) ordersByVehicle.set(order.vehicle_id, []);
    ordersByVehicle.get(order.vehicle_id)!.push(order);
  }

  // ── Safe date parser ────────────────────────────────────────
  function toIsoOrNull(value: unknown): string | null {
    if (!value) return null;

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }

    const raw = String(value).trim();

    const direct = new Date(raw);
    if (!Number.isNaN(direct.getTime())) {
      return direct.toISOString();
    }

    const normalized = raw.includes('T')
      ? raw
      : raw.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T');

    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }

    console.warn('[no-to-sync] Invalid recorded_at value', { raw });
    return null;
  }

  // ── Build excluded active_trip_id set (TO-linked sessions) ──
  // Any active_trip_id that has at least one telemetry row with
  // travel_order_id IS NOT NULL is excluded from no-TO logs.
  const excludedActiveTripIds = new Set<string>();

  // Source 1: telemetry rows with direct TO link
  const toLinkedTelemetry = await pool.query<{ active_trip_id: string }>(
    `SELECT DISTINCT active_trip_id
       FROM gps_telemetry
      WHERE active_trip_id IS NOT NULL
        AND travel_order_id IS NOT NULL`,
  );
  for (const row of toLinkedTelemetry.rows) {
    excludedActiveTripIds.add(row.active_trip_id);
  }

  // Source 2: gps_trip_log_active_trips joined to TO-linked gps_trip_logs
  const toLinkedSessions = await pool.query<{ active_trip_id: string }>(
    `SELECT DISTINCT glat.active_trip_id
       FROM gps_trip_log_active_trips glat
       JOIN gps_trip_logs gl ON gl.id = glat.gps_trip_log_id
      WHERE gl.travel_order_id IS NOT NULL`,
  );
  for (const row of toLinkedSessions.rows) {
    excludedActiveTripIds.add(row.active_trip_id);
  }

  console.log('[no-to-sync] Excluding TO-linked active trips', {
    excludedActiveTripCount: excludedActiveTripIds.size,
  });

  // ── Delete stale no-TO logs whose active_trip_id is now TO-linked ──
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
  console.log('[no-to-sync] Deleted stale TO-linked no-TO logs', {
    deleted: deleteResult.rowCount,
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  // ── Group telemetry by vehicle_id + active_trip_id + trip_date ──
  type TelemetrySegment = {
    vehicleId: string;
    plateNumber: string;
    activeTripId: string;
    driverId: string | null;
    points: TelemetryRow[];
    firstRecordedAt: string;
    lastRecordedAt: string;
  };

  const groupedSegments = new Map<string, TelemetrySegment>();
  for (const row of telemetryResult.rows) {
    if (!row.active_trip_id || !row.vehicle_id) continue;

    // Skip any telemetry row that directly has a travel_order_id
    if ((row as any).travel_order_id) {
      continue;
    }

    // Skip any telemetry row whose active_trip_id belongs to a TO-linked session
    if (excludedActiveTripIds.has(row.active_trip_id)) {
      continue;
    }

    const recordedAtIso = toIsoOrNull(row.recorded_at);
    if (!recordedAtIso) {
      failed += 1;
      continue;
    }
    console.log('[no-to-sync] date parse', {
      raw: row.recorded_at,
      parsed: recordedAtIso,
    });
    const tripDate = recordedAtIso.slice(0, 10);
    const compositeKey = `${row.vehicle_id}::${row.active_trip_id}::${tripDate}`;

    if (!groupedSegments.has(compositeKey)) {
      groupedSegments.set(compositeKey, {
        vehicleId: row.vehicle_id,
        plateNumber: row.plate_number ?? '',
        activeTripId: row.active_trip_id,
        driverId: row.driver_id ?? null,
        points: [],
        firstRecordedAt: recordedAtIso,
        lastRecordedAt: recordedAtIso,
      });
    }
    const seg = groupedSegments.get(compositeKey)!;
    seg.points.push(row);
    if (recordedAtIso < seg.firstRecordedAt) seg.firstRecordedAt = recordedAtIso;
    if (recordedAtIso > seg.lastRecordedAt) seg.lastRecordedAt = recordedAtIso;
  }

  for (const [, segment] of groupedSegments) {
    try {
      const { vehicleId, activeTripId, driverId, points } = segment;

      // ── Skip if vehicle not found ────────────────────────────
      if (!allVehicleIds.has(vehicleId)) {
        skipped += 1;
        continue;
      }

      // ── Check if this segment already has a matched TO (gps_trip_logs) ──
      const matchedTripLog = await pool.query<{ id: string }>(
        `SELECT id FROM gps_trip_logs
          WHERE vehicle_id = $1
            AND active_trip_id = $2
            AND travel_order_id IS NOT NULL
          LIMIT 1`,
        [vehicleId, activeTripId],
      );
      if (matchedTripLog.rows.length > 0) {
        skipped += 1;
        continue;
      }

      // ── Check if this segment already has a no-TO log ────────
      // Use direct active_trip_id column lookup to avoid junction-table
      // race conditions (new active_trip_id not yet in junction table).
      const existingNoToLog = await pool.query<{ id: string }>(
        `SELECT n.id
           FROM gps_no_to_logs n
          WHERE n.vehicle_id = $1
            AND n.active_trip_id = $2
          LIMIT 1`,
        [vehicleId, activeTripId],
      );
      if (existingNoToLog.rows.length > 0) {
        // Update the existing no-TO log with latest data
        const existingId = existingNoToLog.rows[0].id;
        const originPoint = points[0];
        const destinationPoint = points[points.length - 1];
        const gpsDistanceKm = calculateRouteDistanceKm(points);
        const startMs = new Date(segment.firstRecordedAt).getTime();
        const endMs = new Date(segment.lastRecordedAt).getTime();
        const engineHours = Number.isFinite(startMs) && Number.isFinite(endMs)
          ? Math.max(0, (endMs - startMs) / 3600000)
          : 0;
        const maxSpeedKph = points.reduce((max, p) => Math.max(max, Number(p.speed_kmh) || 0), 0);
        const tripDate = new Date(segment.firstRecordedAt).toISOString().slice(0, 10);
        console.log({ tripDate, typeofTripDate: typeof tripDate, firstRecordedAt: segment.firstRecordedAt });

        await pool.query(
          `UPDATE gps_no_to_logs
              SET origin_address = COALESCE($2, origin_address),
                  origin_coordinates = COALESCE($3, origin_coordinates),
                  destination_address = COALESCE($4, destination_address),
                  destination_coordinates = COALESCE($5, destination_coordinates),
                  departure_time = COALESCE($6::timestamptz AT TIME ZONE 'UTC', departure_time),
                  arrival_time = COALESCE($7::timestamptz AT TIME ZONE 'UTC', arrival_time),
                  distance_km = COALESCE($8, distance_km),
                  engine_hours = COALESCE($9, engine_hours),
                  max_speed_kph = COALESCE($10, max_speed_kph),
                  driver_id = COALESCE($11, driver_id),
                  status = CASE WHEN status = 'linked' THEN status ELSE 'unmatched' END,
                  anomaly_flag = true,
                  anomaly_reason = 'Vehicle completed trip without matching approved travel order.',
                  updated_at = current_timestamp
            WHERE id = $1`,
          [
            existingId,
            originPoint?.location_name ?? null,
            originPoint?.latitude != null && originPoint?.longitude != null
              ? `${originPoint.latitude},${originPoint.longitude}` : null,
            destinationPoint?.location_name ?? null,
            destinationPoint?.latitude != null && destinationPoint?.longitude != null
              ? `${destinationPoint.latitude},${destinationPoint.longitude}` : null,
            segment.firstRecordedAt,
            segment.lastRecordedAt,
            Number(gpsDistanceKm.toFixed(2)),
            Number(engineHours.toFixed(2)),
            Number(maxSpeedKph.toFixed(2)),
            driverId,
          ],
        );

        // Update or insert active trip session
        await pool.query(`DELETE FROM gps_no_to_log_active_trips WHERE gps_no_to_log_id = $1`, [existingId]);
        await pool.query(
          `INSERT INTO gps_no_to_log_active_trips
             (gps_no_to_log_id, active_trip_id, start_time, end_time)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (gps_no_to_log_id, active_trip_id) DO NOTHING`,
          [existingId, activeTripId, segment.firstRecordedAt, segment.lastRecordedAt],
        );

        updated += 1;
        continue;
      }

      // ── Determine if this is a genuine no-TO trip ────────────
      // A no-TO trip should have at least 2 points (start and end)
      // and show movement (ignition on, moving)
      const hasMovement = points.some((p) => Number(p.speed_kmh) > 0);
      const hasIgnitionOn = points.some((p) => {
        const eventType = String(p.event_type ?? '').toUpperCase().replace(/\s+ALERT$/, '').replace(/\s+/g, '_');
        return eventType === 'IGNITION_ON';
      });
      const hasIgnitionOff = points.some((p) => {
        const eventType = String(p.event_type ?? '').toUpperCase().replace(/\s+ALERT$/, '').replace(/\s+/g, '_');
        return eventType === 'IGNITION_OFF';
      });

      if (points.length < 2 || !hasMovement) {
        skipped += 1;
        continue;
      }

      // ── Create a no-TO log ───────────────────────────────────
      const originPoint = points[0];
      const destinationPoint = points[points.length - 1];
      const gpsDistanceKm = calculateRouteDistanceKm(points);
      const startMs = new Date(segment.firstRecordedAt).getTime();
      const endMs = new Date(segment.lastRecordedAt).getTime();
      const engineHours = Number.isFinite(startMs) && Number.isFinite(endMs)
        ? Math.max(0, (endMs - startMs) / 3600000)
        : 0;
      const maxSpeedKph = points.reduce((max, p) => Math.max(max, Number(p.speed_kmh) || 0), 0);
      const tripDate = new Date(segment.firstRecordedAt).toISOString().slice(0, 10);
      console.log({ tripDate, typeofTripDate: typeof tripDate, firstRecordedAt: segment.firstRecordedAt });

      const noToRecordNo = await generateNoToRecordNo(segment.firstRecordedAt);
      const insertResult = await pool.query<{ id: string }>(
        `INSERT INTO gps_no_to_logs
           (no_to_record_no, vehicle_id, driver_id, trip_date,
            origin_address, origin_coordinates, destination_address, destination_coordinates,
            departure_time, arrival_time, distance_km, engine_hours, max_speed_kph,
            status, anomaly_flag, anomaly_reason, active_trip_id, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
                 $9::timestamptz AT TIME ZONE 'UTC',
                 $10::timestamptz AT TIME ZONE 'UTC',
                 $11,$12,$13,
                 'unmatched',true,$14,$15,current_timestamp)
         ON CONFLICT (no_to_record_no) DO NOTHING
         RETURNING id`,
        [
          noToRecordNo,
          vehicleId,
          driverId,
          tripDate,
          originPoint?.location_name ?? null,
          originPoint?.latitude != null && originPoint?.longitude != null
            ? `${originPoint.latitude},${originPoint.longitude}` : null,
          destinationPoint?.location_name ?? null,
          destinationPoint?.latitude != null && destinationPoint?.longitude != null
            ? `${destinationPoint.latitude},${destinationPoint.longitude}` : null,
          segment.firstRecordedAt,
          segment.lastRecordedAt,
          Number(gpsDistanceKm.toFixed(2)),
          Number(engineHours.toFixed(2)),
          Number(maxSpeedKph.toFixed(2)),
          'Vehicle completed trip without matching approved travel order.',
          activeTripId,
        ],
      );

      const noToLogId = insertResult.rows[0]?.id;
      if (!noToLogId) {
        skipped += 1;
        continue;
      }

      // Insert active trip session
      await pool.query(
        `INSERT INTO gps_no_to_log_active_trips
           (gps_no_to_log_id, active_trip_id, start_time, end_time)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (gps_no_to_log_id, active_trip_id) DO NOTHING`,
        [noToLogId, activeTripId, segment.firstRecordedAt, segment.lastRecordedAt],
      );

      created += 1;
    } catch (error) {
      failed += 1;
      console.error('[no-to-sync] Error processing segment:', (error as Error).message);
    }
  }

  console.log(`[no-to-sync] Done: created=${created} updated=${updated} skipped=${skipped} failed=${failed}`);
  return { created, updated, skipped, failed };
}

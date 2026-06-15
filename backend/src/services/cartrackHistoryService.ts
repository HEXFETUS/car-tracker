// ── Cartrack History API Service ──────────────────────────────
//
// Fetches historical trip/tracking telemetry from the Cartrack API
// for a specific vehicle and date range, then transforms the raw
// response into GPS trip log records.

import { getPool } from '../db/db.js';
import { CARTRACK_USERNAME, CARTRACK_PASSWORD, CARTRACK_API_URL } from '../config/env.js';

// ── Types ──────────────────────────────────────────────────────

export interface CartrackHistoryPoint {
  start_timestamp?: string;
  end_timestamp?: string;
  start_time?: string;
  end_time?: string;
  startTime?: string;
  endTime?: string;
  event_time?: string;
  event_ts?: string;
  timestamp?: string;
  latitude?: number;
  longitude?: number;
  speed?: number;
  speed_kph?: number;
  ignition?: boolean | string | number;
  location?: string;
  location_name?: string;
  address?: string;
  street?: string;
  start_location?: string;
  end_location?: string;
  startLocation?: string;
  endLocation?: string;
  origin?: string;
  destination?: string;
  trip_distance?: number;
  tripDistance?: number;
  distance?: number;
  duration?: number;
  driving_time?: number;
  idling_time?: number;
  engine_hours?: number;
  engineHours?: number;
  odometer?: number;
  start_odometer?: number;
  end_odometer?: number;
  distance_km?: number;
  fuel_level?: number;
  fuelLevel?: number;
  [key: string]: unknown;
}

export interface TransformedTripData {
  departureTimeGps: string | null;
  arrivalTimeGps: string | null;
  gpsDistanceKm: number;
  engineHours: number;
  maxSpeedKph: number;
  originGpsStartPoint: string;
  destinationGpsEndPoint: string;
  actualRouteRoadTaken: string;
  tripStatus: string;
}

// ── Constants ─────────────────────────────────────────────────

const CARTRACK_TIMEOUT_MS = 20000;
const CARTRACK_RETRIES = 2;

// ── Helpers ───────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isConfigured(): boolean {
  return Boolean(CARTRACK_USERNAME && CARTRACK_PASSWORD && CARTRACK_API_URL);
}

function isRetriableError(error: unknown): boolean {
  const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code ||
    (error as { code?: string })?.code;
  if (!code) return false;
  return ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
    'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code);
}

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function firstPresent(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function clampNumeric(value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(value, max);
}

function normalizeBaseUrl(url: string): string {
  return url
    .replace(/\/+$/, '')
    .replace(/\/vehicles\/status$/i, '')
    .replace(/\/status$/i, '');
}

function dateTimeParams(dateStr: string): {
  fromIso: string;
  toIso: string;
  startTimestamp: string;
  endTimestamp: string;
} {
  return {
    fromIso: `${dateStr}T00:00:00+08:00`,
    toIso: `${dateStr}T23:59:59+08:00`,
    startTimestamp: `${dateStr} 00:00:00`,
    endTimestamp: `${dateStr} 23:59:59`,
  };
}

function appendQuery(url: string, params: Record<string, string | number>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.set(key, String(value));
  }
  return `${url}?${search.toString()}`;
}

function extractArrayPayload(data: unknown): CartrackHistoryPoint[] {
  if (Array.isArray(data)) return data as CartrackHistoryPoint[];
  if (!data || typeof data !== 'object') return [];

  const obj = data as Record<string, unknown>;
  const keys = ['data', 'points', 'results', 'items', 'history', 'tracking', 'positions', 'records', 'trips', 'events'];
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value)) return value as CartrackHistoryPoint[];
  }

  for (const value of Object.values(obj)) {
    if (Array.isArray(value) && value.length > 0) return value as CartrackHistoryPoint[];
    if (value && typeof value === 'object') {
      const nested = extractArrayPayload(value);
      if (nested.length > 0) return nested;
    }
  }

  return [];
}

function looksLikeTripSummary(point: CartrackHistoryPoint): boolean {
  return Boolean(firstPresent(
    point.start_timestamp,
    point.end_timestamp,
    point.start_time,
    point.end_time,
    point.startTime,
    point.endTime,
    point.start_location,
    point.end_location,
    point.trip_distance,
    point.tripDistance,
  ));
}

// ── Fetch with timeout & retry ────────────────────────────────

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = CARTRACK_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function getAuthHeader(): string {
  const raw = `${CARTRACK_USERNAME}:${CARTRACK_PASSWORD}`;
  const encoded = Buffer.from(raw).toString('base64');
  return `Basic ${encoded}`;
}

// ── Vehicle Key Helpers (mirrors tracker.js) ──────────────────

const VEHICLE_ID_KEYS = ['vehicle_id', 'vehicleId', 'id', 'unit_id', 'unitId', 'asset_id', 'assetId', 'device_id', 'deviceId', 'registration'];
const PLATE_NUMBER_KEYS = ['registration', 'plate_number', 'plate', 'reg', 'license_plate', 'vehicle_name', 'vehicleName', 'name', 'label'];
const VEHICLE_LIST_KEYS = ['data', 'vehicles', 'vehicle', 'items', 'results', 'fleet', 'assets', 'units'];

interface RawVehicle {
  [key: string]: unknown;
}

function firstKey(data: RawVehicle | null | undefined, keys: string[]): unknown {
  if (!data || typeof data !== 'object') return null;
  for (const key of keys) {
    if (data[key] !== undefined && data[key] !== null) return data[key];
  }
  return null;
}

function getVehicleId(vehicle: RawVehicle): unknown {
  return firstKey(vehicle, VEHICLE_ID_KEYS);
}

function extractPlateNumber(vehicle: RawVehicle): string {
  return String(firstKey(vehicle, PLATE_NUMBER_KEYS) || getVehicleId(vehicle) || '').trim().toUpperCase();
}

function looksLikeVehicle(record: unknown): boolean {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  const hasIdentity = firstKey(record as RawVehicle, [...VEHICLE_ID_KEYS, ...PLATE_NUMBER_KEYS]) !== null;
  if (!hasIdentity) return false;
  return !VEHICLE_LIST_KEYS.some((key) => Array.isArray((record as RawVehicle)[key]));
}

function extractVehicles(payload: unknown): RawVehicle[] {
  const vehicles: RawVehicle[] = [];
  const seen = new Set<string>();

  function scan(value: unknown): void {
    if (Array.isArray(value)) return value.forEach(scan);
    if (!value || typeof value !== 'object') return;

    const obj = value as Record<string, unknown>;

    for (const key of VEHICLE_LIST_KEYS) {
      if (obj[key] !== undefined && obj[key] !== null) scan(obj[key]);
    }

    if (looksLikeVehicle(obj)) {
      const vid = String(getVehicleId(obj) || extractPlateNumber(obj) || Math.random());
      if (!seen.has(vid)) {
        seen.add(vid);
        vehicles.push(obj);
      }
      return;
    }

    for (const nested of Object.values(obj)) {
      if (nested && typeof nested === 'object') scan(nested);
    }
  }

  scan(payload);
  return vehicles;
}

// ── Fetch Fleet Data (reuses tracker.js extraction logic) ─────

export async function getFleetVehicles(): Promise<RawVehicle[]> {
  if (!isConfigured()) return [];

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= CARTRACK_RETRIES; attempt += 1) {
    try {
      const response = await fetchWithTimeout(CARTRACK_API_URL, {
        headers: { authorization: getAuthHeader() },
      });

      if (!response.ok) {
        throw new Error(`Cartrack fleet API error ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();
      const vehicles = extractVehicles(data);

      if (vehicles.length > 0) {
        console.log(`Cartrack fleet API returned ${vehicles.length} vehicles`);
        return vehicles;
      }

      // If no vehicles extracted, log a sample for debugging
      const sample = JSON.stringify(data).substring(0, 500);
      console.log('Cartrack fleet response (no vehicles extracted):', sample);
      return [];
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!isRetriableError(error) || attempt >= CARTRACK_RETRIES) break;
      await delay(1000 * (attempt + 1));
    }
  }

  console.error('Cartrack fleet API failed:', lastError?.message);
  return [];
}

// ── Resolve Cartrack Unit ID from Plate Number ────────────────

export async function resolveCartrackUnitId(
  plateNumber: string,
): Promise<{ unitId: string; vehicleId: string; plateNumber: string } | null> {
  const upperPlate = plateNumber.trim().toUpperCase();
  if (!upperPlate) return null;

  // Step 1: Try the fleet API to find the Cartrack unit ID
  const vehicles = await getFleetVehicles();
  for (const vehicle of vehicles) {
    const vPlate = extractPlateNumber(vehicle);
    if (vPlate === upperPlate) {
      // Extract any ID field that could be the unit identifier
      const rawId = firstKey(vehicle, VEHICLE_ID_KEYS);
      if (rawId !== null && rawId !== undefined) {
        const unitId = String(rawId);
        console.log(`Resolved Cartrack unit ID ${unitId} for plate ${upperPlate} via fleet API`);
        return { unitId, vehicleId: unitId, plateNumber: upperPlate };
      }
    }
  }

  // Step 2: Fallback — query the database for the vehicle UUID
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM vehicles WHERE UPPER(plate_number) = $1 LIMIT 1`,
    [upperPlate],
  );

  if (result.rows.length > 0) {
    const dbId = result.rows[0].id;
    console.log(`Using database vehicle ID ${dbId} for plate ${upperPlate} (Cartrack fleet API did not match)`);
    return { unitId: dbId, vehicleId: dbId, plateNumber: upperPlate };
  }

  return null;
}

// ── Fetch Historical Tracking Data from Cartrack ──────────────

/**
 * Fetch the current fleet status snapshot for a specific vehicle.
 * The fleet status API returns the latest known data point for each
 * vehicle (odometer, speed, ignition, location, etc.).
 *
 * This is used as a fallback when the dedicated history API is not
 * available, since the Cartrack fleet API may not expose a simple
 * history endpoint at the configured base URL.
 */
async function fetchVehicleCurrentStatus(
  unitId: string,
): Promise<CartrackHistoryPoint | null> {
  if (!isConfigured()) return null;

  try {
    // The fleet status endpoint is already configured in CARTRACK_API_URL
    // We need to filter the response for just our vehicle
    const response = await fetchWithTimeout(CARTRACK_API_URL, {
      headers: { authorization: getAuthHeader() },
    });

    if (!response.ok) return null;

    const data = await response.json();
    const vehicles = extractVehicles(data);

    const vehicle = vehicles.find((v) => {
      const vid = String(firstKey(v, VEHICLE_ID_KEYS) ?? '');
      return vid === unitId;
    });

    if (!vehicle) return null;

    // Extract nested location data
    const locationData = (vehicle.location && typeof vehicle.location === 'object')
      ? (vehicle.location as Record<string, unknown>)
      : null;

    return {
      event_time: String(firstKey(vehicle, ['event_ts', 'event_time', 'timestamp']) ?? ''),
      event_ts: String(firstKey(vehicle, ['event_ts', 'event_time', 'timestamp']) ?? ''),
      speed: toNumber(firstKey(vehicle, ['speed', 'road_speed']), 0),
      odometer: toNumber(firstKey(vehicle, ['odometer']), 0),
      engineHours: toNumber(firstKey(vehicle, ['clock', 'engine_hours', 'engineHours']), 0),
      ignition: toNumber(firstKey(vehicle, ['ignition']), 0),
      location: locationData ? String(firstKey(locationData, ['position_description', 'address', 'location_name']) ?? '') : '',
      location_name: locationData ? String(firstKey(locationData, ['position_description', 'address', 'location_name']) ?? '') : '',
      address: locationData ? String(firstKey(locationData, ['position_description', 'address']) ?? '') : '',
      latitude: locationData ? toNumber(firstKey(locationData, ['latitude', 'lat']), 0) : 0,
      longitude: locationData ? toNumber(firstKey(locationData, ['longitude', 'lng', 'lon']), 0) : 0,
    };
  } catch {
    return null;
  }
}

export async function fetchCartrackVehicleHistory(
  unitId: string,
  dateStr: string,
  plateNumber?: string,
): Promise<CartrackHistoryPoint[]> {
  if (!isConfigured()) return [];

  const { fromIso, toIso, startTimestamp, endTimestamp } = dateTimeParams(dateStr);
  const baseUrl = normalizeBaseUrl(CARTRACK_API_URL);
  const registration = encodeURIComponent((plateNumber || unitId).trim().toUpperCase());

  // Cartrack's Fleet API exposes historical trip summaries by registration
  // and full breadcrumb history through vehicle events. Keep legacy guessed
  // patterns last for tenants that still expose older routes.
  const historyEndpoints: string[] = [
    appendQuery(`${baseUrl}/trips/${registration}`, {
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp,
    }),
    appendQuery(`${baseUrl}/trips/${registration}`, {
      from: fromIso,
      to: toIso,
    }),
    appendQuery(`${baseUrl}/vehicles/${registration}/events`, {
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp,
    }),
    appendQuery(`${baseUrl}/vehicles/${registration}/events`, {
      from: fromIso,
      to: toIso,
    }),
    appendQuery(`${baseUrl}/trips`, {
      registration: plateNumber || unitId,
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp,
    }),
    appendQuery(`${baseUrl}/vehicles/${unitId}/history`, { from: fromIso, to: toIso }),
    `${baseUrl}/vehicles/${unitId}/trips/${dateStr}`,
    appendQuery(`${baseUrl}/vehicles/${unitId}/trips`, { from: fromIso, to: toIso }),
    appendQuery(`${baseUrl}/history/${unitId}`, { from: fromIso, to: toIso }),
    appendQuery(`${baseUrl}/tracking/history`, { vehicleId: unitId, from: fromIso, to: toIso }),
    appendQuery(`${baseUrl}/reports/tracking/${unitId}`, { from: fromIso, to: toIso }),
  ];

  let lastError: Error | null = null;

  for (const endpoint of historyEndpoints) {
    for (let attempt = 0; attempt <= CARTRACK_RETRIES; attempt += 1) {
      try {
        const response = await fetchWithTimeout(endpoint, {
          headers: { authorization: getAuthHeader() },
        });

        if (!response.ok) {
          if (response.status === 404 || response.status === 400 || response.status === 405) break;
          continue;
        }

        const data = await response.json();
        const points = extractArrayPayload(data);
        if (points.length > 0) {
          console.log(`Cartrack history endpoint succeeded: ${endpoint}`);
          return points;
        }

        return []; // Endpoint worked but no data
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!isRetriableError(error) || attempt >= CARTRACK_RETRIES) break;
        await delay(1000 * (attempt + 1));
      }
    }
  }

  // Fallback: use current fleet status snapshot
  console.log(`History API unavailable for unit ${unitId}, falling back to current fleet status`);
  const currentStatus = await fetchVehicleCurrentStatus(unitId);
  if (currentStatus) {
    console.log(`Using current fleet status for unit ${unitId} as fallback`);
    return [currentStatus];
  }

  if (lastError) {
    console.error('Cartrack history endpoints failed:', lastError.message);
  }

  return [];
}

// ── Transform Cartrack History Points to Trip Records ─────────

export function transformHistoryToTrip(
  points: CartrackHistoryPoint[],
  plateNumber: string,
  dateStr: string,
): TransformedTripData {
  if (!points || points.length === 0) {
    return {
      departureTimeGps: null,
      arrivalTimeGps: null,
      gpsDistanceKm: 0,
      engineHours: 0,
      maxSpeedKph: 0,
      originGpsStartPoint: '',
      destinationGpsEndPoint: '',
      actualRouteRoadTaken: '',
      tripStatus: 'en-route',
    };
  }

  let maxSpeed = 0;
  let maxEngineHours = 0;
  let firstTime: string | null = null;
  let lastTime: string | null = null;
  let firstLocation = '';
  let lastLocation = '';
  let maxOdometer = 0;
  let minOdometer = Infinity;

  // Collect road/street segments
  const roadSegments = new Set<string>();

  for (const point of points) {
    const speed = toNumber(firstPresent(point.speed, point.speed_kph));
    if (speed > maxSpeed) maxSpeed = speed;

    const engHrs = toNumber(firstPresent(point.engine_hours, point.engineHours));
    if (engHrs > maxEngineHours) maxEngineHours = engHrs;

    // Track odometer to compute trip distance
    const odo = toNumber(firstPresent(point.odometer, point.distance_km), -1);
    if (odo >= 0) {
      if (odo > maxOdometer) maxOdometer = odo;
      if (odo < minOdometer) minOdometer = odo;
    }

    const evtTime = String(firstPresent(
      point.event_time, point.event_ts, point.timestamp, ''
    ) || '');
    if (evtTime) {
      if (!firstTime) firstTime = evtTime;
      lastTime = evtTime;
    }

    const location = String(firstPresent(
      point.location, point.location_name, point.address, ''
    ) || '');
    if (location) {
      if (!firstLocation) firstLocation = location;
      lastLocation = location;
    }

    const street = String(point.street || point.address || '').trim();
    if (street) roadSegments.add(street);
  }

  // Compute trip distance from odometer difference.
  // Cartrack odometer values are in meters, convert to km.
  const gpsDistanceKm = minOdometer < Infinity && maxOdometer > minOdometer
    ? (maxOdometer - minOdometer) / 1000
    : 0;

  const routeTaken = Array.from(roadSegments).join(', ');
  const hasMotion = maxSpeed > 0 || gpsDistanceKm > 0;
  const tripStatus = hasMotion ? 'en-route' : 'arrived';

  return {
    departureTimeGps: firstTime,
    arrivalTimeGps: lastTime,
    gpsDistanceKm: clampNumeric(gpsDistanceKm, 99999999.99),
    engineHours: clampNumeric(maxEngineHours, 999999.99),
    maxSpeedKph: clampNumeric(maxSpeed, 9999.99),
    originGpsStartPoint: firstLocation,
    destinationGpsEndPoint: lastLocation,
    actualRouteRoadTaken: routeTaken,
    tripStatus,
  };
}

function normalizeDistanceKm(value: unknown): number {
  const distance = toNumber(value, 0);
  if (distance <= 0) return 0;
  // Cartrack trip summaries are commonly kilometres, while odometer-like
  // values are commonly metres. Treat very large trip distances as metres.
  return distance > 10000 ? distance / 1000 : distance;
}

function transformTripSummaryToTrip(point: CartrackHistoryPoint): TransformedTripData {
  const departureTime = String(firstPresent(
    point.start_timestamp,
    point.start_time,
    point.startTime,
    point.event_time,
    point.event_ts,
    point.timestamp,
    '',
  ) || '') || null;

  const arrivalTime = String(firstPresent(
    point.end_timestamp,
    point.end_time,
    point.endTime,
    point.event_time,
    point.event_ts,
    point.timestamp,
    '',
  ) || '') || null;

  const origin = String(firstPresent(
    point.start_location,
    point.startLocation,
    point.origin,
    point.location,
    point.location_name,
    point.address,
    '',
  ) || '');

  const destination = String(firstPresent(
    point.end_location,
    point.endLocation,
    point.destination,
    point.location,
    point.location_name,
    point.address,
    '',
  ) || '');

  const directDistance = firstPresent(
    point.trip_distance,
    point.tripDistance,
    point.distance_km,
    point.distance,
  );
  const startOdo = toNumber(point.start_odometer, -1);
  const endOdo = toNumber(point.end_odometer, -1);
  const odometerDistance = startOdo >= 0 && endOdo >= startOdo ? (endOdo - startOdo) / 1000 : 0;
  const gpsDistanceKm = normalizeDistanceKm(directDistance) || odometerDistance;

  const road = String(firstPresent(
    point.street,
    point.address,
    point.actual_route,
    point.route,
    '',
  ) || '');

  const maxSpeed = toNumber(firstPresent(point.speed, point.speed_kph, point.max_speed, point.maxSpeed), 0);
  const engineHours = toNumber(firstPresent(point.engine_hours, point.engineHours, point.driving_time), 0);

  return {
    departureTimeGps: departureTime,
    arrivalTimeGps: arrivalTime,
    gpsDistanceKm: clampNumeric(gpsDistanceKm, 99999999.99),
    engineHours: clampNumeric(engineHours, 999999.99),
    maxSpeedKph: clampNumeric(maxSpeed, 9999.99),
    originGpsStartPoint: origin,
    destinationGpsEndPoint: destination,
    actualRouteRoadTaken: road,
    tripStatus: arrivalTime ? 'completed' : 'en-route',
  };
}

/**
 * Split raw breadcrumb history points into individual trips based on
 * ignition on/off transitions and movement state changes.
 *
 * A new trip begins when:
 *   - Ignition transitions from off → on
 *   - Vehicle starts moving (speed > 0) after being parked
 *   - The gap between consecutive points exceeds 30 minutes
 *
 * A trip ends when:
 *   - Ignition transitions from on → off (and stays off)
 *   - Vehicle stops moving for an extended period
 *
 * This ensures that each GPS log entry corresponds to a single
 * "ignition-on → moving → parked/ignition-off" cycle, making it
 * possible to match each trip to the correct travel order when
 * multiple orders exist for the same vehicle on the same day.
 */
export function splitTripsByIgnition(
  points: CartrackHistoryPoint[],
): CartrackHistoryPoint[][] {
  if (!points || points.length === 0) return [];

  // Helper to extract ignition status — handles boolean, number, and string values
  function isIgnitionOn(point: CartrackHistoryPoint): boolean {
    const raw = point.ignition;
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw > 0;
    if (typeof raw === 'string') {
      const lower = raw.toLowerCase();
      return lower === 'true' || lower === '1' || lower === 'on' || lower === 'yes';
    }
    return false;
  }

  // Helper to extract speed in kph
  function getSpeed(point: CartrackHistoryPoint): number {
    return toNumber(firstPresent(point.speed, point.speed_kph), 0);
  }

  // Helper to get timestamp in ms
  function getTimestampMs(point: CartrackHistoryPoint): number | null {
    const ts = String(firstPresent(
      point.event_time, point.event_ts, point.timestamp, point.start_time, point.start_timestamp,
    ) || '');
    if (!ts) return null;
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  const trips: CartrackHistoryPoint[][] = [];
  let currentTrip: CartrackHistoryPoint[] = [];

  // Start with the first point — always begin a trip with the first data point
  // if it has ignition on or is moving
  let prevIgnitionOn = false;
  let prevSpeed = 0;
  let prevTimestampMs: number | null = null;

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const ignitionOn = isIgnitionOn(point);
    const speed = getSpeed(point);
    const tsMs = getTimestampMs(point);
    const isMoving = speed > 5; // moving if speed > 5 kph
    const isStarting = speed > 0 || ignitionOn; // vehicle is "active"

    // First point: start a trip if vehicle is active
    if (i === 0) {
      if (isStarting) {
        currentTrip.push(point);
        prevIgnitionOn = ignitionOn;
        prevSpeed = speed;
        prevTimestampMs = tsMs;
      }
      continue;
    }

    // Determine if a gap exists (> 30 min means likely a new trip)
    const gapMs = (tsMs !== null && prevTimestampMs !== null) ? tsMs - prevTimestampMs : 0;
    const hasGap = gapMs > 30 * 60 * 1000; // 30 minutes

    // Determine if this is a restart after being off
    const ignitionTurnedOn = !prevIgnitionOn && ignitionOn;
    const startedMoving = !isMoving && speed > 0;
    const transitionToActive = ignitionTurnedOn || startedMoving;

    // If we have an active trip and vehicle turned off or there's a big gap, finalize it
    if (currentTrip.length > 0) {
      const ignitionTurnedOff = prevIgnitionOn && !ignitionOn;
      const stoppedMoving = prevSpeed > 0 && speed === 0 && !ignitionOn;
      const tripEnding = ignitionTurnedOff || stoppedMoving || hasGap;

      if (tripEnding) {
        // Check if the next points also show off — to avoid false positives
        let stillOff = true;
        for (let j = i; j < Math.min(i + 3, points.length); j++) {
          if (isIgnitionOn(points[j]) || getSpeed(points[j]) > 5) {
            stillOff = false;
            break;
          }
        }

        if (stillOff || hasGap) {
          // End the current trip
          trips.push(currentTrip);
          currentTrip = [];

          // Only start a new trip if the next point shows activity
          if (isStarting && (hasGap || transitionToActive)) {
            currentTrip.push(point);
            prevIgnitionOn = ignitionOn;
            prevSpeed = speed;
            prevTimestampMs = tsMs;
            continue;
          }
        } else {
          // False positive — vehicle is still active, continue the trip
          currentTrip.push(point);
        }
      } else {
        // Continue the current trip
        currentTrip.push(point);
      }
    } else {
      // No active trip — start one if vehicle becomes active
      if (isStarting) {
        currentTrip.push(point);
      }
    }

    prevIgnitionOn = ignitionOn;
    prevSpeed = speed;
    prevTimestampMs = tsMs;
  }

  // Push the last trip if any
  if (currentTrip.length > 0) {
    trips.push(currentTrip);
  }

  return trips;
}

export function transformHistoryToTrips(
  points: CartrackHistoryPoint[],
  plateNumber: string,
  dateStr: string,
): TransformedTripData[] {
  if (!points || points.length === 0) {
    return [transformHistoryToTrip(points, plateNumber, dateStr)];
  }

  // First check for trip summaries (structured trips from Cartrack)
  const tripSummaries = points.filter(looksLikeTripSummary);
  if (tripSummaries.length > 0) {
    return tripSummaries.map(transformTripSummaryToTrip);
  }

  // For raw breadcrumb data, split by ignition on/off transitions
  const splitTrips = splitTripsByIgnition(points);

  if (splitTrips.length === 0) {
    return [transformHistoryToTrip(points, plateNumber, dateStr)];
  }

  // Transform each split point group into a trip record
  return splitTrips.map((tripPoints) => {
    // Find the first location as origin and last as destination
    let firstLocation = '';
    let lastLocation = '';
    let firstTime: string | null = null;
    let lastTime: string | null = null;
    let maxSpeed = 0;
    let maxOdometer = 0;
    let minOdometer = Infinity;
    const roadSegments = new Set<string>();

    for (const point of tripPoints) {
      const speed = toNumber(firstPresent(point.speed, point.speed_kph));
      if (speed > maxSpeed) maxSpeed = speed;

      const odo = toNumber(firstPresent(point.odometer, point.distance_km), -1);
      if (odo >= 0) {
        if (odo > maxOdometer) maxOdometer = odo;
        if (odo < minOdometer) minOdometer = odo;
      }

      const evtTime = String(firstPresent(
        point.event_time, point.event_ts, point.timestamp, ''
      ) || '');
      if (evtTime) {
        if (!firstTime) firstTime = evtTime;
        lastTime = evtTime;
      }

      const location = String(firstPresent(
        point.location, point.location_name, point.address, ''
      ) || '');
      if (location) {
        if (!firstLocation) firstLocation = location;
        lastLocation = location;
      }

      const street = String(point.street || point.address || '').trim();
      if (street) roadSegments.add(street);
    }

    const gpsDistanceKm = minOdometer < Infinity && maxOdometer > minOdometer
      ? (maxOdometer - minOdometer) / 1000
      : 0;

    const routeTaken = Array.from(roadSegments).join(', ');
    const hasMotion = maxSpeed > 0 || gpsDistanceKm > 0;
    const tripStatus = hasMotion ? 'en-route' : 'arrived';

    return {
      departureTimeGps: firstTime,
      arrivalTimeGps: lastTime,
      gpsDistanceKm: clampNumeric(gpsDistanceKm, 99999999.99),
      engineHours: 0,
      maxSpeedKph: clampNumeric(maxSpeed, 9999.99),
      originGpsStartPoint: firstLocation,
      destinationGpsEndPoint: lastLocation,
      actualRouteRoadTaken: routeTaken,
      tripStatus,
    };
  });
}

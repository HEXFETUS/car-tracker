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
  clock?: string;
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
  // Fleet trip history row fields (returned from trip details endpoint)
  Time?: string;
  time?: string;
  Status?: string;
  status?: string;
  Events?: string;
  events?: string;
  "Road Speed"?: number;
  road_speed?: number;
  roadSpeed?: number;
  Location?: string;
  Latitude?: number;
  Longitude?: number;
  // Trip record ID for fetching details
  id?: number;
  trip_id?: number;
  tripId?: number | string;
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
  const keys = ['data', 'points', 'results', 'items', 'history', 'tracking', 'positions', 'records', 'trips', 'events', 'details', 'rows'];
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

export function looksLikeTripSummary(point: CartrackHistoryPoint): boolean {
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

/**
 * STRICT check: a record is a fleet trip history row ONLY if it contains
 * ALL of: Time, Status, Events, Location (the required columns).
 *
 * Records from /vehicles/{plate}/events (with ignition/speed/clock but NO Time)
 * will NOT match this check.
 */
export function looksLikeFleetTripHistoryRow(point: CartrackHistoryPoint): boolean {
  // Must have a time value
  const timeVal = point.Time ?? point.time;
  if (timeVal === undefined || timeVal === null || timeVal === '') return false;

  // Must have status
  const statusVal = point.Status ?? point.status;
  if (statusVal === undefined || statusVal === null || statusVal === '') return false;

  // Must have events
  const eventsVal = point.Events ?? point.events;
  if (eventsVal === undefined || eventsVal === null) return false;

  // Must have location
  const locVal = point.Location ?? point.location;
  if (locVal === undefined || locVal === null || locVal === '') return false;

  // Must have valid coordinates
  const lat = Number(point.Latitude ?? point.latitude);
  const lon = Number(point.Longitude ?? point.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;

  return true;
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

async function fetchVehicleCurrentStatus(
  unitId: string,
): Promise<CartrackHistoryPoint | null> {
  if (!isConfigured()) return null;

  try {
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

// ── Discovery Mode: Probe all known endpoints for fleet history rows ──
//
// For a given vehicle and date, systematically try every known endpoint
// and log the results to help identify which endpoint returns the detailed
// fleet trip history rows (Time, Status, Events, Location, Latitude, Longitude).

export async function discoverFleetHistoryEndpoints(
  unitId: string,
  plateNumber: string,
  dateStr: string,
): Promise<void> {
  if (!isConfigured()) {
    console.log('[Discovery] Cartrack not configured — skipping');
    return;
  }

  const { fromIso, toIso, startTimestamp, endTimestamp } = dateTimeParams(dateStr);
  const baseUrl = normalizeBaseUrl(CARTRACK_API_URL);
  const registration = encodeURIComponent(plateNumber.trim().toUpperCase());

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`🔍 FLEET HISTORY ENDPOINT DISCOVERY`);
  console.log(`   Vehicle: ${plateNumber} (unitId=${unitId}, registration=${registration})`);
  console.log(`   Date: ${dateStr}`);
  console.log(`   Base URL: ${baseUrl}`);
  console.log(`   Time window: ${startTimestamp} → ${endTimestamp}`);
  console.log(`${'═'.repeat(70)}`);

  // All candidate endpoints organized by category
  const allEndpoints: { url: string; method: string }[] = [
    // ── Trip summary endpoints (known working) ──
    { url: appendQuery(`${baseUrl}/trips/${registration}`, { start_timestamp: startTimestamp, end_timestamp: endTimestamp }), method: 'GET' },
    { url: appendQuery(`${baseUrl}/trips/${registration}`, { from: fromIso, to: toIso }), method: 'GET' },

    // ── Trip details (may return fleet history rows) ──
    { url: appendQuery(`${baseUrl}/trips/${registration}/details`, { start_timestamp: startTimestamp, end_timestamp: endTimestamp }), method: 'GET' },
    { url: appendQuery(`${baseUrl}/trips/${registration}/details`, { from: fromIso, to: toIso }), method: 'GET' },
    { url: appendQuery(`${baseUrl}/trips/${unitId}/details`, { start_timestamp: startTimestamp, end_timestamp: endTimestamp }), method: 'GET' },
    { url: appendQuery(`${baseUrl}/trips/${unitId}/details`, { from: fromIso, to: toIso }), method: 'GET' },

    // ── Vehicle-specific trip endpoints ──
    { url: appendQuery(`${baseUrl}/vehicles/${registration}/trips`, { start_timestamp: startTimestamp, end_timestamp: endTimestamp }), method: 'GET' },
    { url: appendQuery(`${baseUrl}/vehicles/${registration}/trips`, { from: fromIso, to: toIso }), method: 'GET' },
    { url: `${baseUrl}/vehicles/${unitId}/trips/${dateStr}`, method: 'GET' },
    { url: appendQuery(`${baseUrl}/vehicles/${unitId}/trips`, { from: fromIso, to: toIso }), method: 'GET' },

    // ── Reports endpoints ──
    { url: appendQuery(`${baseUrl}/reports/trip/${registration}`, { from: fromIso, to: toIso }), method: 'GET' },
    { url: appendQuery(`${baseUrl}/reports/trip/${unitId}`, { from: fromIso, to: toIso }), method: 'GET' },
    { url: appendQuery(`${baseUrl}/reports/route/${registration}`, { from: fromIso, to: toIso }), method: 'GET' },
    { url: appendQuery(`${baseUrl}/reports/route/${unitId}`, { from: fromIso, to: toIso }), method: 'GET' },

    // ── History endpoints ──
    { url: appendQuery(`${baseUrl}/history/${unitId}`, { from: fromIso, to: toIso }), method: 'GET' },
    { url: appendQuery(`${baseUrl}/history/details/${registration}`, { start_timestamp: startTimestamp, end_timestamp: endTimestamp }), method: 'GET' },
    { url: appendQuery(`${baseUrl}/history/details/${unitId}`, { start_timestamp: startTimestamp, end_timestamp: endTimestamp }), method: 'GET' },

    // ── Tracking endpoints ──
    { url: appendQuery(`${baseUrl}/tracking/details/${registration}`, { from: fromIso, to: toIso }), method: 'GET' },
    { url: appendQuery(`${baseUrl}/tracking/details/${unitId}`, { from: fromIso, to: toIso }), method: 'GET' },

    // ── Events endpoints (telemetry, NOT fleet history) ──
    { url: appendQuery(`${baseUrl}/vehicles/${registration}/events`, { start_timestamp: startTimestamp, end_timestamp: endTimestamp }), method: 'GET' },
    { url: appendQuery(`${baseUrl}/vehicles/${registration}/events`, { from: fromIso, to: toIso }), method: 'GET' },

    // ── Generic trip endpoints ──
    { url: appendQuery(`${baseUrl}/trips`, { registration: plateNumber, start_timestamp: startTimestamp, end_timestamp: endTimestamp }), method: 'GET' },

    // ── Try fetching details for the first trip summary ──
    // (we'll get a trip_id from the summary endpoint above first)
  ];

  // First, get trip summaries to extract trip IDs for detail lookup
  let firstTripId: string | number | null = null;
  const summaryEndpoint = appendQuery(`${baseUrl}/trips/${registration}`, { from: fromIso, to: toIso });
  try {
    const summaryResp = await fetchWithTimeout(summaryEndpoint, {
      headers: { authorization: getAuthHeader() },
    });
    if (summaryResp.ok) {
      const summaryData = await summaryResp.json();
      const summaryPoints = extractArrayPayload(summaryData);
      if (summaryPoints.length > 0 && summaryPoints[0]) {
        firstTripId = summaryPoints[0].id ?? summaryPoints[0].trip_id ?? summaryPoints[0].tripId ?? null;
        console.log(`\n📋 Got ${summaryPoints.length} trip summaries. First trip_id=${firstTripId}`);
        if (firstTripId) {
          allEndpoints.push(
            { url: `${baseUrl}/trips/${registration}/details/${firstTripId}`, method: 'GET' },
            { url: `${baseUrl}/trips/${unitId}/details/${firstTripId}`, method: 'GET' },
            { url: `${baseUrl}/trips/${firstTripId}`, method: 'GET' },
            { url: `${baseUrl}/trips/${firstTripId}/details`, method: 'GET' },
            { url: `${baseUrl}/trip/${firstTripId}`, method: 'GET' },
            { url: `${baseUrl}/trip/${firstTripId}/details`, method: 'GET' },
            { url: `${baseUrl}/vehicles/${registration}/trips/${firstTripId}`, method: 'GET' },
            { url: `${baseUrl}/vehicles/${registration}/trips/${firstTripId}/details`, method: 'GET' },
            { url: `${baseUrl}/vehicles/${unitId}/trips/${firstTripId}`, method: 'GET' },
            { url: `${baseUrl}/vehicles/${unitId}/trips/${firstTripId}/details`, method: 'GET' },
            { url: `${baseUrl}/reports/trip/${firstTripId}`, method: 'GET' },
            { url: `${baseUrl}/reports/trip/${firstTripId}/details`, method: 'GET' },
            { url: `${baseUrl}/reports/route/${firstTripId}`, method: 'GET' },
            { url: `${baseUrl}/history/trip/${firstTripId}`, method: 'GET' },
            { url: `${baseUrl}/history/${registration}/trip/${firstTripId}`, method: 'GET' },
          );
        }
      }
    }
  } catch (e) {
    console.log(`   Could not fetch trip summaries for trip_id extraction: ${(e as Error).message}`);
  }

  // Required fleet history fields
  const REQUIRED_FIELDS = ['Time', 'Status', 'Events', 'Location', 'Latitude', 'Longitude'];

  let totalEndpoints = allEndpoints.length;
  let successCount = 0;
  let fleetHistoryFound = 0;

  console.log(`\n📡 Probing ${totalEndpoints} endpoints...\n`);

  for (let i = 0; i < allEndpoints.length; i++) {
    const { url, method } = allEndpoints[i];
    const shortUrl = url.length > 120 ? url.substring(0, 120) + '...' : url;

    try {
      const response = await fetchWithTimeout(url, {
        method,
        headers: { authorization: getAuthHeader() },
      });

      const statusCode = response.status;
      const isSuccess = statusCode >= 200 && statusCode < 300;

      console.log(`[${i + 1}/${totalEndpoints}] ${method} ${shortUrl}`);
      console.log(`   Status: ${statusCode} ${statusCode === 404 ? '❌ Not Found' : statusCode === 200 ? '✅ OK' : '⚠️ Other'}`);

      if (!isSuccess) {
        if (statusCode === 404) console.log(`   → 404: endpoint does not exist`);
        else if (statusCode === 400) console.log(`   → 400: bad request`);
        else if (statusCode === 405) console.log(`   → 405: method not allowed`);
        else console.log(`   → HTTP ${statusCode}`);
        continue;
      }

      const data = await response.json();
      const points = extractArrayPayload(data);
      successCount++;

      if (points.length === 0) {
        console.log(`   Records: 0 (empty array)`);
        continue;
      }

      console.log(`   Records: ${points.length}`);

      // Log response keys
      const allKeys = Object.keys(points[0]);
      const keyInfo = allKeys.length > 0 ? allKeys.join(', ') : '(no keys)';
      console.log(`   Response keys (${allKeys.length}): ${keyInfo}`);

      // Log first 3 records
      console.log(`   ── First ${Math.min(points.length, 3)} record(s) ──`);
      for (let r = 0; r < Math.min(points.length, 3); r++) {
        const p = points[r];
        const timeVal = JSON.stringify(p.Time ?? p.time ?? p.clock ?? p.timestamp);
        const statusVal = JSON.stringify(p.Status ?? p.status);
        const eventsVal = JSON.stringify(p.Events ?? p.events);
        const locationVal = JSON.stringify(p.Location ?? p.location ?? p.location_name);
        const latVal = JSON.stringify(p.Latitude ?? p.latitude);
        const lonVal = JSON.stringify(p.Longitude ?? p.longitude);
        const speedVal = JSON.stringify(p["Road Speed"] ?? p.road_speed ?? p.speed);
        console.log(`   Row #${r + 1}: Time=${timeVal} | Status=${statusVal} | Events=${eventsVal} | Location=${locationVal} | Lat=${latVal} | Lon=${lonVal} | Speed=${speedVal}`);
      }

      // Check if this is fleet history data
      const hasTime = points.some(p => (p.Time ?? p.time) !== undefined && (p.Time ?? p.time) !== null && (p.Time ?? p.time) !== '');
      const hasStatus = points.some(p => (p.Status ?? p.status) !== undefined && (p.Status ?? p.status) !== null && (p.Status ?? p.status) !== '');
      const hasEvents = points.some(p => (p.Events ?? p.events) !== undefined && (p.Events ?? p.events) !== null);
      const hasLocation = points.some(p => (p.Location ?? p.location) !== undefined && (p.Location ?? p.location) !== null && (p.Location ?? p.location) !== '');
      const hasLat = points.some(p => Number(p.Latitude ?? p.latitude) !== 0 && Number.isFinite(Number(p.Latitude ?? p.latitude)));
      const hasLon = points.some(p => Number(p.Longitude ?? p.longitude) !== 0 && Number.isFinite(Number(p.Longitude ?? p.longitude)));

      const fieldCheck = `Time=${hasTime}, Status=${hasStatus}, Events=${hasEvents}, Location=${hasLocation}, Lat=${hasLat}, Lon=${hasLon}`;
      console.log(`   Fleet history check: ${fieldCheck}`);

      if (hasTime && hasStatus && hasEvents && hasLocation && hasLat && hasLon) {
        console.log(`   🎯✅ FLEET HISTORY ENDPOINT FOUND! This endpoint returns the required fields!`);
        fleetHistoryFound++;
      } else if (hasTime && !hasStatus && !hasEvents) {
        console.log(`   📋 Trip summary endpoint (has Time but no Status/Events/Location)`);
      } else if (allKeys.some(k => k.toLowerCase().includes('ignition') || k.toLowerCase().includes('speed'))) {
        console.log(`   📡 Telemetry/events endpoint (has ignition/speed but no fleet history fields)`);
      } else {
        console.log(`   ❓ Unknown data shape`);
      }
    } catch (error) {
      const errMsg = (error as Error).message;
      console.log(`[${i + 1}/${totalEndpoints}] ${method} ${shortUrl}`);
      console.log(`   Error: ${errMsg}`);
    }

    console.log('');
  }

  // ── Summary ──
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`📊 DISCOVERY SUMMARY`);
  console.log(`   Total endpoints probed: ${totalEndpoints}`);
  console.log(`   Successful (2xx): ${successCount}`);
  console.log(`   Fleet history endpoints found: ${fleetHistoryFound}`);
  console.log(`${'═'.repeat(70)}\n`);
}

// ── Fetch detailed fleet trip history rows for a specific time window ──
//
// CRITICAL: /vehicles/{plate}/events does NOT return Time/Status/Events/Location.
// This function ONLY looks for endpoints that return actual fleet trip history rows.

async function fetchFleetTripHistoryRows(
  unitId: string,
  plateNumber: string,
  fromIso: string,
  toIso: string,
  startTimestamp: string,
  endTimestamp: string,
): Promise<CartrackHistoryPoint[]> {
  if (!isConfigured()) return [];

  const baseUrl = normalizeBaseUrl(CARTRACK_API_URL);
  const registration = encodeURIComponent(plateNumber.trim().toUpperCase());

  // ── Endpoints that MIGHT return fleet trip history rows ──
  const detailEndpoints: string[] = [
    // Trip details with registration
    appendQuery(`${baseUrl}/trips/${registration}/details`, {
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp,
    }),
    appendQuery(`${baseUrl}/trips/${registration}/details`, {
      from: fromIso,
      to: toIso,
    }),
    // Trip details with unit ID
    appendQuery(`${baseUrl}/trips/${unitId}/details`, {
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp,
    }),
    appendQuery(`${baseUrl}/trips/${unitId}/details`, {
      from: fromIso,
      to: toIso,
    }),
    // Vehicle trip details
    appendQuery(`${baseUrl}/vehicles/${registration}/trips/details`, {
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp,
    }),
    appendQuery(`${baseUrl}/vehicles/${registration}/trips/details`, {
      from: fromIso,
      to: toIso,
    }),
    // Reports based
    appendQuery(`${baseUrl}/reports/trip/${registration}`, {
      from: fromIso,
      to: toIso,
    }),
    appendQuery(`${baseUrl}/reports/trip/${unitId}`, {
      from: fromIso,
      to: toIso,
    }),
    appendQuery(`${baseUrl}/reports/route/${registration}`, {
      from: fromIso,
      to: toIso,
    }),
    appendQuery(`${baseUrl}/reports/route/${unitId}`, {
      from: fromIso,
      to: toIso,
    }),
    // History/details
    appendQuery(`${baseUrl}/history/details/${registration}`, {
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp,
    }),
    appendQuery(`${baseUrl}/history/details/${unitId}`, {
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp,
    }),
    // Tracking details
    appendQuery(`${baseUrl}/tracking/details/${registration}`, {
      from: fromIso,
      to: toIso,
    }),
    appendQuery(`${baseUrl}/tracking/details/${unitId}`, {
      from: fromIso,
      to: toIso,
    }),
    // Try /trip/{id}/details patterns with no specific ID
    `${baseUrl}/trips/${registration}/details`,
    `${baseUrl}/trips/${unitId}/details`,
  ];

  for (const endpoint of detailEndpoints) {
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

        console.log(`\n🔍 TRIP DETAIL ENDPOINT: ${endpoint}`);
        console.log(`   Status: ${response.status}, Records: ${points.length}`);

        if (points.length > 0) {
          const sampleKeys = Object.keys(points[0]).slice(0, 30);
          console.log(`   First record keys (${sampleKeys.length}): ${JSON.stringify(sampleKeys)}`);

          // Log first 5 rows in detail
          for (let i = 0; i < Math.min(points.length, 5); i++) {
            const p = points[i];
            console.log(`   Row #${i}: Time=${JSON.stringify(p.Time ?? p.time)}, Status=${JSON.stringify(p.Status ?? p.status)}, Events=${JSON.stringify(p.Events ?? p.events)}, Location=${JSON.stringify(p.Location ?? p.location)}, Lat=${JSON.stringify(p.Latitude ?? p.latitude)}, Lon=${JSON.stringify(p.Longitude ?? p.longitude)}`);
          }

          // CRITICAL: Only accept if it has ALL required fleet history fields
          const hasTime = points.some(p => (p.Time ?? p.time) !== undefined && (p.Time ?? p.time) !== null && (p.Time ?? p.time) !== '');
          const hasStatus = points.some(p => (p.Status ?? p.status) !== undefined && (p.Status ?? p.status) !== null && (p.Status ?? p.status) !== '');
          const hasEvents = points.some(p => (p.Events ?? p.events) !== undefined && (p.Events ?? p.events) !== null);
          const hasLocation = points.some(p => (p.Location ?? p.location) !== undefined && (p.Location ?? p.location) !== null && (p.Location ?? p.location) !== '');
          const hasLat = points.some(p => Number(p.Latitude ?? p.latitude) !== 0 && Number.isFinite(Number(p.Latitude ?? p.latitude)));
          const hasLon = points.some(p => Number(p.Longitude ?? p.longitude) !== 0 && Number.isFinite(Number(p.Longitude ?? p.longitude)));

          console.log(`   Validation: Time=${hasTime}, Status=${hasStatus}, Events=${hasEvents}, Location=${hasLocation}, Lat=${hasLat}, Lon=${hasLon}`);

          if (hasTime && hasStatus && hasEvents && hasLocation && hasLat && hasLon) {
            console.log(`   ✅ VALID fleet trip history rows found!`);
            return points;
          } else {
            console.log(`   ❌ Missing required fleet history fields — skipping this endpoint`);
            // Continue to next endpoint
          }
        } else {
          console.log(`   No records returned`);
        }
      } catch (error) {
        if (!isRetriableError(error) || attempt >= CARTRACK_RETRIES) break;
        await delay(1000 * (attempt + 1));
      }
    }
  }

  console.log(`\n⚠️ No endpoint returned valid fleet trip history rows for this time window`);
  return [];
}

/**
 * Given a fleet trip record (from /rest/trips/{plate}), try to fetch
 * the detailed fleet trip history rows for that specific trip.
 *
 * Returns rows with Time, Status, Events, Location, Latitude, Longitude
 * or an empty array if not available.
 */
export async function fetchDetailedPointsForTrip(
  unitId: string,
  plateNumber: string,
  tripRecord: CartrackHistoryPoint,
): Promise<CartrackHistoryPoint[]> {
  const baseUrl = normalizeBaseUrl(CARTRACK_API_URL);
  const registration = encodeURIComponent(plateNumber.trim().toUpperCase());

  // Log ALL keys from the trip record to identify available fields
  const allKeys = Object.keys(tripRecord);
  console.log(`\n📋 TRIP RECORD KEYS (${allKeys.length}):`);
  console.log(`   ${JSON.stringify(allKeys)}`);

  // Log key fields
  console.log(`   id=${JSON.stringify(tripRecord.id)}`);
  console.log(`   trip_id=${JSON.stringify(tripRecord.trip_id)}`);
  console.log(`   tripId=${JSON.stringify(tripRecord.tripId)}`);
  console.log(`   start_timestamp=${JSON.stringify(tripRecord.start_timestamp)}`);
  console.log(`   end_timestamp=${JSON.stringify(tripRecord.end_timestamp)}`);
  console.log(`   start_time=${JSON.stringify(tripRecord.start_time)}`);
  console.log(`   end_time=${JSON.stringify(tripRecord.end_time)}`);
  console.log(`   start_location=${JSON.stringify(tripRecord.start_location)}`);
  console.log(`   end_location=${JSON.stringify(tripRecord.end_location)}`);

  // Extract the trip ID from the record
  const tripId = tripRecord.id ?? tripRecord.trip_id ?? tripRecord.tripId;

  if (!tripId) {
    console.log(`⚠️ No trip ID found in record — cannot fetch trip details`);
  }

  // Try endpoints that use the specific trip_id
  if (tripId) {
    console.log(`\n🔎 Fetching details for trip_id=${tripId}...`);

    const tripSpecificEndpoints: string[] = [
      // Direct trip detail endpoints
      `${baseUrl}/trips/${registration}/details/${tripId}`,
      `${baseUrl}/trips/${unitId}/details/${tripId}`,
      // Generic trip endpoints
      `${baseUrl}/trips/${tripId}/details`,
      `${baseUrl}/trips/${tripId}`,
      `${baseUrl}/trip/${tripId}`,
      `${baseUrl}/trip/${tripId}/details`,
      // Vehicle-specific
      `${baseUrl}/vehicles/${registration}/trips/${tripId}/details`,
      `${baseUrl}/vehicles/${registration}/trips/${tripId}`,
      `${baseUrl}/vehicles/${unitId}/trips/${tripId}/details`,
      // Reports
      `${baseUrl}/reports/trip/${tripId}`,
      `${baseUrl}/reports/trip/${tripId}/details`,
      `${baseUrl}/reports/route/${tripId}`,
      // History
      `${baseUrl}/history/trip/${tripId}`,
      `${baseUrl}/history/${registration}/trip/${tripId}`,
      // Generic
      appendQuery(`${baseUrl}/trips/${tripId}/details`, {}),
      appendQuery(`${baseUrl}/trip/${tripId}/details`, {}),
    ];

    for (const endpoint of tripSpecificEndpoints) {
      try {
        console.log(`\n   Trying: ${endpoint}`);
        const response = await fetchWithTimeout(endpoint, {
          headers: { authorization: getAuthHeader() },
        });

        console.log(`   Status: ${response.status}`);

        if (!response.ok) {
          if (response.status === 404) {
            console.log(`   → 404 Not Found`);
            continue;
          }
          if (response.status === 400 || response.status === 405) {
            console.log(`   → ${response.status} (bad request/method not allowed)`);
            continue;
          }
          continue;
        }

        const data = await response.json();
        const points = extractArrayPayload(data);

        console.log(`   Records: ${points.length}`);

        if (points.length > 0) {
          const sampleKeys = Object.keys(points[0]).slice(0, 30);
          console.log(`   First record keys (${sampleKeys.length}): ${JSON.stringify(sampleKeys)}`);

          for (let i = 0; i < Math.min(points.length, 5); i++) {
            const p = points[i];
            console.log(`   Row #${i}: Time=${JSON.stringify(p.Time ?? p.time)}, Status=${JSON.stringify(p.Status ?? p.status)}, Events=${JSON.stringify(p.Events ?? p.events)}, Location=${JSON.stringify(p.Location ?? p.location)}, Lat=${JSON.stringify(p.Latitude ?? p.latitude)}, Lon=${JSON.stringify(p.Longitude ?? p.longitude)}`);
          }

          // Validate
          const hasTime = points.some(p => (p.Time ?? p.time) !== undefined && (p.Time ?? p.time) !== null && (p.Time ?? p.time) !== '');
          const hasStatus = points.some(p => (p.Status ?? p.status) !== undefined && (p.Status ?? p.status) !== null && (p.Status ?? p.status) !== '');
          const hasEvents = points.some(p => (p.Events ?? p.events) !== undefined && (p.Events ?? p.events) !== null);
          const hasLocation = points.some(p => (p.Location ?? p.location) !== undefined && (p.Location ?? p.location) !== null && (p.Location ?? p.location) !== '');
          const hasLat = points.some(p => Number(p.Latitude ?? p.latitude) !== 0 && Number.isFinite(Number(p.Latitude ?? p.latitude)));
          const hasLon = points.some(p => Number(p.Longitude ?? p.longitude) !== 0 && Number.isFinite(Number(p.Longitude ?? p.longitude)));

          console.log(`   Validation: Time=${hasTime}, Status=${hasStatus}, Events=${hasEvents}, Location=${hasLocation}, Lat=${hasLat}, Lon=${hasLon}`);

          if (hasTime && hasStatus && hasEvents && hasLocation && hasLat && hasLon) {
            console.log(`   ✅ VALID fleet trip history rows found for trip_id=${tripId}!`);
            return points;
          } else {
            console.log(`   ❌ Missing required fleet history fields — continuing search...`);
          }
        }
      } catch (error) {
        console.log(`   Error: ${(error as Error).message}`);
      }
    }
  }

  // Fallback: try time-window-based fetch using the trip's start/end timestamps
  const startTs = String(firstPresent(
    tripRecord.start_timestamp,
    tripRecord.start_time,
    tripRecord.startTime,
    tripRecord.event_time,
    tripRecord.event_ts,
    tripRecord.timestamp,
    '',
  ) || '');

  const endTs = String(firstPresent(
    tripRecord.end_timestamp,
    tripRecord.end_time,
    tripRecord.endTime,
    tripRecord.event_time,
    tripRecord.event_ts,
    tripRecord.timestamp,
    '',
  ) || '');

  if (startTs && endTs) {
    console.log(`\n📅 Falling back to time-window fetch: ${startTs} → ${endTs}`);

    const fromDate = new Date(startTs);
    const toDate = new Date(endTs);

    fromDate.setMinutes(fromDate.getMinutes() - 5);
    toDate.setMinutes(toDate.getMinutes() + 5);

    const fromIso = fromDate.toISOString();
    const toIso = toDate.toISOString();
    const startTimestamp = fromDate.toISOString().replace('T', ' ').substring(0, 19);
    const endTimestamp = toDate.toISOString().replace('T', ' ').substring(0, 19);

    return await fetchFleetTripHistoryRows(
      unitId, plateNumber, fromIso, toIso, startTimestamp, endTimestamp,
    );
  }

  return [];
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

  // CRITICAL ORDER:
  // 1. /rest/trips/{plate} FIRST — returns fleet trip records with start/end timestamps
  // 2. Fallback to event endpoints LAST — these have no Time field for TO matching

  const historyEndpoints: string[] = [
    // ── Priority 1: Fleet trip records (from /rest/trips/{plate}) ──
    appendQuery(`${baseUrl}/trips/${registration}`, {
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp,
    }),
    appendQuery(`${baseUrl}/trips/${registration}`, {
      from: fromIso,
      to: toIso,
    }),

    // ── Priority 2: Trip details (might return actual fleet history rows) ──
    appendQuery(`${baseUrl}/trips/${registration}/details`, {
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp,
    }),
    appendQuery(`${baseUrl}/trips/${registration}/details`, {
      from: fromIso,
      to: toIso,
    }),
    appendQuery(`${baseUrl}/trips/${unitId}/details`, {
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp,
    }),
    appendQuery(`${baseUrl}/trips/${unitId}/details`, {
      from: fromIso,
      to: toIso,
    }),

    // ── Priority 3: Vehicle-specific trip routes ──
    appendQuery(`${baseUrl}/vehicles/${registration}/trips`, {
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp,
    }),
    appendQuery(`${baseUrl}/vehicles/${registration}/trips`, {
      from: fromIso,
      to: toIso,
    }),
    `${baseUrl}/vehicles/${unitId}/trips/${dateStr}`,
    appendQuery(`${baseUrl}/vehicles/${unitId}/trips`, { from: fromIso, to: toIso }),

    // ── Priority 4: Reports / history ──
    appendQuery(`${baseUrl}/trips`, {
      registration: plateNumber || unitId,
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp,
    }),
    appendQuery(`${baseUrl}/history/${unitId}`, { from: fromIso, to: toIso }),
    appendQuery(`${baseUrl}/reports/trip/${registration}`, { from: fromIso, to: toIso }),
    appendQuery(`${baseUrl}/reports/route/${registration}`, { from: fromIso, to: toIso }),

    // ── Priority 5 (LAST RESORT): Event endpoints ──
    // /vehicles/{plate}/events returns telemetry (ignition/speed/clock) but NO Time/Status/Events/Location
    // These CANNOT be used for TO matching.
    appendQuery(`${baseUrl}/vehicles/${registration}/events`, {
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp,
    }),
    appendQuery(`${baseUrl}/vehicles/${registration}/events`, {
      from: fromIso,
      to: toIso,
    }),
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
          console.log(`\n📡 CARTRACK ENDPOINT: ${endpoint}`);
          console.log(`   Status: ${response.status}, Records: ${points.length}`);

          // Log the shape
          const sampleKeys = Object.keys(points[0]).slice(0, 25);
          const allKeys = Object.keys(points[0]);
          const isSummary = looksLikeTripSummary(points[0]);
          const hasFleetHistoryFields = looksLikeFleetTripHistoryRow(points[0]);
          const hasTimeField = points.some(p => (p.Time ?? p.time) !== undefined && (p.Time ?? p.time) !== null && (p.Time ?? p.time) !== '');

          console.log(`   Keys (${allKeys.length}): ${JSON.stringify(sampleKeys)}...`);
          console.log(`   Classification: tripSummary=${isSummary}, hasTimeField=${hasTimeField}, hasFleetHistoryRow=${hasFleetHistoryFields}`);

          // Log first 3 records' key fields
          for (let i = 0; i < Math.min(points.length, 3); i++) {
            const p = points[i];
            console.log(`   Record #${i + 1}: id=${JSON.stringify(p.id)}, trip_id=${JSON.stringify(p.trip_id)}, Time=${JSON.stringify(p.Time ?? p.time)}, clock=${JSON.stringify(p.clock)}, start_time=${JSON.stringify(p.start_time)}, end_time=${JSON.stringify(p.end_time)}, ignition=${JSON.stringify(p.ignition)}, speed=${JSON.stringify(p.speed)}, lat=${JSON.stringify(p.latitude)}, lon=${JSON.stringify(p.longitude)}, location=${JSON.stringify(p.location)}, start_location=${JSON.stringify(p.start_location)}, end_location=${JSON.stringify(p.end_location)}`);
          }

          return points;
        }

        return [];
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!isRetriableError(error) || attempt >= CARTRACK_RETRIES) break;
        await delay(1000 * (attempt + 1));
      }
    }
  }

  // Fallback
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

  const roadSegments = new Set<string>();

  for (const point of points) {
    const speed = toNumber(firstPresent(point.speed, point.speed_kph));
    if (speed > maxSpeed) maxSpeed = speed;

    const engHrs = toNumber(firstPresent(point.engine_hours, point.engineHours));
    if (engHrs > maxEngineHours) maxEngineHours = engHrs;

    const odo = toNumber(firstPresent(point.odometer, point.distance_km), -1);
    if (odo >= 0) {
      if (odo > maxOdometer) maxOdometer = odo;
      if (odo < minOdometer) minOdometer = odo;
    }

    const evtTime = String(firstPresent(
      point.event_time, point.event_ts, point.timestamp, point.Time, point.time, ''
    ) || '');
    if (evtTime) {
      if (!firstTime) firstTime = evtTime;
      lastTime = evtTime;
    }

    const location = String(firstPresent(
      point.location, point.location_name, point.Location, point.address, ''
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

export function splitTripsByIgnition(
  points: CartrackHistoryPoint[],
): CartrackHistoryPoint[][] {
  if (!points || points.length === 0) return [];

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

  function getSpeed(point: CartrackHistoryPoint): number {
    return toNumber(firstPresent(point.speed, point.speed_kph), 0);
  }

  function getTimestampMs(point: CartrackHistoryPoint): number | null {
    const ts = String(firstPresent(
      point.event_time, point.event_ts, point.timestamp, point.Time, point.time, point.start_time, point.start_timestamp,
    ) || '');
    if (!ts) return null;
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  const trips: CartrackHistoryPoint[][] = [];
  let currentTrip: CartrackHistoryPoint[] = [];
  let prevIgnitionOn = false;
  let prevSpeed = 0;
  let prevTimestampMs: number | null = null;

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const ignitionOn = isIgnitionOn(point);
    const speed = getSpeed(point);
    const tsMs = getTimestampMs(point);
    const isMoving = speed > 5;
    const isStarting = speed > 0 || ignitionOn;

    if (i === 0) {
      if (isStarting) {
        currentTrip.push(point);
        prevIgnitionOn = ignitionOn;
        prevSpeed = speed;
        prevTimestampMs = tsMs;
      }
      continue;
    }

    const gapMs = (tsMs !== null && prevTimestampMs !== null) ? tsMs - prevTimestampMs : 0;
    const hasGap = gapMs > 30 * 60 * 1000;
    const ignitionTurnedOn = !prevIgnitionOn && ignitionOn;
    const startedMoving = !isMoving && speed > 0;
    const transitionToActive = ignitionTurnedOn || startedMoving;

    if (currentTrip.length > 0) {
      const ignitionTurnedOff = prevIgnitionOn && !ignitionOn;
      const stoppedMoving = prevSpeed > 0 && speed === 0 && !ignitionOn;
      const tripEnding = ignitionTurnedOff || stoppedMoving || hasGap;

      if (tripEnding) {
        let stillOff = true;
        for (let j = i; j < Math.min(i + 3, points.length); j++) {
          if (isIgnitionOn(points[j]) || getSpeed(points[j]) > 5) {
            stillOff = false;
            break;
          }
        }

        if (stillOff || hasGap) {
          trips.push(currentTrip);
          currentTrip = [];

          if (isStarting && (hasGap || transitionToActive)) {
            currentTrip.push(point);
            prevIgnitionOn = ignitionOn;
            prevSpeed = speed;
            prevTimestampMs = tsMs;
            continue;
          }
        } else {
          currentTrip.push(point);
        }
      } else {
        currentTrip.push(point);
      }
    } else {
      if (isStarting) {
        currentTrip.push(point);
      }
    }

    prevIgnitionOn = ignitionOn;
    prevSpeed = speed;
    prevTimestampMs = tsMs;
  }

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

  const tripSummaries = points.filter(looksLikeTripSummary);
  if (tripSummaries.length > 0) {
    return tripSummaries.map(transformTripSummaryToTrip);
  }

  const splitTrips = splitTripsByIgnition(points);

  if (splitTrips.length === 0) {
    return [transformHistoryToTrip(points, plateNumber, dateStr)];
  }

  return splitTrips.map((tripPoints) => {
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
        point.event_time, point.event_ts, point.timestamp, point.Time, point.time, ''
      ) || '');
      if (evtTime) {
        if (!firstTime) firstTime = evtTime;
        lastTime = evtTime;
      }

      const location = String(firstPresent(
        point.location, point.location_name, point.Location, point.address, ''
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
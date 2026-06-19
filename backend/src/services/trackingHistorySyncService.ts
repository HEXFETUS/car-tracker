// ── Tracking History Sync Service ─────────────────────────────
//
// Reconstructs GPS trips from raw Cartrack breadcrumb data for an
// entire fleet/date-range and intelligently matches each trip to a
// Travel Order (TO) before persisting to gps_trip_logs.
//
// Algorithm:
//   1. Fetch raw breadcrumbs per vehicle per date.
//   2. Detect trip boundaries using Driving ↔ Idling transitions.
//   3. Destination = coordinates when continuous idling ≥ IDLE_LIMIT_MINUTES.
//   4. After arrival, look for re-departure → create RETURN trip.
//   5. Resolve destination name (TO lat_long_destination → known DB → reverse geocode).
//   6. Match GPS trip to the best-fit TO (same vehicle, schedule containment,
//      coordinate proximity ≤ 200 m).
//   7. Deduplicate: skip if same vehicle/departure/arrival/trip_type row exists.
//   8. Persist OUTBOUND (and RETURN if applicable) records.

import { getPool } from '../db/db.js';
import {
  resolveCartrackUnitId,
  fetchCartrackVehicleHistory,
  fetchDetailedPointsForTrip,
  looksLikeTripSummary,
  looksLikeFleetTripHistoryRow,
  type CartrackHistoryPoint,
} from './cartrackHistoryService.js';
import { GPS_TO_MATCH_TOLERANCE_MINUTES, GPS_TO_DESTINATION_THRESHOLD_METERS, ALLOW_TRIP_SUMMARY_TIME_FALLBACK } from '../config/env.js';
import {
  findVehicleByPlate,
  findDriverByName,
  findAllTravelOrdersForDate,
  matchTravelOrderToGpsTrip,
  haversineDistance,
  saveGpsTripLog,
  isCoordinateClose,
  TO_COORD_MATCH_THRESHOLD_M,
  parseTimestampSafe,
  parseCartrackTripTimestamp,
  type TravelOrderWithTimes,
  type GpsLogInsertData,
} from './gpsLogService.js';

// ── Constants ──────────────────────────────────────────────────

const GPS_POINT_ROAD_PLACEHOLDER = '';
const NOMINATIM_USER_AGENT = 'CarTracker/1.0';

// ── Reverse Geocoding (self-contained) ──────────────────────────

async function reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`;
    const response = await fetch(url, { headers: { 'user-agent': NOMINATIM_USER_AGENT } });
    if (!response.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();
    const address = (data.address || {}) as Record<string, string>;
    const parts: string[] = [];
    const road = address.road || address.highway || address.pedestrian || address.path;
    const suburb = address.suburb || address.neighbourhood || address.residential;
    const city = address.city || address.town || address.municipality;
    if (road) parts.push(road);
    if (suburb) parts.push(suburb);
    if (city) parts.push(city);
    if (parts.length) return parts.join(', ');
    if (data.display_name) return String(data.display_name).split(',').slice(0, 3).join(',').trim();
  } catch (error) {
    console.log('Reverse geocoding failed:', (error as Error).message);
  }
  return null;
}

export const IDLE_LIMIT_MINUTES = 10;
export const IDLE_LIMIT_MS = IDLE_LIMIT_MINUTES * 60 * 1000;
export const DISTANCE_THRESHOLD_M = 200;

// Resolve the TO driving match tolerance with proper fallback to 10 minutes
const resolvedToleranceMinutes =
  Number.isFinite(Number(process.env.TO_DRIVING_MATCH_TOLERANCE_MINUTES)) &&
    Number(process.env.TO_DRIVING_MATCH_TOLERANCE_MINUTES) > 0
    ? Number(process.env.TO_DRIVING_MATCH_TOLERANCE_MINUTES)
    : 10;
const TO_MATCH_TOLERANCE_MS = resolvedToleranceMinutes * 60 * 1000;

// ── Strict TO Trip Validation Constants ────────────────────────
export const MAX_DEPARTURE_DIFFERENCE_MINUTES = 60;
export const MAX_ARRIVAL_DIFFERENCE_MINUTES = 60;
export const MAX_DEPARTURE_DIFFERENCE_MS = MAX_DEPARTURE_DIFFERENCE_MINUTES * 60 * 1000;
export const MAX_ARRIVAL_DIFFERENCE_MS = MAX_ARRIVAL_DIFFERENCE_MINUTES * 60 * 1000;

// ── Types ──────────────────────────────────────────────────────

export type SyncVehicleResult =
  | { status: 'no_travel_order' }
  | { status: 'cartrack_unavailable' }
  | { status: 'no_gps_data' }
  | { status: 'completed'; tripsCreated: number; tripsFailed: number; vehiclePlate: string };

export interface TrackingHistorySyncResult {
  success: boolean;
  fromDate: string;
  toDate: string;
  totalVehiclesProcessed: number;
  totalTripsCreated: number;
  totalTripsFailed: number;
  results: SyncVehicleResult[];
  elapsedSeconds: number;
}

// ── Coordinate Normalization (Task 2) ──────────────────────────

/**
 * Normalize a coordinate value into {latitude, longitude} object.
 * Handles multiple formats returned by Cartrack.
 *
 * Format A: { latitude: 8.453993, longitude: 124.622959 }
 * Format B: { lat: 8.453993, lng: 124.622959 }
 * Format C: "8.453993,124.622959"
 * Format D: { coordinates: { latitude: 8.453993, longitude: 124.622959 } }
 */
function normalizeCoordinates(value: unknown): { latitude: number; longitude: number } | null {
  if (!value) return null;

  // Format C: string "lat,lng"
  if (typeof value === 'string') {
    const parts = value.split(',');
    if (parts.length === 2) {
      const lat = Number(parts[0].trim());
      const lng = Number(parts[1].trim());
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { latitude: lat, longitude: lng };
      }
    }
    return null;
  }

  if (typeof value !== 'object') return null;

  const obj = value as Record<string, unknown>;

  // Format D: nested { coordinates: { latitude, longitude } }
  if (obj.coordinates && typeof obj.coordinates === 'object') {
    const nested = obj.coordinates as Record<string, unknown>;
    const lat = Number(nested.latitude ?? nested.lat);
    const lng = Number(nested.longitude ?? nested.lng ?? nested.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { latitude: lat, longitude: lng };
    }
  }

  // Format A: { latitude, longitude }
  if ('latitude' in obj && 'longitude' in obj) {
    const lat = Number(obj.latitude);
    const lng = Number(obj.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { latitude: lat, longitude: lng };
    }
  }

  // Format B: { lat, lng }
  if ('lat' in obj && 'lng' in obj) {
    const lat = Number(obj.lat);
    const lng = Number(obj.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { latitude: lat, longitude: lng };
    }
  }

  // Fallback: try lon instead of lng
  if ('lat' in obj && 'lon' in obj) {
    const lat = Number(obj.lat);
    const lng = Number(obj.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { latitude: lat, longitude: lng };
    }
  }

  return null;
}

/**
 * Convert a normalized coordinate to "lat,lng" string used in DB.
 */
function coordToDbString(coord: { latitude: number; longitude: number } | null): string | null {
  if (!coord) return null;
  return `${coord.latitude.toFixed(6)},${coord.longitude.toFixed(6)}`;
}

// ── Helpers ────────────────────────────────────────────────────

function extractTimestampMs(point: CartrackHistoryPoint): number | null {
  // Try clock first — it may be a Unix timestamp (number) or ISO string
  const clockVal = point.clock;
  if (clockVal !== undefined && clockVal !== null) {
    if (typeof clockVal === 'number') {
      // Unix timestamp: < 1e12 means seconds (year 2001+ in ms = ~1e12), > means ms
      return clockVal < 1e12 ? clockVal * 1000 : clockVal;
    }
    if (typeof clockVal === 'string') {
      const d = new Date(clockVal);
      if (!Number.isNaN(d.getTime())) return d.getTime();
    }
  }

  // Fallback: try other known timestamp fields
  const raw = String(
    point.event_time ?? point.event_ts ?? point.timestamp ?? point.start_time ?? point.start_timestamp ?? '',
  );
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function msToManilaTimeString(ms: number): string {
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function extractTimeStr(point: CartrackHistoryPoint): string | null {
  const ms = extractTimestampMs(point);
  return ms !== null ? msToManilaTimeString(ms) : null;
}

function toCoordStr(point: CartrackHistoryPoint): string | null {
  const lat = point.latitude;
  const lon = point.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return `${lat.toFixed(6)},${lon.toFixed(6)}`;
}

/**
 * Derive ignition status from a Cartrack record, handling all common shapes.
 */
function deriveIgnition(record: CartrackHistoryPoint): boolean {
  const ignitionRaw = record.ignition ?? record.Ignition;
  if (ignitionRaw === true || ignitionRaw === 1 || ignitionRaw === "1") return true;
  if (ignitionRaw === false || ignitionRaw === 0 || ignitionRaw === "0") return false;
  if (typeof ignitionRaw === "string") {
    const lower = ignitionRaw.toLowerCase().trim();
    if (lower === "true" || lower === "1" || lower === "on" || lower === "yes" || lower === "y") return true;
    if (lower === "false" || lower === "0" || lower === "off" || lower === "no" || lower === "n") return false;
  }
  return false;
}

/**
 * Derive the road speed from a Cartrack record, trying common key shapes.
 */
function deriveRoadSpeed(record: CartrackHistoryPoint): number {
  const raw = record["Road Speed"] ?? record.road_speed ?? record.speed ?? record.speed_kph ?? 0;
  const speed = Number(raw);
  return Number.isFinite(speed) ? speed : 0;
}

/**
 * Derive the vehicle status per the user's specification.
 *   - If ignition is not on → "Off"
 *   - If speed > 0 → "Driving"
 *   - Otherwise → "Idling"
 */
function deriveStatus(record: CartrackHistoryPoint): 'Driving' | 'Idling' | 'Off' {
  const ignition = deriveIgnition(record);
  if (!ignition) return 'Off';
  const speed = deriveRoadSpeed(record);
  if (speed > 0) return 'Driving';
  return 'Idling';
}

// Keep backward-compatible aliases for the rest of the codebase
function isDriving(point: CartrackHistoryPoint): boolean {
  return deriveStatus(point) === 'Driving';
}

function isIdling(point: CartrackHistoryPoint): boolean {
  return deriveStatus(point) === 'Idling';
}

function isIgnitionOn(point: CartrackHistoryPoint): boolean {
  return deriveIgnition(point);
}

function getPointSpeed(point: CartrackHistoryPoint): number {
  return deriveRoadSpeed(point);
}

function deriveTripStatus(point: CartrackHistoryPoint): 'Driving' | 'Idling' | 'Off' {
  return deriveStatus(point);
}

function parseCoord(coord: string | null | undefined): { lat: number; lon: number } | null {
  if (!coord) return null;
  const m = String(coord).trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

// ── Trip Detection from Raw Breadcrumbs ───────────────────────
//
// Returns an array of detected trips: { departure, arrival, points }.
// A trip is completed when the vehicle has been continuously idling
// for ≥ IDLE_LIMIT_MS after driving.

interface ReconstructedTrip {
  departureTime: string | null;
  arrivalTime: string | null;
  gpsStartCoord: string | null;
  gpsEndCoord: string | null;
  originName: string;
  destinationName: string;
  maxSpeedKph: number;
  engineHours: number;
  distanceKm: number;
  rawStartTimestamp?: string | null;
  rawEndTimestamp?: string | null;
}

function reconstructTripsFromBreadcrumbs(points: CartrackHistoryPoint[]): ReconstructedTrip[] {
  if (!points || points.length === 0) return [];

  // Sort by timestamp
  const sorted = points
    .map((p, idx) => ({ p, idx }))
    .filter((x) => extractTimestampMs(x.p) !== null)
    .sort((a, b) => extractTimestampMs(a.p)! - extractTimestampMs(b.p)!)
    .map((x) => x.p);

  if (sorted.length === 0) {
    // fall back to the first available point
    const fallback = points[0];
    return [
      {
        departureTime: extractTimeStr(fallback) ?? null,
        arrivalTime: null,
        gpsStartCoord: toCoordStr(fallback),
        gpsEndCoord: toCoordStr(fallback),
        originName: String(fallback.location ?? fallback.location_name ?? '').trim(),
        destinationName: String(fallback.location ?? fallback.location_name ?? '').trim(),
        maxSpeedKph: Number(fallback.speed ?? fallback.speed_kph ?? 0),
        engineHours: Number(fallback.engine_hours ?? fallback.engineHours ?? 0),
        distanceKm: 0,
      },
    ];
  }

  const trips: ReconstructedTrip[] = [];
  let currentTrip: ReconstructedTrip | null = null;
  let idlingStartMs: number | null = null;
  let prevTimestampMs: number | null = null;

  // State machine: looking for departure → driving → idling long enough → arrival
  for (const point of sorted) {
    const tsMs = extractTimestampMs(point)!;
    const driving = isDriving(point);
    const idling = isIdling(point);
    const speed = Number(point.speed ?? point.speed_kph ?? 0);
    const coord = toCoordStr(point);
    const locationName = String(point.location ?? point.location_name ?? point.address ?? '').trim();

    // Gap detection: > 120 minutes gap resets state
    if (prevTimestampMs !== null && tsMs - prevTimestampMs > 120 * 60 * 1000) {
      if (currentTrip && currentTrip.arrivalTime === null) {
        // abandon incomplete trip
      }
      currentTrip = null;
      idlingStartMs = null;
    }

    if (!currentTrip) {
      // Looking for first driving event to start a trip
      if (driving) {
        currentTrip = {
          departureTime: msToManilaTimeString(tsMs),
          arrivalTime: null,
          gpsStartCoord: coord,
          gpsEndCoord: coord,
          originName: locationName,
          destinationName: locationName,
          maxSpeedKph: speed,
          engineHours: Number(point.engine_hours ?? point.engineHours ?? 0),
          distanceKm: 0,
        };
        idlingStartMs = null;
      }
    } else {
      // Update trip stats
      if (speed > currentTrip.maxSpeedKph) currentTrip.maxSpeedKph = speed;
      const eHours = Number(point.engine_hours ?? point.engineHours ?? 0);
      if (eHours > currentTrip.engineHours) currentTrip.engineHours = eHours;

      // Track last known destination coord and name
      if (coord) currentTrip.gpsEndCoord = coord;
      if (locationName) currentTrip.destinationName = locationName;

      if (driving) {
        idlingStartMs = null;
      } else if (idling) {
        if (idlingStartMs === null) idlingStartMs = tsMs;
        if (currentTrip.arrivalTime === null && tsMs - idlingStartMs >= IDLE_LIMIT_MS) {
          // Arrival detected
          currentTrip.arrivalTime = msToManilaTimeString(tsMs);
          currentTrip.gpsEndCoord = toCoordStr(point) ?? currentTrip.gpsEndCoord;
          const loc = String(point.location ?? point.location_name ?? point.address ?? '').trim();
          if (loc) currentTrip.destinationName = loc;
        }
      } else {
        // Stationary (ignition off or unknown) — break the trip
        if (currentTrip.arrivalTime === null) {
          // Finalize with last known location if no arrival
          currentTrip.arrivalTime = msToManilaTimeString(tsMs);
        }
        trips.push(currentTrip);
        currentTrip = null;
        idlingStartMs = null;
      }
    }

    prevTimestampMs = tsMs;
  }

  // Finalize last trip
  if (currentTrip) {
    if (currentTrip.arrivalTime === null) {
      currentTrip.arrivalTime = prevTimestampMs ? msToManilaTimeString(prevTimestampMs) : null;
    }
    if (currentTrip.arrivalTime) {
      trips.push(currentTrip);
    }
  }

  return trips;
}

// ── Direction: detect RETURN trip conditions ──────────────────
//
// A RETURN trip is identified when:
//  - Previous OUTBOUND trip exists
//  - Departure occurs AFTER the arrival of the previous trip
//  - The departure location is near the previous trip's destination
//  - Arrival is near the previous trip's origin (loose check)

interface ReconstructedReturnTrip {
  parentTrip: ReconstructedTrip;
  returnTrip: ReconstructedTrip;
}

function linkReturnTrips(trips: ReconstructedTrip[]): ReconstructedTrip[] {
  const result: ReconstructedTrip[] = [];
  for (let i = 0; i < trips.length; i++) {
    const trip = trips[i];
    result.push(trip);

    if (i > 0) {
      const prev = trips[i - 1];
      if (!prev.arrivalTime) continue;

      const curDepartMs = trip.departureTime ? new Date(trip.departureTime).getTime() : null;
      const prevArrMs = new Date(prev.arrivalTime).getTime();
      const prevDepartMs = prev.departureTime ? new Date(prev.departureTime).getTime() : null;

      if (curDepartMs !== null && prevDepartMs !== null && curDepartMs - prevArrMs > 5 * 60 * 1000) {
        continue;
      }

      if (curDepartMs !== null && curDepartMs - prevArrMs <= 8 * 60 * 1000) {
        const depCoord = parseCoord(trip.gpsStartCoord ?? trip.originName);
        const prevDestCoord = parseCoord(prev.gpsEndCoord ?? prev.destinationName);
        if (depCoord && prevDestCoord) {
          const dist = haversineDistance(
            `${depCoord.lat},${depCoord.lon}`,
            `${prevDestCoord.lat},${prevDestCoord.lon}`,
          );
          if (dist <= DISTANCE_THRESHOLD_M) {
            result.push({
              ...trip,
              tripType: 'RETURN',
              parentTripIdHint: prev,
            } as any);
          }
        }
      }
    }
  }
  return result;
}

interface DetectedTrip extends ReconstructedTrip {
  tripType?: 'OUTBOUND' | 'RETURN';
  parentTrip?: ReconstructedTrip | null;
  travelOrder?: TravelOrderWithTimes | null;
}

interface TimedPoint {
  point: CartrackHistoryPoint;
  tsMs: number;
  status: 'Driving' | 'Idling' | 'Off';
  speed: number;
  coord: string | null;
  locationName: string;
  latitude: number | null;
  longitude: number | null;
}

// ── Robust Cartrack Timestamp Parser ──────────────────────────

/**
 * Try to parse a single raw value into a Date.
 * Returns null if it cannot produce a valid Date.
 */
function parseSingleTimeValue(value: unknown, tripDate: string | null): Date | null {
  if (value === null || value === undefined || value === '') return null;

  // Number: treat as Unix timestamp
  if (typeof value === 'number') {
    // 13 digits = ms epoch, 10 digits = seconds epoch
    const ms = value >= 1e12 ? value : value * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      // Reject dates in 1970 unless tripDate is actually 1970
      if (d.getUTCFullYear() === 1970 && tripDate && !tripDate.startsWith('1970')) return null;
      return d;
    }
    return null;
  }

  // String
  const str = String(value).trim();
  if (!str) return null;

  // If it contains a year (4-digit like 2026 or 2-digit like 26), parse directly
  if (/\b(19|20)\d{2}\b/.test(str) || /\b\d{2}\b/.test(str)) {
    const d = new Date(str);
    if (!Number.isNaN(d.getTime()) && d.getUTCFullYear() > 1970) return d;
  }

  // Try direct Date parse anyway (may work with some formats)
  const d = new Date(str);
  if (!Number.isNaN(d.getTime())) {
    if (d.getUTCFullYear() === 1970 && tripDate && !tripDate.startsWith('1970')) return null;
    return d;
  }

  // Time-only string like "10:08:00" or "10:08 AM" — combine with tripDate
  if (tripDate) {
    // Try HH:MM:SS or HH:MM AM/PM
    const timeMatch = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
      const ampm = timeMatch[4]?.toUpperCase();

      if (ampm === 'PM' && hours < 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;

      // Create date in Philippine time (UTC+8)
      const phDate = new Date(`${tripDate}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}+08:00`);
      if (!Number.isNaN(phDate.getTime())) return phDate;
    }
  }

  return null;
}

/**
 * Parse a Cartrack record's time field into a Date, using tripDate
 * as fallback context for time-only values.
 */
function parseCartrackTime(record: CartrackHistoryPoint, tripDate: string | null): Date | null {
  const candidates: unknown[] = [
    record.Time,
    record.time,
    record.timestamp,
    record.clock,
    record.Clock,
    record["Clock (raw)"],
    record["Clock"],
  ];

  // Log raw candidate values for debugging (first time only)
  for (const value of candidates) {
    if (value !== null && value !== undefined && value !== '') {
      const parsed = parseSingleTimeValue(value, tripDate);
      if (parsed && !Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }

  return null;
}

// ── Normalization ─────────────────────────────────────────────

/**
 * Normalize a Cartrack record into a standardized fleet-history row.
 */
function normalizeCartrackRecord(
  record: CartrackHistoryPoint,
  index: number,
  tripDate: string | null,
): {
  normalized: {
    time: string;
    status: string;
    events: string;
    roadSpeed: number;
    location: string;
    latitude: number;
    longitude: number;
    raw: CartrackHistoryPoint;
  } | null;
  reason: string | null;
} {
  // ── Extract time using robust parser ──
  const timeParsed = parseCartrackTime(record, tripDate);
  const timeStr = timeParsed ? msToManilaTimeString(timeParsed.getTime()) : null;

  // ── Extract latitude / longitude ──
  const lat = Number(record.Latitude ?? record.latitude);
  const lon = Number(record.Longitude ?? record.longitude);
  const validLat = Number.isFinite(lat);
  const validLon = Number.isFinite(lon);

  // ── Validation ──
  if (!timeParsed || !timeStr) {
    return {
      normalized: null,
      reason: `time missing or unparseable (clock=${JSON.stringify(record.clock)}, Time=${JSON.stringify(record.Time)}, time=${JSON.stringify(record.time)}, Clock=${JSON.stringify(record.Clock)}, ClockRaw=${JSON.stringify(record["Clock (raw)"])})`,
    };
  }
  if (!validLat) {
    return {
      normalized: null,
      reason: `latitude invalid (latitude=${JSON.stringify(record.latitude)}, Latitude=${JSON.stringify(record.Latitude)})`,
    };
  }
  if (!validLon) {
    return {
      normalized: null,
      reason: `longitude invalid (longitude=${JSON.stringify(record.longitude)}, Longitude=${JSON.stringify(record.Longitude)})`,
    };
  }

  // ── Compute status ──
  const status = deriveStatus(record);

  // ── Extract other fields ──
  const events = String(record.Events ?? record.events ?? '');
  const roadSpeed = deriveRoadSpeed(record);
  const location = String(record.Location ?? record.location ?? '');

  return {
    normalized: {
      time: timeStr,
      status,
      events,
      roadSpeed,
      location,
      latitude: lat,
      longitude: lon,
      raw: record,
    },
    reason: null,
  };
}

/**
 * Sort detailed events with proper normalization, debug logging,
 * and robust timestamp parsing using tripDate context.
 */
function sortDetailedEvents(
  points: CartrackHistoryPoint[],
  tripDate: string | null,
): TimedPoint[] {
  const validNormalized: {
    time: string;
    status: string;
    events: string;
    roadSpeed: number;
    location: string;
    latitude: number;
    longitude: number;
    raw: CartrackHistoryPoint;
  }[] = [];
  const rejected: { index: number; clock: unknown; latitude: unknown; longitude: unknown; reason: string }[] = [];

  // ── Debug log raw fields for first 10 records ──
  for (let i = 0; i < Math.min(points.length, 10); i++) {
    const r = points[i];
    console.log(
      `[SyncHistory] Raw debug #${i}: clock=${JSON.stringify(r.clock)}, typeofClock=${typeof r.clock}, ` +
      `Clock=${JSON.stringify(r["Clock"])}, ClockRaw=${JSON.stringify(r["Clock (raw)"])}, ` +
      `Time=${JSON.stringify(r["Time"])}, time=${JSON.stringify(r.time)}, ` +
      `timestamp=${JSON.stringify(r.timestamp)}`
    );
  }

  for (let i = 0; i < points.length; i++) {
    const record = points[i];
    const clockVal = record.clock ?? record.Clock ?? record.time ?? record.Time;
    const result = normalizeCartrackRecord(record, i, tripDate);

    if (result.normalized === null) {
      rejected.push({
        index: i,
        clock: clockVal,
        latitude: record.latitude ?? record.Latitude,
        longitude: record.longitude ?? record.Longitude,
        reason: result.reason!,
      });
    } else {
      validNormalized.push(result.normalized);
    }
  }

  // ── Log all rejected records ──
  for (const r of rejected) {
    console.log(
      `[SyncHistory] REJECTED raw record #${r.index}: clock=${JSON.stringify(r.clock)}, ` +
      `lat=${JSON.stringify(r.latitude)}, lon=${JSON.stringify(r.longitude)}, reason=${r.reason}`
    );
  }

  // ── Log normalization summary ──
  console.log(`[SyncHistory] Normalization: ${points.length} raw → ${validNormalized.length} valid normalized, ${rejected.length} rejected`);

  // ── Log first 10 normalized rows ──
  for (let i = 0; i < Math.min(validNormalized.length, 10); i++) {
    const n = validNormalized[i];
    console.log(
      `[SyncHistory] Normalized row #${i}: time=${n.time}, parsedTime=${new Date(n.time).toISOString()}, ` +
      `status=${n.status}, roadSpeed=${n.roadSpeed}, lat=${n.latitude}, lon=${n.longitude}, ` +
      `ignition=${JSON.stringify(n.raw.ignition)}`
    );
  }

  // ── Map to TimedPoint ──
  return validNormalized
    .map((n) => {
      const tsMs = new Date(n.time).getTime();
      return {
        point: n.raw,
        tsMs,
        status: n.status as 'Driving' | 'Idling' | 'Off',
        speed: n.roadSpeed,
        coord: toCoordStr(n.raw),
        locationName: n.location,
        latitude: n.latitude,
        longitude: n.longitude,
      } satisfies TimedPoint;
    })
    .sort((a, b) => a.tsMs - b.tsMs);
}

// ── TO Matching Helpers ──────────────────────────────────────

/**
 * Find the Driving event closest to a target timestamp.
 * Uses the resolved tolerance — defaults to 10 if not positive.
 */
function findClosestDrivingEvent(
  events: TimedPoint[],
  targetMs: number | null,
  toleranceMinutes: number,
  label: string,
  log: (msg: string) => void,
): { event: TimedPoint; index: number; diffMs: number; withinTolerance: boolean } | null {
  if (targetMs === null) {
    log(`  ${label}: No target timestamp provided`);
    return null;
  }

  const effectiveTolerance = Number.isFinite(toleranceMinutes) && toleranceMinutes > 0 ? toleranceMinutes : 10;
  const toleranceMs = effectiveTolerance * 60 * 1000;

  let best: { event: TimedPoint; index: number; diffMs: number; withinTolerance: boolean } | null = null;

  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (event.status !== 'Driving') continue;
    const diffMs = Math.abs(event.tsMs - targetMs);
    const diffMinutes = diffMs / 60000;
    const withinTolerance = diffMs <= toleranceMs;

    log(
      `  ${label}: Candidate Driving row at ${new Date(event.tsMs).toISOString()} | ` +
      `diffFromTarget=${diffMinutes.toFixed(1)}m | withinTolerance=${withinTolerance} | ` +
      `coord=${event.coord} | location=${event.locationName} | speed=${event.speed}`
    );

    if (!best || diffMs < best.diffMs) {
      best = { event, index, diffMs, withinTolerance };
    }
  }

  if (!best) {
    log(`  ${label}: No Driving events found in fleet trip history`);
    return null;
  }

  log(
    `  ${label}: Closest Driving row at ${new Date(best.event.tsMs).toISOString()} ` +
    `(diff=${(best.diffMs / 60000).toFixed(1)}m, tolerance=${effectiveTolerance}m)`
  );

  if (!best.withinTolerance) {
    log(`  ${label}: REJECTED — closest Driving row is ${(best.diffMs / 60000).toFixed(1)}m outside tolerance of ${effectiveTolerance}m`);
    return null;
  }

  return best;
}

/**
 * After a matched Driving row, find the first row where:
 * - Status = Idling
 * - OR Status = Stationary (Off)
 * - OR Road Speed = 0 after Driving
 */
function findArrivalEvent(
  events: TimedPoint[],
  startIndex: number,
  label: string,
  log: (msg: string) => void,
): TimedPoint | null {
  let fallback: TimedPoint | null = null;

  log(`  ${label}: Scanning for arrival after index ${startIndex} (${new Date(events[startIndex].tsMs).toISOString()})`);

  for (let index = startIndex + 1; index < events.length; index++) {
    const event = events[index];
    const isArrival =
      event.status === 'Idling' ||
      event.status === 'Off' ||
      (event.status === 'Driving' && event.speed === 0);

    log(
      `  ${label}:   Event at ${new Date(event.tsMs).toISOString()} | ` +
      `status=${event.status} | speed=${event.speed} | coord=${event.coord} | ` +
      `location=${event.locationName} | isArrival=${isArrival}`
    );

    if (isArrival) {
      log(`  ${label}: ✅ Arrival detected at ${new Date(event.tsMs).toISOString()} (status=${event.status}, speed=${event.speed})`);
      return event;
    }

    if (!fallback) fallback = event;
  }

  if (fallback) {
    log(`  ${label}: ⚠️ No arrival event found, using last event at ${new Date(fallback.tsMs).toISOString()} as fallback`);
    return fallback;
  }

  log(`  ${label}: ❌ No events found after startIndex`);
  return null;
}

function buildTripFromEvents(
  start: TimedPoint,
  arrival: TimedPoint | null,
  tripType: 'OUTBOUND' | 'RETURN',
  parentTrip: DetectedTrip | null = null,
  originOverride: string | null = null,
  destinationOverride: string | null = null,
  travelOrder: TravelOrderWithTimes | null = null,
): DetectedTrip {
  const startIndexTime = start.tsMs;
  const arrivalTime = arrival ? (arrival.tsMs >= startIndexTime ? arrival.tsMs : startIndexTime) : startIndexTime;
  const hours = Math.max(0, (arrivalTime - startIndexTime) / (1000 * 60 * 60));
  const maxSpeedKph = Math.max(start.speed, arrival?.speed ?? 0);

  return {
    departureTime: msToManilaTimeString(start.tsMs),
    arrivalTime: msToManilaTimeString(arrivalTime),
    gpsStartCoord: start.coord,
    gpsEndCoord: arrival?.coord ?? start.coord,
    originName: originOverride ?? start.locationName,
    destinationName: destinationOverride ?? (arrival?.locationName ?? start.locationName),
    maxSpeedKph,
    engineHours: Number(start.point.engine_hours ?? start.point.engineHours ?? 0),
    distanceKm: hours * Math.max(maxSpeedKph, 0),
    tripType,
    parentTrip,
    travelOrder,
  };
}

/**
 * REDESIGNED: GPS Sync Logic for Travel Orders.
 *
 * The fleet trip records are only containers. Each fleet trip record
 * contains detailed fleet trip history rows. This function inspects
 * those detailed history rows and identifies the specific trip segment
 * that corresponds to the Travel Order.
 */
function reconstructTripsForTravelOrders(
  points: CartrackHistoryPoint[],
  travelOrders: TravelOrderWithTimes[],
  tripDate: string,
  log: (msg: string) => void,
): DetectedTrip[] {
  const events = sortDetailedEvents(points, tripDate);
  log(`Sorted ${events.length} detailed event(s) by clock/timestamp ascending`);
  log(`TO driving match tolerance: ±${resolvedToleranceMinutes} minute(s)`);

  const trips: DetectedTrip[] = [];

  for (const to of travelOrders) {
    const parsedDeparture = parseTimestampSafe(to.scheduled_departure, 'TO scheduled_departure');
    const parsedArrival = parseTimestampSafe(to.scheduled_arrival, 'TO scheduled_arrival');
    const depMs = parsedDeparture;
    const retMs = parsedArrival;

    console.log('TO raw scheduled_departure', to.scheduled_departure, typeof to.scheduled_departure);
    console.log('TO raw scheduled_arrival', to.scheduled_arrival, typeof to.scheduled_arrival);
    console.log('TO parsed departure', parsedDeparture ? new Date(parsedDeparture).toISOString() : null);
    console.log('TO parsed arrival', parsedArrival ? new Date(parsedArrival).toISOString() : null);

    log(`\n═══════════════════════════════════════════════════════════`);
    log(`Processing TO #${to.to_number ?? to.id}`);
    log(`  TO Departure Time: ${to.scheduled_departure}`);
    log(`  TO Return Time: ${to.scheduled_arrival}`);
    log(`  TO Destination: ${to.lat_long_destination}`);
    log(`═══════════════════════════════════════════════════════════`);

    // ── Outbound ──
    log(`\n─── OUTBOUND TRIP ───`);
    log(`Finding closest Driving row to departure ${to.scheduled_departure}...`);

    // Check if the TO departure time falls within the trip's time window
    const outboundMatch = findClosestDrivingEvent(events, depMs, resolvedToleranceMinutes, 'Outbound', log);
    if (!outboundMatch) {
      log(`  ❌ No Driving event within tolerance for TO departure; outbound not reconstructed`);
      continue;
    }

    // Debug: show raw timestamps and difference
    const depDiffMin = depMs !== null
      ? Math.round((outboundMatch.event.tsMs - depMs) / 60000)
      : null;
    log(`TO departure raw: ${to.scheduled_departure}`);
    log(`GPS departure raw: ${msToManilaTimeString(outboundMatch.event.tsMs)}`);
    if (depDiffMin !== null) log(`Difference minutes: ${depDiffMin}`);

    log(
      `\n  ✅ Selected outbound departure row: ` +
      `time=${new Date(outboundMatch.event.tsMs).toISOString()} | ` +
      `diff=${(outboundMatch.diffMs / 60000).toFixed(1)}m | ` +
      `coord=${outboundMatch.event.coord} | ` +
      `location=${outboundMatch.event.locationName} | ` +
      `speed=${outboundMatch.event.speed}`
    );

    log(`\nFinding arrival after outbound departure...`);
    const outboundArrival = findArrivalEvent(events, outboundMatch.index, 'Outbound', log);

    if (!outboundArrival) {
      log(`  ❌ No arrival found for outbound trip`);
      continue;
    }

    log(
      `  ✅ Selected outbound arrival row: ` +
      `time=${new Date(outboundArrival.tsMs).toISOString()} | ` +
      `status=${outboundArrival.status} | ` +
      `coord=${outboundArrival.coord} | ` +
      `location=${outboundArrival.locationName}`
    );

    const originCoord = outboundMatch.event.coord;
    const originLat = outboundMatch.event.latitude;
    const originLon = outboundMatch.event.longitude;
    const destCoord = outboundArrival.coord;
    const destLat = outboundArrival.latitude;
    const destLon = outboundArrival.longitude;

    log(`\n  Origin (GPS Start): coord=${originCoord} | lat=${originLat} | lon=${originLon}`);
    log(`  Destination (GPS End): coord=${destCoord} | lat=${destLat} | lon=${destLon}`);

    let destVerified = false;
    if (destCoord && to.lat_long_destination) {
      const dist = haversineDistance(destCoord, to.lat_long_destination);
      log(`\n  Destination Validation:`);
      log(`    GPS Dest: ${destCoord}`);
      log(`    TO Dest: ${to.lat_long_destination}`);
      log(`    Distance: ${dist.toFixed(1)}m (threshold: ${DISTANCE_THRESHOLD_M}m)`);
      destVerified = dist <= DISTANCE_THRESHOLD_M;
      log(`    Result: ${destVerified ? '✅ CONFIRMED' : '❌ NOT WITHIN THRESHOLD'}`);
    } else if (destCoord && !to.lat_long_destination) {
      log(`  ⚠️ TO has no lat_long_destination — cannot validate destination`);
    } else {
      log(`  ⚠️ No GPS destination coordinate available for validation`);
    }

    const outbound = buildTripFromEvents(
      outboundMatch.event, outboundArrival, 'OUTBOUND', null, null, null, to,
    );
    trips.push(outbound);

    log(`\n  ✅ Outbound trip created:`);
    log(`    Departure: ${outbound.departureTime}`);
    log(`    Arrival: ${outbound.arrivalTime}`);
    log(`    Origin Coord: ${outbound.gpsStartCoord}`);
    log(`    Dest Coord: ${outbound.gpsEndCoord}`);
    log(`    Origin Name: ${outbound.originName}`);
    log(`    Dest Name: ${outbound.destinationName}`);
    log(`    Dest Verified: ${destVerified}`);

    // ── Return ──
    let returnTrip: DetectedTrip | null = null;

    // Search for return trip only in events AFTER outbound arrival
    const outboundArrivalMs = outbound.arrivalTime ? new Date(outbound.arrivalTime).getTime() : null;

    log(`\n─── RETURN TRIP ───`);

    if (!outboundArrivalMs) {
      log(`  ❌ Outbound has no arrival time — RETURN trip not found`);
      log(`  Only OUTBOUND record created.`);
    } else {
    log(`Outbound arrival: ${outbound.arrivalTime} (${outboundArrivalMs})`);

    // Filter events that occur after outbound arrival
    const afterOutbound = events.filter(e => e.tsMs > outboundArrivalMs);
    log(`Events after outbound arrival: ${afterOutbound.length}`);

    if (afterOutbound.length === 0) {
      log(`  ❌ No events after outbound arrival — RETURN trip not found`);
      log(`  Only OUTBOUND record created.`);
    } else {
      // Find closest Driving event AFTER outbound arrival to TO scheduled return time (or just the first driving event after)
      const retMs = parsedArrival;
      let returnMatch: { event: TimedPoint; index: number; diffMs: number; withinTolerance: boolean } | null = null;

      if (retMs !== null) {
        // Find closest driving event to scheduled return time, but ONLY from events after outbound arrival
        for (let index = 0; index < afterOutbound.length; index++) {
          const event = afterOutbound[index];
          if (event.status !== 'Driving') continue;
          const diffMs = Math.abs(event.tsMs - retMs);
          const withinTolerance = diffMs <= TO_MATCH_TOLERANCE_MS;

          log(
            `  Return candidate: time=${new Date(event.tsMs).toISOString()} | ` +
            `diffFromScheduled=${(diffMs / 60000).toFixed(1)}m | withinTolerance=${withinTolerance} | ` +
            `coord=${event.coord} | location=${event.locationName}`
          );

          if (!returnMatch || diffMs < returnMatch.diffMs) {
            returnMatch = { event, index, diffMs, withinTolerance };
          }
        }
      } else {
        // No scheduled return time — just find the first driving event after outbound arrival
        for (let index = 0; index < afterOutbound.length; index++) {
          const event = afterOutbound[index];
          if (event.status !== 'Driving') continue;
          returnMatch = { event, index, diffMs: 0, withinTolerance: true };
          break;
        }
      }

      if (!returnMatch) {
        log(`  ❌ No Driving event found after outbound arrival — RETURN trip not found`);
        log(`  Only OUTBOUND record created.`);
      } else if (!returnMatch.withinTolerance && retMs !== null) {
        log(
          `  ❌ Closest return departure is ${(returnMatch.diffMs / 60000).toFixed(1)}m ` +
          `outside tolerance of ${resolvedToleranceMinutes}m — RETURN trip not found`
        );
        log(`  Only OUTBOUND record created.`);
      } else {
        log(
          `\n  ✅ Selected return departure row: ` +
          `time=${new Date(returnMatch.event.tsMs).toISOString()} | ` +
          `diff=${(returnMatch.diffMs / 60000).toFixed(1)}m | ` +
          `coord=${returnMatch.event.coord} | ` +
          `location=${returnMatch.event.locationName} | ` +
          `speed=${returnMatch.event.speed}`
        );

        log(`\nFinding arrival after return departure...`);
        // Find arrival in the full events array, starting from the return departure index
        // Map back to the original events array index
        const originalIndex = events.findIndex(e => e.tsMs === returnMatch!.event.tsMs);
        const returnArrival = findArrivalEvent(events, originalIndex >= 0 ? originalIndex : returnMatch.index, 'Return', log);

        if (!returnArrival) {
          log(`  ❌ No arrival found for return trip`);
          log(`  Only OUTBOUND record created.`);
        } else {
          log(
            `  ✅ Selected return arrival row: ` +
            `time=${new Date(returnArrival.tsMs).toISOString()} | ` +
            `status=${returnArrival.status} | ` +
            `coord=${returnArrival.coord} | ` +
            `location=${returnArrival.locationName}`
          );

          const returnStartCoord = returnMatch.event.coord;
          const returnEndCoord = returnArrival.coord;

          log(`\n  Return Start Coord (departure): ${returnStartCoord}`);
          log(`  Return End Coord (arrival): ${returnEndCoord}`);

          // Validate: return start must be near TO destination
          const toDestCoord = to.lat_long_destination;
          let startNearDest = false;
          if (returnStartCoord && toDestCoord) {
            const distToDest = haversineDistance(returnStartCoord, toDestCoord);
            log(`\n  Return Start → TO Destination:`);
            log(`    Return Start: ${returnStartCoord}`);
            log(`    TO Destination: ${toDestCoord}`);
            log(`    Distance: ${distToDest.toFixed(1)}m (threshold: ${DISTANCE_THRESHOLD_M}m)`);
            startNearDest = distToDest <= DISTANCE_THRESHOLD_M;
            log(`    Result: ${startNearDest ? '✅ WITHIN THRESHOLD' : '❌ NOT WITHIN THRESHOLD'}`);
          } else if (!toDestCoord) {
            log(`  ⚠️ TO has no lat_long_destination — cannot validate return start`);
          } else {
            log(`  ⚠️ Return trip has no start coordinate — cannot validate`);
          }

          // Validate: return end must be near TO origin
          const toOriginCoord = to.lat_long_origin;
          let endNearOrigin = false;
          if (returnEndCoord && toOriginCoord) {
            const distToOrigin = haversineDistance(returnEndCoord, toOriginCoord);
            log(`\n  Return End → TO Origin:`);
            log(`    Return End: ${returnEndCoord}`);
            log(`    TO Origin: ${toOriginCoord}`);
            log(`    Distance: ${distToOrigin.toFixed(1)}m (threshold: ${DISTANCE_THRESHOLD_M}m)`);
            endNearOrigin = distToOrigin <= DISTANCE_THRESHOLD_M;
            log(`    Result: ${endNearOrigin ? '✅ WITHIN THRESHOLD' : '❌ NOT WITHIN THRESHOLD'}`);
          } else if (!toOriginCoord) {
            log(`  ⚠️ TO has no lat_long_origin — cannot validate return end`);
          } else {
            log(`  ⚠️ Return trip has no end coordinate — cannot validate`);
          }

          if (startNearDest && endNearOrigin) {
            // Build return trip using its OWN times (not copying outbound)
            returnTrip = buildTripFromEvents(
              returnMatch.event, returnArrival, 'RETURN', outbound,
              outbound.destinationName, outbound.originName, to,
            );
            // Use actual return coordinates
            returnTrip.gpsStartCoord = returnStartCoord;
            returnTrip.gpsEndCoord = returnEndCoord;
            returnTrip.travelOrder = to;

            const returnVerified = true;
            log(`\n  ✅ Return trip created:`);
            log(`    Departure: ${returnTrip.departureTime}`);
            log(`    Arrival: ${returnTrip.arrivalTime}`);
            log(`    Origin Coord: ${returnTrip.gpsStartCoord}`);
            log(`    Dest Coord: ${returnTrip.gpsEndCoord}`);
            log(`    Origin Name: ${returnTrip.originName}`);
            log(`    Dest Name: ${returnTrip.destinationName}`);
            log(`    Start near TO dest: ✅`);
            log(`    End near TO origin: ✅`);
            log(`    tripId: ${returnTrip.departureTime}-${returnTrip.arrivalTime} (DIFFERENT from outbound)`);
          } else {
            log(`\n  ❌ RETURN rejected — coordinate validation failed`);
            log(`    Start near TO dest: ${startNearDest ? '✅' : '❌'}`);
            log(`    End near TO origin: ${endNearOrigin ? '✅' : '❌'}`);
            log(`  Only OUTBOUND record created.`);
          }
        }
      }
    }

    if (returnTrip) {
      trips.push(returnTrip);
    }
  }
  }

  log(`\n═══════════════════════════════════════════════════════════`);
  log(`Total trips reconstructed: ${trips.length}`);
  log(`═══════════════════════════════════════════════════════════`);

  return trips;
}

function detectReturnTrips(rawTrips: ReconstructedTrip[]): DetectedTrip[] {
  const outbound: ReconstructedTrip[] = [];
  const returns: DetectedTrip[] = [];

  for (let i = 0; i < rawTrips.length; i++) {
    const trip = rawTrips[i];
    if (i > 0) {
      const prev = rawTrips[i - 1];
      if (!prev.arrivalTime || !trip.departureTime) continue;

      const curDepartMs = new Date(trip.departureTime).getTime();
      const prevArrMs = new Date(prev.arrivalTime).getTime();
      if (curDepartMs - prevArrMs > 8 * 60 * 1000) continue;

      const depCoord = parseCoord(trip.gpsStartCoord ?? trip.originName);
      const prevDestCoord = parseCoord(prev.gpsEndCoord ?? prev.destinationName);
      if (depCoord && prevDestCoord) {
        const dist = haversineDistance(
          `${depCoord.lat},${depCoord.lon}`,
          `${prevDestCoord.lat},${prevDestCoord.lon}`,
        );
        if (dist <= DISTANCE_THRESHOLD_M) {
          returns.push({ ...trip, tripType: 'RETURN', parentTrip: prev } as DetectedTrip);
          continue;
        }
      }
    }
    outbound.push(trip);
  }

  const result: DetectedTrip[] = [];
  for (const t of outbound) result.push({ ...t, tripType: 'OUTBOUND', parentTrip: null });
  for (const t of returns) result.push(t);
  return result;
}

// ── Destination Name Resolution ────────────────────────────────

async function resolveLocationName(
  candidateCoord: string | null,
  travelOrder: TravelOrderWithTimes | null,
): Promise<string | null> {
  if (travelOrder?.location_name) return travelOrder.location_name;
  if (candidateCoord) {
    const parsed = parseCoord(candidateCoord);
    if (parsed) {
      const name = await reverseGeocode(parsed.lat, parsed.lon);
      if (name) return name;
    }
  }
  return null;
}

// ── Deduplication ──────────────────────────────────────────────

async function isDuplicateTrip(
  vehicleId: string,
  departureTime: string | null,
  arrivalTime: string | null,
  tripType: 'OUTBOUND' | 'RETURN',
): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT 1
       FROM gps_trip_logs
      WHERE vehicle_id = $1
        AND trip_type = $2
        AND departure_time_gps ${departureTime ? '= $3' : 'IS NULL'}
        AND arrival_time_gps ${arrivalTime ? '= $4' : 'IS NULL'}
      LIMIT 1`,
    departureTime && arrivalTime
      ? [vehicleId, tripType, departureTime, arrivalTime]
      : departureTime
        ? [vehicleId, tripType, departureTime]
        : arrivalTime
          ? [vehicleId, tripType, arrivalTime]
          : [vehicleId, tripType],
  );
  return result.rows.length > 0;
}

// ── Main Export ────────────────────────────────────────────────

export async function syncTrackingHistory(
  fromDate: string,
  toDate: string,
): Promise<TrackingHistorySyncResult> {
  const startTime = Date.now();
  const pool = getPool();

  const vehiclesResult = await pool.query<{ id: string; plate_number: string }>(
    `SELECT id, plate_number FROM vehicles ORDER BY plate_number`,
  );
  const vehicles = vehiclesResult.rows;

  const results: SyncVehicleResult[] = [];
  let totalTripsCreated = 0;
  let totalTripsFailed = 0;

  for (const vehicle of vehicles) {
    const { id: vehicleId, plate_number } = vehicle;

    const candidateTOs: TravelOrderWithTimes[] = [];
    const from = new Date(fromDate);
    const to = new Date(toDate);
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const tos = await findAllTravelOrdersForDate(vehicleId, dateStr);
      for (const tro of tos) {
        if (!candidateTOs.some((c) => c.id === tro.id)) candidateTOs.push(tro);
      }
    }

    if (candidateTOs.length === 0) {
      results.push({ status: 'no_travel_order' });
      continue;
    }

    const primaryTO = candidateTOs[0];
    const resolvedDriverId = primaryTO.driver_id || null;

    let driverName: string | null = null;
    if (resolvedDriverId) {
      const driverRow = await pool.query<{ full_name: string }>(
        `SELECT full_name FROM drivers WHERE id = $1 LIMIT 1`,
        [resolvedDriverId],
      );
      driverName = driverRow.rows[0]?.full_name ?? null;
    }

    const unitInfo = await resolveCartrackUnitId(plate_number);
    if (!unitInfo) {
      results.push({ status: 'cartrack_unavailable' });
      continue;
    }

    let vehicleTripsCreated = 0;
    let vehicleTripsFailed = 0;

    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const historyPoints = await fetchCartrackVehicleHistory(unitInfo.unitId, dateStr, plate_number);
      if (historyPoints.length === 0) continue;

      const rawTrips = reconstructTripsFromBreadcrumbs(historyPoints);
      if (rawTrips.length === 0) continue;

      const detectedTrips = detectReturnTrips(rawTrips);

      for (const trip of detectedTrips) {
        const dup = await isDuplicateTrip(
          vehicleId, trip.departureTime, trip.arrivalTime, trip.tripType ?? 'OUTBOUND',
        );
        if (dup) continue;

        // ── Validation: skip if departure/arrival times are missing or invalid ──
        if (!trip.departureTime || !trip.arrivalTime || trip.departureTime === trip.arrivalTime) {
          vehicleTripsFailed += 1;
          continue;
        }
        const depMs = new Date(trip.departureTime).getTime();
        const arrMs = new Date(trip.arrivalTime).getTime();
        if (arrMs <= depMs) {
          vehicleTripsFailed += 1;
          continue;
        }

        // ── Validation: must have coordinates ──
        if (!trip.gpsStartCoord || !trip.gpsEndCoord) {
          vehicleTripsFailed += 1;
          continue;
        }

        // ── Validation: distance check ──
        const drivingDurationHours = (arrMs - depMs) / (1000 * 60 * 60);
        const estimatedDistanceKm = drivingDurationHours * 40;
        if (estimatedDistanceKm <= 0 && (trip.distanceKm ?? 0) <= 0) {
          vehicleTripsFailed += 1;
          continue;
        }
        if (estimatedDistanceKm > 500) {
          vehicleTripsFailed += 1;
          continue;
        }

        const tosForDate = await findAllTravelOrdersForDate(vehicleId, dateStr);
        const matchedTO = matchTravelOrderToGpsTrip(
          trip.departureTime, trip.arrivalTime, trip.gpsEndCoord,
          tosForDate.length > 0 ? tosForDate : candidateTOs,
        );

        // ── STRICT: reject if no TO match found ──
        if (!matchedTO) {
          vehicleTripsFailed += 1;
          continue;
        }

        const driverId = matchedTO.driver_id ?? resolvedDriverId;
        const travelOrderId = matchedTO.id;
        const toStatusAuto = matchedTO.status ?? primaryTO.status;

        const coordinatesOrigin = trip.gpsStartCoord ?? null;
        const coordinatesDestination = trip.gpsEndCoord ?? null;

        const destCoordForMatch = trip.gpsEndCoord;
        const destVerified = destCoordForMatch && matchedTO?.lat_long_destination
          ? haversineDistance(destCoordForMatch, matchedTO.lat_long_destination) <= DISTANCE_THRESHOLD_M
          : false;

        // Do NOT store destination in location_name per requirements
        const locationName = null;

        const gpsRecordNoResult = await pool.query<{ max_seq: string | null }>(
          `SELECT MAX(CAST(SPLIT_PART(gps_record_no, '-', 3) AS INTEGER)) AS max_seq
             FROM gps_trip_logs
            WHERE gps_record_no LIKE $1`,
          [`GPS-${new Date().getFullYear()}-%`],
        );
        const nextSeq = (parseInt(gpsRecordNoResult.rows[0]?.max_seq || '0', 10)) + 1;
        const gpsRecordNo = `GPS-${new Date().getFullYear()}-${String(nextSeq).padStart(4, '0')}`;

        const insertData: GpsLogInsertData = {
          gpsRecordNo,
          tripDate: dateStr,
          vehicleId: vehicleId,
          driverId: driverId || null,
          originGpsStartPoint: trip.originName,
          destinationGpsEndPoint: trip.destinationName,
          coordinatesOrigin,
          coordinatesDestination,
          actualRouteRoadTaken: GPS_POINT_ROAD_PLACEHOLDER,
          departureTimeGps: trip.departureTime,
          arrivalTimeGps: trip.arrivalTime,
          gpsDistanceKm: clampNumeric(trip.distanceKm || 0, 99999999.99),
          engineHours: clampNumeric(trip.engineHours || 0, 999999.99),
          maxSpeedKph: clampNumeric(trip.maxSpeedKph || 0, 9999.99),
          tripStatusGps: trip.arrivalTime ? 'arrived' : 'en-route',
          travelOrderId: travelOrderId,
          toStatusAuto: toStatusAuto,
          anomalyFlag: false,
          notesRemarks: null,
          destinationVerified: destVerified,
          tripType: trip.tripType ?? 'OUTBOUND',
          parentTripId: null,
        };

        try {
          const saved = await saveGpsTripLog(insertData);
          vehicleTripsCreated += 1;

          if (trip.tripType === 'RETURN' && trip.parentTrip) {
            const parentResult = await pool.query<{ id: string }>(
              `SELECT id
                 FROM gps_trip_logs
                WHERE vehicle_id = $1
                  AND trip_date = $2
                  AND trip_type = 'OUTBOUND'
                  AND departure_time_gps = $3
                LIMIT 1`,
              [vehicleId, dateStr, trip.parentTrip.departureTime],
            );
            const parentId = parentResult.rows[0]?.id ?? null;
            if (parentId) {
              await pool.query(`UPDATE gps_trip_logs SET parent_trip_id = $1 WHERE id = $2`, [
                parentId, saved.id,
              ]);
            }
          }
        } catch (err) {
          console.error(`SyncTrackingHistory: save error for ${plate_number} on ${dateStr}:`, (err as Error).message);
          vehicleTripsFailed += 1;
        }
      }
    }

    if (vehicleTripsCreated > 0 || vehicleTripsFailed > 0) {
      results.push({
        status: 'completed',
        tripsCreated: vehicleTripsCreated,
        tripsFailed: vehicleTripsFailed,
        vehiclePlate: plate_number,
      });
    } else {
      results.push({ status: 'no_gps_data' });
    }

    totalTripsCreated += vehicleTripsCreated;
    totalTripsFailed += vehicleTripsFailed;
  }

  const elapsedSeconds = (Date.now() - startTime) / 1000;

  return {
    success: true,
    fromDate,
    toDate,
    totalVehiclesProcessed: vehicles.length,
    totalTripsCreated,
    totalTripsFailed,
    results,
    elapsedSeconds,
  };
}

function clampNumeric(value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(value, max);
}

// ── Exported Helper for Single-Vehicle Sync ──────────────────

/**
 * Sync a single vehicle on a single date using the advanced trip
 * reconstruction algorithm (driving→idling→10min→arrival detection,
 * return trip detection, coordinate verification, etc.).
 *
 * Returns the number of trips created.
 */
export async function syncSingleVehicleDate(
  vehicleId: string,
  plateNumber: string,
  dateStr: string,
): Promise<{ tripsCreated: number; tripsFailed: number; matchedToNumber: string | null; debugLogs: string[] }> {
  const debugLogs: string[] = [];
  const pool = getPool();

  function log(msg: string) {
    console.log(`[SyncHistory] ${msg}`);
    debugLogs.push(msg);
  }

  // ── Step 1: Find travel orders for this vehicle on this date ──
  log(`Looking up travel orders for vehicle ${plateNumber} on ${dateStr}`);
  const travelOrderCandidates = await findAllTravelOrdersForDate(vehicleId, dateStr);

  if (!travelOrderCandidates || travelOrderCandidates.length === 0) {
    log(`No travel orders found for ${plateNumber} on ${dateStr}. Sync aborted.`);
    return { tripsCreated: 0, tripsFailed: 0, matchedToNumber: null, debugLogs };
  }

  log(`${travelOrderCandidates.length} travel order(s) found:`);
  for (const to of travelOrderCandidates) {
    log(`  TO #${to.to_number} | dep=${to.scheduled_departure} | arr=${to.scheduled_arrival} | dest=${to.lat_long_destination}`);
  }

  const primaryTO = travelOrderCandidates[0];
  const resolvedDriverId = primaryTO.driver_id || null;

  // Resolve driver name
  let driverName: string | null = null;
  if (resolvedDriverId) {
    const driverRow = await pool.query<{ full_name: string }>(
      `SELECT full_name FROM drivers WHERE id = $1 LIMIT 1`,
      [resolvedDriverId],
    );
    driverName = driverRow.rows[0]?.full_name ?? null;
  }

  // ── Step 2: Resolve Cartrack unit ──
  log(`Resolving Cartrack unit ID for plate ${plateNumber}`);
  const unitInfo = await resolveCartrackUnitId(plateNumber);
  if (!unitInfo) {
    log(`Could not resolve Cartrack unit ID for ${plateNumber}. Sync aborted.`);
    return { tripsCreated: 0, tripsFailed: 0, matchedToNumber: null, debugLogs };
  }
  log(`Cartrack unit ID resolved: ${unitInfo.unitId}`);

  // ── Step 3: Fetch raw breadcrumbs ──
  log(`Fetching Cartrack history for ${plateNumber} on ${dateStr}`);
  const historyPoints = await fetchCartrackVehicleHistory(unitInfo.unitId, dateStr, plateNumber);
  log(`Fetched ${historyPoints.length} history points from Cartrack`);

  if (historyPoints.length === 0) {
    log(`No GPS data found for ${plateNumber} on ${dateStr}`);
    return { tripsCreated: 0, tripsFailed: 0, matchedToNumber: null, debugLogs };
  }

  // ── Step 4: Classify the fetched data ──
  const firstPoint = historyPoints[0];
  const isDetailedData = firstPoint && (firstPoint.ignition !== undefined || firstPoint.speed !== undefined);
  const isTripSummaries = looksLikeTripSummary(firstPoint);
  const isFleetHistoryRow = firstPoint ? looksLikeFleetTripHistoryRow(firstPoint) : false;

  log(`Data classification: detailed=${isDetailedData}, tripSummaries=${isTripSummaries}, fleetHistoryRow=${isFleetHistoryRow}`);

  // Log ALL raw keys for every record (not just 15) to identify available fields
  for (let i = 0; i < Math.min(historyPoints.length, 5); i++) {
    const allKeys = Object.keys(historyPoints[i]);
    log(`  Record #${i + 1} all keys (${allKeys.length}): ${JSON.stringify(allKeys)}`);
    // Log critical fleet history fields
    const p = historyPoints[i];
    log(`    Time=${JSON.stringify(p.Time ?? p.time)} | Status=${JSON.stringify(p.Status ?? p.status)} | Events=${JSON.stringify(p.Events ?? p.events)} | Location=${JSON.stringify(p.Location ?? p.location)} | Lat=${JSON.stringify(p.Latitude ?? p.latitude)} | Lon=${JSON.stringify(p.Longitude ?? p.longitude)} | clock=${JSON.stringify(p.clock)} | ignition=${JSON.stringify(p.ignition)} | speed=${JSON.stringify(p.speed)}`);
  }

  // ── Step 5: Extract trips from the available data ──
  const allRawTrips: ReconstructedTrip[] = [];
  let detectedTripsFromDetailedEvents: DetectedTrip[] | null = null;

  // CRITICAL: Only use TO-centered matching if we have actual fleet trip history rows
  // with Time, Status, Events, Location fields.
  // /vehicles/{plate}/events data has ignition/speed/clock but NOT Time/Status/Events/Location
  // and MUST NOT be used for TO matching.
  if (isFleetHistoryRow) {
    log(`✅ Data IS fleet trip history rows with required fields! Using TO-centered Driving event matching...`);
    detectedTripsFromDetailedEvents = reconstructTripsForTravelOrders(historyPoints, travelOrderCandidates, dateStr, log);
    log(`Reconstructed ${detectedTripsFromDetailedEvents.length} TO-centered trip(s) from fleet trip history rows`);
    for (let t = 0; t < detectedTripsFromDetailedEvents.length; t++) {
      const trip = detectedTripsFromDetailedEvents[t];
      log(`  Trip #${t + 1}: type=${trip.tripType} | dep=${trip.departureTime} | arr=${trip.arrivalTime} | origin=${trip.originName} | dest=${trip.destinationName} | startCoord=${trip.gpsStartCoord} | endCoord=${trip.gpsEndCoord}`);
    }

  } else if (isTripSummaries) {
    log(`Processing ${historyPoints.length} fleet trip record(s) — each is one ignition cycle`);
    log(`Attempting to fetch detailed history for each trip record...`);

    for (let t = 0; t < historyPoints.length; t++) {
      const tripRecord = historyPoints[t];
      log(`  Fleet trip record #${t + 1}:`);

      const startTs = String(tripRecord.start_timestamp || tripRecord.start_time || tripRecord.startTime || tripRecord.event_time || tripRecord.event_ts || tripRecord.timestamp || '');
      const endTs = String(tripRecord.end_timestamp || tripRecord.end_time || tripRecord.endTime || '');
      const originLoc = String(tripRecord.start_location || tripRecord.startLocation || tripRecord.origin || tripRecord.location || '');
      const destLoc = String(tripRecord.end_location || tripRecord.endLocation || tripRecord.destination || tripRecord.location || '');

      log(`    start=${startTs} | end=${endTs} | origin=${originLoc} | dest=${destLoc}`);

      // ── TASK 1: Log coordinates from trip summary ──
      {
        const sc = tripRecord.start_coordinates as unknown;
        const ec = tripRecord.end_coordinates as unknown;
        log(`    [GPS Sync] trip_id=${tripRecord.trip_id ?? tripRecord.id ?? tripRecord.tripId ?? 'unknown'}`);
        log(`    [GPS Sync] start_coordinates=${JSON.stringify(sc)}`);
        log(`    [GPS Sync] end_coordinates=${JSON.stringify(ec)}`);
        log(`    [GPS Sync] typeof start_coordinates=${typeof sc}`);
        log(`    [GPS Sync] typeof end_coordinates=${typeof ec}`);
      }

      const detailedPoints = await fetchDetailedPointsForTrip(unitInfo.unitId, plateNumber, tripRecord);
      log(`    Fetched ${detailedPoints.length} detailed history points for this trip`);

      if (detailedPoints.length > 0) {
        // Check if the detailed points have the `Time` field (fleet trip history rows)
        const hasTimeField = detailedPoints.some(p => (p.Time ?? p.time) !== undefined && (p.Time ?? p.time) !== null && (p.Time ?? p.time) !== '');
        const isFleetHistoryRowCheck = looksLikeFleetTripHistoryRow(detailedPoints[0]);

        log(`    Detailed data classification: hasTimeField=${hasTimeField}, isFleetHistoryRow=${isFleetHistoryRowCheck}`);

        if (isFleetHistoryRowCheck || hasTimeField) {
          // These are fleet trip history rows with `Time` field — use TO-centered matching directly
          log(`    ✅ Fleet trip history rows WITH Time field detected! Using TO-centered Driving event matching...`);
          const toTrips = reconstructTripsForTravelOrders(detailedPoints, travelOrderCandidates, dateStr, log);
          log(`    Reconstructed ${toTrips.length} TO-centered trip(s) from fleet trip history rows`);
          for (let d = 0; d < toTrips.length; d++) {
            const dt = toTrips[d];
            log(`      TO Trip #${d + 1}: type=${dt.tripType} | dep=${dt.departureTime} | arr=${dt.arrivalTime} | origin=${dt.originName} | dest=${dt.destinationName} | startCoord=${dt.gpsStartCoord} | endCoord=${dt.gpsEndCoord}`);
          }
          // Accumulate into detectedTripsFromDetailedEvents (merge with other TO-based results)
          if (!detectedTripsFromDetailedEvents) detectedTripsFromDetailedEvents = [];
          detectedTripsFromDetailedEvents.push(...toTrips);
        } else {
          // Legacy breadcrumb data — use traditional trip reconstruction
          const tripsInDetail = reconstructTripsFromBreadcrumbs(detailedPoints);
          log(`    Reconstructed ${tripsInDetail.length} trip(s) from detailed history (breadcrumb-based)`);
          for (let d = 0; d < tripsInDetail.length; d++) {
            const dt = tripsInDetail[d];
            log(`      Detail trip: dep=${dt.departureTime} | arr=${dt.arrivalTime} | origin=${dt.originName} | dest=${dt.destinationName} | startCoord=${dt.gpsStartCoord} | endCoord=${dt.gpsEndCoord}`);
          }
          allRawTrips.push(...tripsInDetail);
        }
      } else {
        // ═══════════════════════════════════════════════════════
        // TASK 3: Use trip summary coordinates when detailed history unavailable
        // ═══════════════════════════════════════════════════════
        log(`    No detailed history — using trip summary fields directly`);

        // Normalize coordinates from the trip summary
        const startCoordsNormalized = normalizeCoordinates(tripRecord.start_coordinates as unknown);
        const endCoordsNormalized = normalizeCoordinates(tripRecord.end_coordinates as unknown);

        log(`    start_coordinates (normalized): ${JSON.stringify(startCoordsNormalized)}`);
        log(`    end_coordinates (normalized): ${JSON.stringify(endCoordsNormalized)}`);

        // ── FIX: Handle Cartrack trip_distance unit conversion ──
        // Cartrack trip_distance appears to be in meters, not kilometers.
        // If rawDistance > 1000, treat it as meters and convert to km.
        const rawDistance = Number(tripRecord.trip_distance || tripRecord.tripDistance || tripRecord.distance_km || 0);
        let distanceKm = 0;
        let interpretedUnit = 'unknown';
        if (rawDistance > 0) {
          if (rawDistance > 1000) {
            distanceKm = rawDistance / 1000;
            interpretedUnit = 'meters';
          } else {
            distanceKm = rawDistance;
            interpretedUnit = 'kilometers';
          }
        }
        log(`    [Distance Fix] trip_id=${tripRecord.trip_id ?? tripRecord.id ?? tripRecord.tripId ?? 'unknown'}`);
        log(`    [Distance Fix] raw trip_distance=${rawDistance}`);
        log(`    [Distance Fix] interpretedUnit=${interpretedUnit}`);
        log(`    [Distance Fix] convertedKm=${distanceKm}`);
        log(`    [Distance Fix] finalDistanceUsed=${distanceKm}`);

        const parsedStart = parseCartrackTripTimestamp(tripRecord.start_timestamp || tripRecord.start_time || tripRecord.startTime);
        const parsedEnd = parseCartrackTripTimestamp(tripRecord.end_timestamp || tripRecord.end_time || tripRecord.endTime);

        console.log(
          '[Trip Parse]',
          tripRecord.trip_id ?? tripRecord.id ?? tripRecord.tripId ?? 'unknown',
          tripRecord.start_timestamp ?? tripRecord.start_time ?? tripRecord.startTime,
          '=>',
          parsedStart?.toISOString() ?? null,
        );
        console.log(
          '[Trip Parse]',
          tripRecord.trip_id ?? tripRecord.id ?? tripRecord.tripId ?? 'unknown',
          tripRecord.end_timestamp ?? tripRecord.end_time ?? tripRecord.endTime,
          '=>',
          parsedEnd?.toISOString() ?? null,
        );

        allRawTrips.push({
          departureTime: parsedStart ? msToManilaTimeString(parsedStart.getTime()) : (startTs || null),
          arrivalTime: parsedEnd ? msToManilaTimeString(parsedEnd.getTime()) : (endTs || null),
          rawStartTimestamp: startTs || null,
          rawEndTimestamp: endTs || null,
          gpsStartCoord: coordToDbString(startCoordsNormalized),
          gpsEndCoord: coordToDbString(endCoordsNormalized),
          originName: originLoc,
          destinationName: destLoc,
          maxSpeedKph: Number(tripRecord.speed || tripRecord.speed_kph || tripRecord.max_speed || tripRecord.maxSpeed || 0),
          engineHours: Number(tripRecord.engine_hours || tripRecord.engineHours || 0),
          distanceKm,
        });
      }
    }
  } else {
    log(`Unknown data shape — keys: ${JSON.stringify(Object.keys(firstPoint))}`);
    return { tripsCreated: 0, tripsFailed: 0, matchedToNumber: null, debugLogs };
  }

  log(`Total reconstructed trips: ${detectedTripsFromDetailedEvents?.length ?? allRawTrips.length}`);

  if ((detectedTripsFromDetailedEvents?.length ?? allRawTrips.length) === 0) {
    log(`No trips could be reconstructed from GPS data`);
    return { tripsCreated: 0, tripsFailed: 0, matchedToNumber: null, debugLogs };
  }

  // ── Step 6: Match TO against ALL raw trips first (BEFORE any filtering) ──
  // CRITICAL: TO matching must happen on the complete set of trips, not on
  // a coordinate-filtered subset. Otherwise valid trips get removed before
  // the containment check runs.
  let tripToProcess: DetectedTrip | null = null;
  let matchedToNumberForLog: string | null = null;

  if (detectedTripsFromDetailedEvents) {
    // TO-centered detection already happened inside reconstructTripsForTravelOrders
    // These trips already have .travelOrder set — use them directly
    tripToProcess = detectedTripsFromDetailedEvents[0] ?? null;
    matchedToNumberForLog = tripToProcess?.travelOrder?.to_number ?? null;
    log(`TO-centered detection produced ${detectedTripsFromDetailedEvents.length} trip(s)`);
  } else {
    // Trip summaries path: we have allRawTrips with ALL reconstructed trips
    // Match TO against ALL raw trips using containment
    log(`\n═══════════════════════════════════════════════════════════`);
    log(`Matching TO against ALL ${allRawTrips.length} reconstructed trip(s)`);
    log(`═══════════════════════════════════════════════════════════`);

    for (const to of travelOrderCandidates) {
      log(`\nEvaluating TO #${to.to_number ?? to.id}:`);
      log(`  TO departure: ${to.scheduled_departure}`);
      log(`  TO arrival:   ${to.scheduled_arrival}`);

      for (let i = 0; i < allRawTrips.length; i++) {
        const rawTrip = allRawTrips[i];
        log(`\n  Trip #${i + 1}: ${rawTrip.departureTime} → ${rawTrip.arrivalTime}`);

        // Use matchTravelOrderToGpsTrip with containment check
        const matchedTO = matchTravelOrderToGpsTrip(
          rawTrip.departureTime, rawTrip.arrivalTime, null, [to], log,
        );

        if (matchedTO) {
          log(`  ✅ Trip #${i + 1} ACCEPTED for TO #${matchedTO.to_number ?? matchedTO.id}`);
          tripToProcess = {
            ...rawTrip,
            tripType: 'OUTBOUND' as const,
            parentTrip: null,
            travelOrder: matchedTO,
          };
          matchedToNumberForLog = matchedTO.to_number ?? null;
          break;
        }
      }

      if (tripToProcess) break;
    }

    if (!tripToProcess) {
      log(`\n❌ No trip found that contains TO departure/arrival — no GPS logs created`);
      return { tripsCreated: 0, tripsFailed: 0, matchedToNumber: null, debugLogs };
    }
  }

  log(`\nSelected trip:`);
  log(`  dep=${tripToProcess.departureTime} | arr=${tripToProcess.arrivalTime} | origin=${tripToProcess.originName} | dest=${tripToProcess.destinationName}`);

  // ═══════════════════════════════════════════════════════════════
  // STRICT VALIDATION: validateMatchedTrip()
  // ═══════════════════════════════════════════════════════════════
  const parsedToDepMs = parseTimestampSafe(tripToProcess.travelOrder?.scheduled_departure ?? null);
  const parsedToArrMs = parseTimestampSafe(tripToProcess.travelOrder?.scheduled_arrival ?? null);
  const parsedTripDepMs = parseTimestampSafe(tripToProcess.departureTime);
  const parsedTripArrMs = parseTimestampSafe(tripToProcess.arrivalTime);

  const containsDeparture = parsedToDepMs !== null && parsedTripDepMs !== null && parsedTripArrMs !== null
    && parsedTripDepMs <= parsedToDepMs && parsedTripArrMs >= parsedToDepMs;
  const containsArrival = parsedToArrMs !== null && parsedTripDepMs !== null && parsedTripArrMs !== null
    && parsedTripDepMs <= parsedToArrMs && parsedTripArrMs >= parsedToArrMs;

  const departureDiffMinutes = parsedToDepMs !== null && parsedTripDepMs !== null
    ? Math.round((parsedTripDepMs - parsedToDepMs) / 60000)
    : null;
  const arrivalDiffMinutes = parsedToArrMs !== null && parsedTripArrMs !== null
    ? Math.round((parsedTripArrMs - parsedToArrMs) / 60000)
    : null;

  const absDepartureDiff = departureDiffMinutes !== null ? Math.abs(departureDiffMinutes) : Infinity;
  const absArrivalDiff = arrivalDiffMinutes !== null ? Math.abs(arrivalDiffMinutes) : Infinity;

  // Determine if outbound movement was found from detailed fleet history
  const validOutboundHistory = detectedTripsFromDetailedEvents !== null && detectedTripsFromDetailedEvents.length > 0;

  // Determine destination verification status
  const destCoordForValidation = tripToProcess.gpsEndCoord;
  const toDestCoord = tripToProcess.travelOrder?.lat_long_destination;
  let destinationVerified = false;
  if (destCoordForValidation && toDestCoord) {
    destinationVerified = haversineDistance(destCoordForValidation, toDestCoord) <= DISTANCE_THRESHOLD_M;
  }

  // Log validation summary
  log(`\n  ─── STRICT TO TRIP VALIDATION ───`);
  log(`  containsDeparture: ${containsDeparture}`);
  log(`  containsArrival: ${containsArrival}`);
  if (departureDiffMinutes !== null) {
    log(`  departureDiff: ${departureDiffMinutes} min (abs=${absDepartureDiff} min, threshold=${MAX_DEPARTURE_DIFFERENCE_MINUTES} min)`);
  }
  if (arrivalDiffMinutes !== null) {
    log(`  arrivalDiff: ${arrivalDiffMinutes} min (abs=${absArrivalDiff} min, threshold=${MAX_ARRIVAL_DIFFERENCE_MINUTES} min)`);
  }
  log(`  destinationVerified: ${destinationVerified}`);
  log(`  validOutboundHistory: ${validOutboundHistory}`);

  // ── Outbound validation (must satisfy at least one) ──
  const outboundValid = containsDeparture || validOutboundHistory || destinationVerified;

  if (!outboundValid) {
    log(`  ❌ REJECT — Outbound validation failed`);
    log(`     No departure match, no detailed history, and destination not verified.`);
    log(`  trip_id=${tripToProcess.travelOrder?.id ?? 'unknown'}`);
    log(`  trip start=${tripToProcess.departureTime}`);
    log(`  trip end=${tripToProcess.arrivalTime}`);
    log(`  containsDeparture=${containsDeparture}`);
    log(`  containsArrival=${containsArrival}`);
    log(`  departureDiff=${departureDiffMinutes} min`);
    log(`  arrivalDiff=${arrivalDiffMinutes} min`);
    log(`  destinationVerified=${destinationVerified}`);
    log(`  reason=Outbound validation failed`);
    log(`\n❌ No matching fleet trip was found for this Travel Order. Sync cancelled.`);
    return { tripsCreated: 0, tripsFailed: 0, matchedToNumber: null, debugLogs };
  }

  // ── False positive: Reject arrival-only matches ──
  if (!containsDeparture && containsArrival) {
    log(`  ❌ REJECT — Arrival-only match is not sufficient`);
    log(`  trip_id=${tripToProcess.travelOrder?.id ?? 'unknown'}`);
    log(`  trip start=${tripToProcess.departureTime}`);
    log(`  trip end=${tripToProcess.arrivalTime}`);
    log(`  containsDeparture=${containsDeparture}`);
    log(`  containsArrival=${containsArrival}`);
    log(`  reason=Arrival-only match is not sufficient`);
    log(`\n❌ No matching fleet trip was found for this Travel Order. Sync cancelled.`);
    return { tripsCreated: 0, tripsFailed: 0, matchedToNumber: null, debugLogs };
  }

  // ── False positive: Reject no-match ──
  if (!containsDeparture && !containsArrival) {
    log(`  ❌ REJECT — Trip does not contain TO departure or return time`);
    log(`  trip_id=${tripToProcess.travelOrder?.id ?? 'unknown'}`);
    log(`  trip start=${tripToProcess.departureTime}`);
    log(`  trip end=${tripToProcess.arrivalTime}`);
    log(`  containsDeparture=${containsDeparture}`);
    log(`  containsArrival=${containsArrival}`);
    log(`  reason=Trip does not contain TO departure or return time`);
    log(`\n❌ No matching fleet trip was found for this Travel Order. Sync cancelled.`);
    return { tripsCreated: 0, tripsFailed: 0, matchedToNumber: null, debugLogs };
  }

  // ── Apply departure/arrival diff thresholds ONLY when detailed fleet history is available ──
  if (validOutboundHistory) {
    if (absDepartureDiff > MAX_DEPARTURE_DIFFERENCE_MINUTES) {
      log(`  ❌ REJECT — departure difference exceeds threshold (${absDepartureDiff} min > ${MAX_DEPARTURE_DIFFERENCE_MINUTES} min)`);
      log(`  trip_id=${tripToProcess.travelOrder?.id ?? 'unknown'}`);
      log(`  trip start=${tripToProcess.departureTime}`);
      log(`  trip end=${tripToProcess.arrivalTime}`);
      log(`  containsDeparture=${containsDeparture}`);
      log(`  containsArrival=${containsArrival}`);
      log(`  departureDiff=${departureDiffMinutes} min`);
      log(`  arrivalDiff=${arrivalDiffMinutes} min`);
      log(`  destinationVerified=${destinationVerified}`);
      log(`  reason=Departure difference ${absDepartureDiff} min exceeds max ${MAX_DEPARTURE_DIFFERENCE_MINUTES} min`);
      log(`\n❌ No valid trip found for Travel Order ${tripToProcess.travelOrder?.to_number ?? tripToProcess.travelOrder?.id ?? 'unknown'}. Sync cancelled.`);
      return { tripsCreated: 0, tripsFailed: 0, matchedToNumber: null, debugLogs };
    }

    if (absArrivalDiff > MAX_ARRIVAL_DIFFERENCE_MINUTES) {
      log(`  ❌ REJECT — arrival difference exceeds threshold (${absArrivalDiff} min > ${MAX_ARRIVAL_DIFFERENCE_MINUTES} min)`);
      log(`  trip_id=${tripToProcess.travelOrder?.id ?? 'unknown'}`);
      log(`  trip start=${tripToProcess.departureTime}`);
      log(`  trip end=${tripToProcess.arrivalTime}`);
      log(`  containsDeparture=${containsDeparture}`);
      log(`  containsArrival=${containsArrival}`);
      log(`  departureDiff=${departureDiffMinutes} min`);
      log(`  arrivalDiff=${arrivalDiffMinutes} min`);
      log(`  destinationVerified=${destinationVerified}`);
      log(`  reason=Arrival difference ${absArrivalDiff} min exceeds max ${MAX_ARRIVAL_DIFFERENCE_MINUTES} min`);
      log(`\n❌ No valid trip found for Travel Order ${tripToProcess.travelOrder?.to_number ?? tripToProcess.travelOrder?.id ?? 'unknown'}. Sync cancelled.`);
      return { tripsCreated: 0, tripsFailed: 0, matchedToNumber: null, debugLogs };
    }
  }

  log(`  ✅ OUTBOUND validation passed`);

  // ── Step 7: Detect return trip ──
  // ═══════════════════════════════════════════════════════════════
  // TASK 5: Always create RETURN if TO has both scheduled_departure and scheduled_arrival
  // Do NOT suppress RETURN creation because return time falls within same ignition cycle
  // ═══════════════════════════════════════════════════════════════
  let detectedTrips: DetectedTrip[] = [tripToProcess];

  if (travelOrderCandidates.length > 0 && tripToProcess.travelOrder) {
    const to = tripToProcess.travelOrder;
    const hasReturnTime = !!(to.scheduled_departure && to.scheduled_arrival);

    if (hasReturnTime) {
      log(`\n─── RETURN TRIP DETECTION ───`);
      log(`TO has both departure AND arrival — will create OUTBOUND + RETURN records`);

      // Try to find a separate trip that contains the TO return time
      let returnTripFound = false;
      for (let i = 0; i < allRawTrips.length; i++) {
        const rawTrip = allRawTrips[i];
        if (!rawTrip.departureTime || !rawTrip.arrivalTime) continue;
        const parsedStart = parseTimestampSafe(rawTrip.departureTime, 'rawTrip.departureTime');
        const parsedEnd = parseTimestampSafe(rawTrip.arrivalTime, 'rawTrip.arrivalTime');
        const rawDepMs = parsedStart;
        const rawArrMs = parsedEnd;
        const toReturnMs = parseTimestampSafe(to.scheduled_arrival, 'TO scheduled_arrival (return)');
        if (toReturnMs === null || rawDepMs === null || rawArrMs === null) continue;

        console.log('Trip raw start', rawTrip.departureTime, typeof rawTrip.departureTime);
        console.log('Trip raw end', rawTrip.arrivalTime, typeof rawTrip.arrivalTime);
        console.log('Trip parsed start', parsedStart ? new Date(parsedStart).toISOString() : null);
        console.log('Trip parsed end', parsedEnd ? new Date(parsedEnd).toISOString() : null);

        // Check if this trip contains the TO return time
        if (rawDepMs <= toReturnMs && rawArrMs >= toReturnMs) {
          log(`\n  ✅ RETURN trip found: Trip #${i + 1} (${rawTrip.departureTime} → ${rawTrip.arrivalTime}) contains TO return ${to.scheduled_arrival}`);
          detectedTrips.push({
            ...rawTrip,
            tripType: 'RETURN' as const,
            parentTrip: tripToProcess,
            travelOrder: to,
          });
          returnTripFound = true;
          break;
        }
      }

      if (!returnTripFound) {
        log(`\n  ⚠️ No separate trip found containing TO return time. Creating RETURN record using selected trip with swapped origin/destination.`);
        // Still create RETURN record even if same trip — use the same trip data but with swapped fields
        const returnTrip: DetectedTrip = {
          ...tripToProcess,
          tripType: 'RETURN',
          parentTrip: tripToProcess,
          travelOrder: to,
        };
        detectedTrips.push(returnTrip);
      }
    } else {
      log(`\n  ⏭️ TO has no scheduled_arrival — skipping return trip`);
    }
  }

  log(`\nAfter TO-based selection and return detection: ${detectedTrips.length} trip(s) total`);
  for (let i = 0; i < detectedTrips.length; i++) {
    const t = detectedTrips[i];
    log(`  Trip #${i + 1}: type=${t.tripType} | dep=${t.departureTime} | arr=${t.arrivalTime} | origin=${t.originName} | dest=${t.destinationName}`);
  }

  // ── Step 8: Process each detected trip (save to database) ──
  let tripsCreated = 0;
  let tripsFailed = 0;
  let matchedToNumber: string | null = null;

  for (const trip of detectedTrips) {
    const tripType = trip.tripType ?? 'OUTBOUND';

    // ── STRICT REJECTION RULES ──────────────────────────────────────
    // Rule 1: Must have valid departure and arrival times
    if (!trip.departureTime || !trip.arrivalTime || trip.departureTime === trip.arrivalTime) {
      log(`  → ❌ Trip departure and arrival times are missing or identical — skipping`);
      tripsFailed += 1;
      continue;
    }

    // Rule 2: departure and arrival must be different (no zero-duration trips)
    const depMs = new Date(trip.departureTime).getTime();
    const arrMs = new Date(trip.arrivalTime).getTime();
    // Note: For TO-based trips, these times may be the ignition cycle start/end.
    // The actual GPS log times will come from TO fields below.
    if (arrMs <= depMs) {
      log(`  → ❌ Trip arrival time is not after departure time — skipping`);
      tripsFailed += 1;
      continue;
    }

    // ═══════════════════════════════════════════════════════════════
    // TASK 1: Log coordinate details before validation
    // ═══════════════════════════════════════════════════════════════
    log(`\n  [GPS Sync] Pre-validation coordinate check:`);
    log(`  [GPS Sync] trip_id=<trip>`);
    log(`  [GPS Sync] start_coordinates=${trip.gpsStartCoord}`);
    log(`  [GPS Sync] end_coordinates=${trip.gpsEndCoord}`);
    log(`  [GPS Sync] typeof start_coordinates=${typeof trip.gpsStartCoord}`);
    log(`  [GPS Sync] typeof end_coordinates=${typeof trip.gpsEndCoord}`);

    // Rule 3: Must have valid coordinates for distance calculation
    if (!trip.gpsStartCoord || !trip.gpsEndCoord) {
      log(`  → ❌ Trip has missing start or end coordinates — skipping`);
      tripsFailed += 1;
      continue;
    }

    // ═══════════════════════════════════════════════════════════════
    // Distance calculation: Use Cartrack's trip.trip_distance FIRST
    // Only fall back to haversine/estimate if trip_distance is missing
    // ═══════════════════════════════════════════════════════════════
    const drivingDurationHours = (arrMs - depMs) / (1000 * 60 * 60);
    const estimatedDistanceKm = drivingDurationHours * 40;
    const cartrackDistanceKm = trip.distanceKm ?? 0;

    // Log detailed distance debug info
    {
      const originParts = trip.gpsStartCoord?.split(',');
      const destParts = trip.gpsEndCoord?.split(',');
      const originLat = originParts ? Number(originParts[0]) : NaN;
      const originLon = originParts ? Number(originParts[1]) : NaN;
      const destLat = destParts ? Number(destParts[0]) : NaN;
      const destLon = destParts ? Number(destParts[1]) : NaN;

      log(`  [Distance Debug] origin: ${originLat},${originLon}`);
      log(`  [Distance Debug] destination: ${destLat},${destLon}`);
      log(`  [Distance Debug] lat diff: ${destLat - originLat}`);
      log(`  [Distance Debug] lon diff: ${destLon - originLon}`);

      // Calculate haversine distance in km for comparison
      if (Number.isFinite(originLat) && Number.isFinite(originLon) && Number.isFinite(destLat) && Number.isFinite(destLon)) {
        const toRad = (deg: number) => (deg * Math.PI) / 180;
        const dLat = toRad(destLat - originLat);
        const dLon = toRad(destLon - originLon);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(originLat)) * Math.cos(toRad(destLat)) * Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const haversineDistanceMeters = 6371e3 * c;
        const haversineDistanceKm = haversineDistanceMeters / 1000;
        log(`  [Distance Debug] haversine distance (km): ${haversineDistanceKm.toFixed(6)}`);
        log(`  [Distance Debug] haversine distance (m): ${haversineDistanceMeters.toFixed(1)}`);
      }
    }

    // Priority: Cartrack trip.trip_distance > estimated (duration * 40 km/h) > 0
    const effectiveDistanceKm = cartrackDistanceKm > 0 ? cartrackDistanceKm : estimatedDistanceKm;

    log(`  [Distance] trip.trip_distance (Cartrack): ${cartrackDistanceKm}`);
    log(`  [Distance] estimatedDistance (${drivingDurationHours.toFixed(2)}h × 40km/h): ${estimatedDistanceKm.toFixed(2)}`);
    log(`  [Distance] finalDistanceUsed: ${effectiveDistanceKm.toFixed(2)} km`);

    // Distance checks — reject absurd/zero/null distances
    // Allow trip_distance from Cartrack even if it's small (< 0.1 km),
    // but reject if BOTH trip_distance and estimated distance are <= 0
    if (cartrackDistanceKm <= 0 && estimatedDistanceKm <= 0) {
      log(`  → ❌ Trip distance is zero or missing from both Cartrack and estimate — skipping GPS log creation`);
      tripsFailed += 1;
      continue;
    }

    if (effectiveDistanceKm > 500) {
      log(`  → ❌ Trip distance ${effectiveDistanceKm.toFixed(1)}km is absurd (>500km) — skipping`);
      tripsFailed += 1;
      continue;
    }

    // Rule 5: Must match a Travel Order
    log(`Matching travel order for GPS trip: dep=${trip.departureTime} arr=${trip.arrivalTime} destCoord=${trip.gpsEndCoord}`);
    const matchedTO = trip.travelOrder ?? matchTravelOrderToGpsTrip(
      trip.departureTime, trip.arrivalTime, trip.gpsEndCoord, travelOrderCandidates, log,
    );

    if (!matchedTO) {
      log(`  → ❌ No matching TO found within tolerance — skipping GPS log creation`);
      tripsFailed += 1;
      continue;
    }

    matchedToNumber = matchedTO.to_number ?? matchedToNumber;
    log(`  → Matched TO #${matchedTO.to_number} (id=${matchedTO.id})`);

    const driverId = matchedTO.driver_id ?? resolvedDriverId;
    const travelOrderId = matchedTO.id;
    const toStatusAuto = matchedTO.status ?? primaryTO.status;

    // ── Safeguard: skip if start and end locations are identical with no movement ──
    if (trip.originName === trip.destinationName && trip.gpsStartCoord === trip.gpsEndCoord && drivingDurationHours < 0.02) {
      log(`  → ❌ Trip origin and destination are identical with no meaningful movement — skipping`);
      tripsFailed += 1;
      continue;
    }

    // ═══════════════════════════════════════════════════════════════
    // TASK 4: Use TO fields for origin/destination names and coordinates
    // For OUTBOUND: origin_location, lat_long_origin
    // For RETURN: destination_target (as origin), lat_long_destination (as origin coord)
    // ═══════════════════════════════════════════════════════════════
    let originNameForSave: string;
    let destNameForSave: string;
    let originCoordForSave: string | null;
    let destCoordForSave: string | null;

    if (tripType === 'OUTBOUND') {
      // OUTBOUND: origin = TO origin_location, destination = TO destination_target
      originNameForSave = matchedTO.origin_location || trip.originName;
      destNameForSave = matchedTO.destination_target || trip.destinationName;
      originCoordForSave = matchedTO.lat_long_origin || (trip.gpsStartCoord ?? null);
      destCoordForSave = matchedTO.lat_long_destination || (trip.gpsEndCoord ?? null);
    } else {
      // RETURN: origin = TO destination_target (going back), destination = TO origin_location
      originNameForSave = matchedTO.destination_target || (trip.parentTrip?.destinationName ?? trip.destinationName);
      destNameForSave = matchedTO.origin_location || (trip.parentTrip?.originName ?? trip.originName);
      originCoordForSave = matchedTO.lat_long_destination || (trip.parentTrip?.gpsEndCoord ?? trip.gpsStartCoord ?? null);
      destCoordForSave = matchedTO.lat_long_origin || (trip.parentTrip?.gpsStartCoord ?? trip.gpsEndCoord ?? null);
    }

    log(`  Field mapping: origin="${originNameForSave}" (coord=${originCoordForSave}) → destination="${destNameForSave}" (coord=${destCoordForSave})`);

    // ═══════════════════════════════════════════════════════════════
    // FIX 3: TO destination coordinate validation
    // Use configurable threshold, set anomaly_flag if not verified
    // ═══════════════════════════════════════════════════════════════
    const destThresholdMeters = Number.isFinite(GPS_TO_DESTINATION_THRESHOLD_METERS) && GPS_TO_DESTINATION_THRESHOLD_METERS > 0
      ? GPS_TO_DESTINATION_THRESHOLD_METERS
      : 300;
    let destVerified = false;
    let destinationAnomaly = false;
    let destinationNote: string | null = null;

    if (tripType === 'OUTBOUND' && destCoordForSave && matchedTO.lat_long_destination) {
      const dist = haversineDistance(destCoordForSave, matchedTO.lat_long_destination);
      log(`  → Destination validation: GPS dest ${destCoordForSave} vs TO dest ${matchedTO.lat_long_destination} = ${dist.toFixed(1)}m (threshold ${destThresholdMeters}m)`);
      destVerified = dist <= destThresholdMeters;
      log(`  → Destination verified: ${destVerified}`);
      if (!destVerified) {
        destinationAnomaly = true;
        destinationNote = 'Trip matched by TO time window, but trip end coordinate is not near TO destination.';
        log(`  → ⚠️ ${destinationNote}`);
      }
    } else if (tripType === 'OUTBOUND' && !matchedTO.lat_long_destination) {
      log(`  → TO has no lat_long_destination — cannot validate destination coordinates`);
    } else if (tripType === 'OUTBOUND' && !destCoordForSave) {
      log(`  → No GPS destination coordinate available for verification`);
    }

    // Log destination validation details
    log(`  [Destination Validation] trip_id=<trip>`);
    log(`  [Destination Validation] trip end_coordinates=${trip.gpsEndCoord}`);
    log(`  [Destination Validation] TO destination coordinate=${matchedTO.lat_long_destination}`);
    if (destCoordForSave && matchedTO.lat_long_destination) {
      const dist = haversineDistance(destCoordForSave, matchedTO.lat_long_destination);
      log(`  [Destination Validation] distance to TO destination=${dist.toFixed(1)}m`);
    }
    log(`  [Destination Validation] threshold=${destThresholdMeters}m`);
    log(`  [Destination Validation] destination_verified=${destVerified}`);

    // ═══════════════════════════════════════════════════════════════
    // FIX 6: Time assignment — use actual fleet detected times, NOT TO scheduled times
    //
    // Priority:
    // 1. Detailed fleet history (reconstructTripsForTravelOrders):
    //    - OUTBOUND: first Driving row near TO departure → first Idling/Off after driving
    //    - RETURN:   first Driving row near TO return   → first Idling/Off after driving
    // 2. Trip summary fallback (if ALLOW_TRIP_SUMMARY_TIME_FALLBACK=true):
    //    - Use trip summary start/end timestamps
    //    - Mark anomaly_flag=true with fallback note
    // 3. Fallback disabled (ALLOW_TRIP_SUMMARY_TIME_FALLBACK=false):
    //    - Leave departure_time_gps/arrival_time_gps null
    //    - Mark anomaly_flag=true with unavailable note
    //
    // NEVER assign TO scheduled_departure/scheduled_arrival to GPS actual time fields.
    // ═══════════════════════════════════════════════════════════════
    const hasDetailedEvents = detectedTripsFromDetailedEvents !== null && detectedTripsFromDetailedEvents.length > 0;

    let departureTimeGpsForSave: string | null;
    let arrivalTimeGpsForSave: string | null;
    let timeSource: string;

    if (hasDetailedEvents) {
      // Priority 1: Detailed fleet history provides actual GPS driving/idling event times
      departureTimeGpsForSave = trip.departureTime;
      arrivalTimeGpsForSave = trip.arrivalTime;
      timeSource = 'detailed_fleet_history';
      log(`  → Time assignment (${tripType}): dep=${departureTimeGpsForSave} | arr=${arrivalTimeGpsForSave} | source=${timeSource}`);
    } else if (trip.rawStartTimestamp || trip.rawEndTimestamp) {
      // Priority 2: Trip summary fallback — use Cartrack start_timestamp/end_timestamp as Manila local time strings
      departureTimeGpsForSave = trip.rawStartTimestamp ?? trip.departureTime;
      arrivalTimeGpsForSave = trip.rawEndTimestamp ?? trip.arrivalTime;
      timeSource = 'trip_summary_fallback';
      log(`  → Time assignment (${tripType}): dep=${departureTimeGpsForSave} | arr=${arrivalTimeGpsForSave} | source=${timeSource}`);
    } else {
      // Priority 3: Neither detailed events nor trip summary timestamps available
      departureTimeGpsForSave = null;
      arrivalTimeGpsForSave = null;
      timeSource = 'unavailable';
      log(`  → Time assignment (${tripType}): dep=null | arr=null | source=${timeSource}`);
    }

    // ═══════════════════════════════════════════════════════════════
    // FIX 7: Duplicate prevention — check travel_order_id + vehicle_id + trip_date + trip_type
    // ═══════════════════════════════════════════════════════════════
    const dupCheck = await pool.query(
      `SELECT 1 FROM gps_trip_logs
        WHERE travel_order_id = $1
          AND vehicle_id = $2
          AND trip_date = $3
          AND trip_type = $4
        LIMIT 1`,
      [travelOrderId, vehicleId, dateStr, tripType],
    );
    if (dupCheck.rows.length > 0) {
      log(`  → ❌ Duplicate: ${tripType} GPS log already exists for TO #${matchedTO.to_number} on ${dateStr} — skipping`);
      tripsFailed += 1;
      continue;
    }

    // ═══════════════════════════════════════════════════════════════
    // FIX 8: Reject creation from current fleet status only
    // ═══════════════════════════════════════════════════════════════
    if (!travelOrderId) {
      log(`  → ❌ GPS logs should only be created with matched TO — skipping`);
      tripsFailed += 1;
      continue;
    }

    // Reject OUTBOUND with null departure or arrival times ONLY when fallback is enabled
    // When ALLOW_TRIP_SUMMARY_TIME_FALLBACK=false and detailed history is unavailable,
    // null GPS times are expected and should be saved with anomaly flag
    if (tripType === 'OUTBOUND' && departureTimeGpsForSave === null && arrivalTimeGpsForSave === null) {
      if (ALLOW_TRIP_SUMMARY_TIME_FALLBACK || hasDetailedEvents) {
        log(`  → ❌ OUTBOUND departure_time_gps and arrival_time_gps are both null (fallback allowed but not used) — skipping`);
        tripsFailed += 1;
        continue;
      }
      // Fallback disabled and no detailed history — null times are expected, will save with anomaly flag
      log(`  → ⚠️ OUTBOUND GPS times are null (fallback disabled, detailed history unavailable) — will save with anomaly flag`);
    } else {
      // Reject if only one is null (incomplete data)
      if (tripType === 'OUTBOUND' && (!departureTimeGpsForSave || !arrivalTimeGpsForSave)) {
        log(`  → ❌ OUTBOUND has incomplete GPS times (dep=${departureTimeGpsForSave}, arr=${arrivalTimeGpsForSave}) — skipping`);
        tripsFailed += 1;
        continue;
      }
    }

    // Reject if coordinates are missing after TO fallback
    if (!originCoordForSave || !destCoordForSave) {
      log(`  → ❌ Coordinates missing after TO fallback — skipping`);
      tripsFailed += 1;
      continue;
    }

    // ═══════════════════════════════════════════════════════════════
    // FINAL CREATION GATE
    //
    // Reject if:
    //   - containsDeparture is false
    //   - no valid outbound history from detailed fleet data
    //   - destination is not verified
    //
    // This prevents creating GPS logs when the trip was never actually traveled.
    // ═══════════════════════════════════════════════════════════════
    if (
      !containsDeparture &&
      !validOutboundHistory &&
      !destinationVerified
    ) {
      log(`  → ❌ CREATION REJECTED — containsDeparture=false, no valid outbound history, destination not verified`);
      log(`  trip_id=${tripToProcess.travelOrder?.id ?? 'unknown'}`);
      log(`  trip start=${tripToProcess.departureTime}`);
      log(`  trip end=${tripToProcess.arrivalTime}`);
      log(`  containsDeparture=${containsDeparture}`);
      log(`  containsArrival=${containsArrival}`);
      log(`  departureDiff=${departureDiffMinutes} min`);
      log(`  arrivalDiff=${arrivalDiffMinutes} min`);
      log(`  destinationVerified=${destinationVerified}`);
      log(`  reason=No valid fleet trip matches Travel Order ${tripToProcess.travelOrder?.to_number ?? tripToProcess.travelOrder?.id ?? 'unknown'}`);
      log(`\n❌ No matching fleet trip found for Travel Order ${tripToProcess.travelOrder?.to_number ?? tripToProcess.travelOrder?.id ?? 'unknown'}. Sync cancelled.`);
      tripsFailed += 1;
      continue;
    }

    // ═══════════════════════════════════════════════════════════════
    // FIX 10: Anomaly detection and reconciliation notes
    //
    // When detailed fleet history is NOT available:
    //   - Mark anomaly_flag=true
    //   - Set notes_remarks indicating actual GPS times could not be detected
    //
    // When detailed fleet history IS available but destination anomaly:
    //   - Mark anomaly_flag=true
    //   - Set notes_remarks with destination validation warning
    //
    // Reconciliation notes show TO scheduled vs actual GPS times with differences.
    // ═══════════════════════════════════════════════════════════════
    let anomalyFlag = false;
    const reconciliationNotes: string[] = [];

    // Always add TO scheduled times to notes if available
    if (matchedTO.scheduled_departure) {
      reconciliationNotes.push(`TO scheduled departure: ${matchedTO.scheduled_departure}`);
    }
    if (matchedTO.scheduled_arrival) {
      reconciliationNotes.push(`TO scheduled return: ${matchedTO.scheduled_arrival}`);
    }

    // Add actual GPS detected times
    if (departureTimeGpsForSave) {
      reconciliationNotes.push(`Actual GPS departure: ${departureTimeGpsForSave}`);
    }
    if (arrivalTimeGpsForSave) {
      reconciliationNotes.push(`Actual GPS arrival: ${arrivalTimeGpsForSave}`);
    }

    // Calculate and add time differences in minutes
    if (matchedTO.scheduled_departure && departureTimeGpsForSave) {
      const toDepMs = new Date(matchedTO.scheduled_departure).getTime();
      const actualDepMs = new Date(departureTimeGpsForSave).getTime();
      if (!Number.isNaN(toDepMs) && !Number.isNaN(actualDepMs)) {
        const diffMinutes = Math.round((actualDepMs - toDepMs) / 60000);
        const sign = diffMinutes >= 0 ? '+' : '';
        reconciliationNotes.push(`Departure diff from TO: ${sign}${diffMinutes} min`);
      }
    }
    if (matchedTO.scheduled_arrival && arrivalTimeGpsForSave) {
      const toArrMs = new Date(matchedTO.scheduled_arrival).getTime();
      const actualArrMs = new Date(arrivalTimeGpsForSave).getTime();
      if (!Number.isNaN(toArrMs) && !Number.isNaN(actualArrMs)) {
        const diffMinutes = Math.round((actualArrMs - toArrMs) / 60000);
        const sign = diffMinutes >= 0 ? '+' : '';
        reconciliationNotes.push(`Arrival diff from TO: ${sign}${diffMinutes} min`);
      }
    }

    // Fallback anomaly: when detailed fleet history is unavailable
    if (!hasDetailedEvents) {
      anomalyFlag = true;
      reconciliationNotes.push('Detailed fleet history unavailable from Cartrack API. Actual departure/arrival times estimated from trip summary.');
    }

    // Add destination anomaly note if applicable (detailed events case)
    if (destinationAnomaly && destinationNote) {
      anomalyFlag = true;
      reconciliationNotes.push(destinationNote);
    }

    const notesRemarks: string | null = reconciliationNotes.length > 0
      ? reconciliationNotes.join(' | ')
      : null;

    // ═══════════════════════════════════════════════════════════════
    // FIX 9: Pre-save reconciliation log (for auditing and debugging)
    // ═══════════════════════════════════════════════════════════════
    log(`\n  ─── RECONCILIATION LOG ───`);
    log(`  trip_type=${tripType}`);
    log(`  TO scheduled departure: ${matchedTO.scheduled_departure ?? 'null'}`);
    log(`  TO scheduled return: ${matchedTO.scheduled_arrival ?? 'null'}`);
    log(`  selected actual departure source: ${timeSource}`);
    log(`  selected actual arrival source: ${timeSource}`);
    log(`  departure_time_gps (actual fleet): ${departureTimeGpsForSave}`);
    log(`  arrival_time_gps (actual fleet): ${arrivalTimeGpsForSave}`);
    if (matchedTO.scheduled_departure && departureTimeGpsForSave) {
      const toDepMs = new Date(matchedTO.scheduled_departure).getTime();
      const actualDepMs = new Date(departureTimeGpsForSave).getTime();
      const diffMinutes = Number.isFinite(toDepMs) && Number.isFinite(actualDepMs)
        ? Math.round((actualDepMs - toDepMs) / 60000)
        : null;
      log(`  departure diff from TO (minutes): ${diffMinutes !== null ? diffMinutes : 'N/A'}`);
    } else {
      log(`  departure diff from TO (minutes): N/A`);
    }
    if (matchedTO.scheduled_arrival && arrivalTimeGpsForSave) {
      const toArrMs = new Date(matchedTO.scheduled_arrival).getTime();
      const actualArrMs = new Date(arrivalTimeGpsForSave).getTime();
      const diffMinutes = Number.isFinite(toArrMs) && Number.isFinite(actualArrMs)
        ? Math.round((actualArrMs - toArrMs) / 60000)
        : null;
      log(`  arrival diff from TO (minutes): ${diffMinutes !== null ? diffMinutes : 'N/A'}`);
    } else {
      log(`  arrival diff from TO (minutes): N/A`);
    }
    log(`  --- FINAL VALIDATION ---`);
    log(`  travel_order_id=${travelOrderId}`);
    log(`  vehicle_id=${vehicleId}`);
    log(`  driver_id=${driverId || 'null'}`);
    log(`  origin_gps_start_point="${originNameForSave}"`);
    log(`  destination_gps_end_point="${destNameForSave}"`);
    log(`  coordinates_origin=${originCoordForSave}`);
    log(`  coordinates_destination=${destCoordForSave}`);
    log(`  gps_distance_km=${effectiveDistanceKm.toFixed(2)}`);
    log(`  destination_verified=${destVerified}`);
    log(`  anomaly_flag=${anomalyFlag}`);
    log(`  notes_remarks="${notesRemarks || ''}"`);

    const gpsRecordNoResult = await pool.query<{ max_seq: string | null }>(
      `SELECT MAX(CAST(SPLIT_PART(gps_record_no, '-', 3) AS INTEGER)) AS max_seq
         FROM gps_trip_logs
        WHERE gps_record_no LIKE $1`,
      [`GPS-${new Date().getFullYear()}-%`],
    );
    const nextSeq = (parseInt(gpsRecordNoResult.rows[0]?.max_seq || '0', 10)) + 1;
    const gpsRecordNo = `GPS-${new Date().getFullYear()}-${String(nextSeq).padStart(4, '0')}`;

    const insertData: GpsLogInsertData = {
      gpsRecordNo,
      tripDate: dateStr,
      vehicleId,
      driverId: driverId || null,
      originGpsStartPoint: originNameForSave,
      destinationGpsEndPoint: destNameForSave,
      coordinatesOrigin: originCoordForSave,
      coordinatesDestination: destCoordForSave,
      actualRouteRoadTaken: GPS_POINT_ROAD_PLACEHOLDER,
      departureTimeGps: departureTimeGpsForSave,
      arrivalTimeGps: arrivalTimeGpsForSave,
      gpsDistanceKm: clampNumeric(effectiveDistanceKm, 99999999.99),
      engineHours: clampNumeric(trip.engineHours || 0, 999999.99),
      maxSpeedKph: clampNumeric(trip.maxSpeedKph || 0, 9999.99),
      tripStatusGps: arrivalTimeGpsForSave ? 'arrived' : 'en-route',
      travelOrderId,
      toStatusAuto,
      anomalyFlag,
      notesRemarks,
      destinationVerified: destVerified,
      tripType,
      parentTripId: null,
    };

    try {
      const saved = await saveGpsTripLog(insertData);
      tripsCreated += 1;
      log(`  → ✅ Saved GPS log #${gpsRecordNo} (id=${saved.id}): type=${tripType} | origin="${originNameForSave}" | dest="${destNameForSave}" | dep=${departureTimeGpsForSave} | arr=${arrivalTimeGpsForSave} | destVerified=${destVerified}`);

      // ═══════════════════════════════════════════════════════════════
      // FIX 5: Create RETURN GPS log with swapped origin/destination
      // parent_trip_id = outbound GPS log id
      // ═══════════════════════════════════════════════════════════════
      if (tripType === 'RETURN' && trip.parentTrip) {
        // Find the parent OUTBOUND by travel_order_id + vehicle_id + trip_date + trip_type
        const parentResult = await pool.query<{ id: string }>(
          `SELECT id
             FROM gps_trip_logs
            WHERE vehicle_id = $1
              AND trip_date = $2
              AND trip_type = 'OUTBOUND'
              AND travel_order_id = $3
            ORDER BY created_at DESC
            LIMIT 1`,
          [vehicleId, dateStr, travelOrderId],
        );
        const parentId = parentResult.rows[0]?.id ?? null;
        if (parentId) {
          await pool.query(`UPDATE gps_trip_logs SET parent_trip_id = $1 WHERE id = $2`, [
            parentId, saved.id,
          ]);
          log(`  → Linked RETURN trip to parent OUTBOUND trip id=${parentId}`);
        } else {
          log(`  → Could not find parent OUTBOUND trip for RETURN trip`);
        }
      }
    } catch (err) {
      log(`  → FAILED to save trip: ${(err as Error).message}`);
      tripsFailed += 1;
    }
  }

  log(`Sync complete for ${plateNumber} on ${dateStr}: ${tripsCreated} created, ${tripsFailed} failed`);
  return { tripsCreated, tripsFailed, matchedToNumber, debugLogs };
}
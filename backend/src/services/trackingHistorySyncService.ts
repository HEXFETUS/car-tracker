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
  type CartrackHistoryPoint,
} from './cartrackHistoryService.js';
import {
  findVehicleByPlate,
  findDriverByName,
  findAllTravelOrdersForDate,
  matchTravelOrderToGpsTrip,
  haversineDistance,
  saveGpsTripLog,
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

// ── Helpers ────────────────────────────────────────────────────

function extractTimestampMs(point: CartrackHistoryPoint): number | null {
  const raw = String(
    point.event_time ?? point.event_ts ?? point.timestamp ?? point.start_time ?? point.start_timestamp ?? '',
  );
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function extractTimeStr(point: CartrackHistoryPoint): string | null {
  const ms = extractTimestampMs(point);
  return ms !== null ? new Date(ms).toISOString() : null;
}

function toCoordStr(point: CartrackHistoryPoint): string | null {
  const lat = point.latitude;
  const lon = point.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return `${lat.toFixed(6)},${lon.toFixed(6)}`;
}

function isDriving(point: CartrackHistoryPoint): boolean {
  const raw = point.ignition;
  let ignitionOn = false;
  if (typeof raw === 'boolean') ignitionOn = raw;
  else if (typeof raw === 'number') ignitionOn = raw > 0;
  else if (typeof raw === 'string') ignitionOn = /^(true|1|on|yes|y)$/.test(raw.trim().toLowerCase());
  const speed = Number(point.speed ?? point.speed_kph ?? 0);
  const moving = speed > 5;
  return ignitionOn && moving;
}

function isIdling(point: CartrackHistoryPoint): boolean {
  const raw = point.ignition;
  let ignitionOn = false;
  if (typeof raw === 'boolean') ignitionOn = raw;
  else if (typeof raw === 'number') ignitionOn = raw > 0;
  else if (typeof raw === 'string') ignitionOn = /^(true|1|on|yes|y)$/.test(raw.trim().toLowerCase());
  if (!ignitionOn) return false;
  const speed = Number(point.speed ?? point.speed_kph ?? 0);
  return speed <= 0;
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
          departureTime: new Date(tsMs).toISOString(),
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
          currentTrip.arrivalTime = new Date(tsMs).toISOString();
          currentTrip.gpsEndCoord = toCoordStr(point) ?? currentTrip.gpsEndCoord;
          const loc = String(point.location ?? point.location_name ?? point.address ?? '').trim();
          if (loc) currentTrip.destinationName = loc;
        }
      } else {
        // Stationary (ignition off or unknown) — break the trip
        if (currentTrip.arrivalTime === null) {
          // Finalize with last known location if no arrival
          currentTrip.arrivalTime = new Date(tsMs).toISOString();
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
      currentTrip.arrivalTime = prevTimestampMs ? new Date(prevTimestampMs).toISOString() : null;
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
        // Departure is at least 5 minutes after previous arrival — likely a new dispatch.
        // Still mark the previous trip's reverse as implicit return?
        // We'll allow both to coexist; explicit return detection requires overlapping / close matching.
        continue;
      }

      // Check location proximity: current departure should be near previous destination
      if (curDepartMs !== null && curDepartMs - prevArrMs <= 8 * 60 * 1000) {
        const depCoord = parseCoord(trip.gpsStartCoord ?? trip.originName);
        const prevDestCoord = parseCoord(prev.gpsEndCoord ?? prev.destinationName);
        if (depCoord && prevDestCoord) {
          const dist = haversineDistance(
            `${depCoord.lat},${depCoord.lon}`,
            `${prevDestCoord.lat},${prevDestCoord.lon}`,
          );
          if (dist <= DISTANCE_THRESHOLD_M) {
            // Vehicle left the destination — this IS a return trip
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

// We override to add tripType
interface DetectedTrip extends ReconstructedTrip {
  tripType?: 'OUTBOUND' | 'RETURN';
  parentTrip?: ReconstructedTrip | null;
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
      if (curDepartMs - prevArrMs > 8 * 60 * 1000) continue; // too late to be return

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
  // Priority 1: Travel Order's location_name
  if (travelOrder?.location_name) return travelOrder.location_name;

  // Priority 2: Travel Order's lat_long_destination → parse to name (not yet stored; skip)
  // Priority 3: Reverse geocode GPS coordinates
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

  // Fetch all active vehicles
  const vehiclesResult = await pool.query<{ id: string; plate_number: string }>(
    `SELECT id, plate_number FROM vehicles ORDER BY plate_number`,
  );
  const vehicles = vehiclesResult.rows;

  const results: SyncVehicleResult[] = [];
  let totalTripsCreated = 0;
  let totalTripsFailed = 0;

  for (const vehicle of vehicles) {
    const { id: vehicleId, plate_number } = vehicle;

    // Find all approved/active/completed TOs for each date in range
    const candidateTOs: TravelOrderWithTimes[] = [];
    const from = new Date(fromDate);
    const to = new Date(toDate);
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const tos = await findAllTravelOrdersForDate(vehicleId, dateStr);
      for (const to of tos) {
        if (!candidateTOs.some((c) => c.id === to.id)) candidateTOs.push(to);
      }
    }

    if (candidateTOs.length === 0) {
      results.push({ status: 'no_travel_order' });
      continue;
    }

    const primaryTO = candidateTOs[0];
    const resolvedDriverId = primaryTO.driver_id || null;

    // Resolve driver name from TO's driver_id
    let driverName: string | null = null;
    if (resolvedDriverId) {
      const driverRow = await pool.query<{ full_name: string }>(
        `SELECT full_name FROM drivers WHERE id = $1 LIMIT 1`,
        [resolvedDriverId],
      );
      driverName = driverRow.rows[0]?.full_name ?? null;
    }

    // Resolve Cartrack unit
    const unitInfo = await resolveCartrackUnitId(plate_number);
    if (!unitInfo) {
      results.push({ status: 'cartrack_unavailable' });
      continue;
    }

    // Iterate dates
    let vehicleTripsCreated = 0;
    let vehicleTripsFailed = 0;

    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const historyPoints = await fetchCartrackVehicleHistory(unitInfo.unitId, dateStr, plate_number);
      if (historyPoints.length === 0) continue;

      const rawTrips = reconstructTripsFromBreadcrumbs(historyPoints);
      if (rawTrips.length === 0) continue;

      const detectedTrips = detectReturnTrips(rawTrips);

      for (const trip of detectedTrips) {
        // Dedup check
        const dup = await isDuplicateTrip(
          vehicleId,
          trip.departureTime,
          trip.arrivalTime,
          trip.tripType ?? 'OUTBOUND',
        );
        if (dup) continue;

        // Match TO for this specific trip date
        const tosForDate = await findAllTravelOrdersForDate(vehicleId, dateStr);
        const matchedTO = matchTravelOrderToGpsTrip(
          trip.departureTime,
          trip.arrivalTime,
          trip.gpsEndCoord,
          tosForDate.length > 0 ? tosForDate : candidateTOs,
        );

        const driverId = matchedTO?.driver_id ?? resolvedDriverId;
        const travelOrderId = matchedTO?.id ?? primaryTO.id;
        const toStatusAuto = matchedTO?.status ?? primaryTO.status;

        // Determine origin/destination coordinates (include parent-trip linking for RETURNs)
        const coordinatesOrigin = trip.gpsStartCoord ?? null;
        const coordinatesDestination = trip.gpsEndCoord ?? null;

        // Destination verification
        const destCoordForMatch = trip.gpsEndCoord;
        const destVerified = destCoordForMatch && matchedTO?.lat_long_destination
          ? haversineDistance(destCoordForMatch, matchedTO.lat_long_destination) <= DISTANCE_THRESHOLD_M
          : false;

        // Resolve location name
        const locationName = await resolveLocationName(trip.gpsEndCoord, matchedTO);

        // Build trip record number
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
          parentTripId: null, // populated after we know destination trip ID
          locationName,
        };

        try {
          const saved = await saveGpsTripLog(insertData);
          vehicleTripsCreated += 1;

          // If this is a return trip, try to set parent_trip_id by locating the parent OUTBOUND
          if (trip.tripType === 'RETURN' && trip.parentTrip) {
            const parentResult = await pool.query<{ id: string }>(
              `SELECT id
                 FROM gps_trip_logs
                WHERE vehicle_id = $1
                  AND trip_date = $2
                  AND trip_type = 'OUTBOUND'
                  AND departure_time_gps = $3
                LIMIT 1`,
              [
                vehicleId,
                dateStr,
                trip.parentTrip.departureTime,
              ],
            );
            const parentId = parentResult.rows[0]?.id ?? null;
            if (parentId) {
              await pool.query(`UPDATE gps_trip_logs SET parent_trip_id = $1 WHERE id = $2`, [
                parentId,
                saved.id,
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
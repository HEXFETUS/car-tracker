// ── Trip Log Record Transformer ──────────────────────────────
//
// Converts raw vehicle telemetry + resolved status into a
// structured GPS trip log record matching the gps_trip_logs
// database schema. Pure functions — no side effects.

import { getVehicleName, getVehicleSpeed, toNumber, firstKey, firstPresent, firstNestedKey } from './tracker.js';

// ── Extraction Helpers ─────────────────────────────────────────

const ENGINE_TIME_KEYS = [
  'engine_hours', 'engineHours', 'engine_time', 'engineTime',
  'total_engine_hours', 'totalEngineHours', 'running_time', 'runningTime',
  'engine_run_time', 'engineRunTime', 'total_run_time', 'totalRunTime',
];

const DISTANCE_KEYS = [
  'distance_km', 'distanceKm', 'trip_distance', 'tripDistance',
  'odometer', 'total_distance', 'totalDistance', 'distance',
  'gps_distance', 'gpsDistance', 'mileage', 'travel_distance',
];

const ODOMER_START_KEYS = [
  'odometer_start', 'odometerStart', 'start_odometer', 'startOdometer',
  'trip_start_km', 'tripStartKm',
];

const ODOMER_END_KEYS = [
  'odometer_end', 'odometerEnd', 'end_odometer', 'endOdometer',
  'trip_end_km', 'tripEndKm',
];

const STREET_NAME_KEYS = [
  'street', 'road', 'road_name', 'roadName', 'street_name', 'streetName',
  'actual_route', 'actualRoute', 'route_taken', 'routeTaken',
  'road_taken', 'roadTaken', 'route_road', 'routeRoad',
];

const MOTION_KEYS = [
  'motion', 'moving', 'is_moving', 'isMoving', 'in_motion', 'inMotion',
  'vehicle_motion', 'vehicleMotion',
];

const PREVIOUS_LOCATION_KEYS = [
  'previous_location', 'previousLocation', 'last_known_location', 'lastKnownLocation',
  'origin', 'start_location', 'startLocation', 'trip_origin', 'tripOrigin',
];

// ── Engine Hours ───────────────────────────────────────────────

/**
 * Extract total engine running time in hours from the vehicle object.
 * Falls back to computing from ignition-on duration if available.
 */
export function getEngineHours(vehicle) {
  const raw = firstKey(vehicle, ENGINE_TIME_KEYS);
  if (raw !== null && raw !== undefined) {
    const hours = toNumber(raw, null);
    if (hours !== null && hours >= 0) return hours;
  }

  // Try nested telemetry objects
  const nested = firstNestedKey(vehicle, ['telemetry', 'stats', 'summary', 'engine']);
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const nestedVal = firstKey(nested, ['hours', 'runtime', 'run_time', 'runTime', 'total_hours', 'totalHours']);
    if (nestedVal !== null && nestedVal !== undefined) {
      return toNumber(nestedVal, 0);
    }
  }

  return 0;
}

// ── Distance / Odometer ────────────────────────────────────────

/**
 * Extract trip distance in km from the vehicle object.
 * Tries direct distance fields first, then computes from odometer readings.
 */
export function getGpsDistanceKm(vehicle) {
  const raw = firstKey(vehicle, DISTANCE_KEYS);
  if (raw !== null && raw !== undefined) {
    const km = toNumber(raw, null);
    if (km !== null && km >= 0) return km;
  }

  // Try computing from odometer start/end
  const odoStart = firstKey(vehicle, ODOMER_START_KEYS);
  const odoEnd = firstKey(vehicle, ODOMER_END_KEYS);
  if (odoStart !== null && odoEnd !== null) {
    const start = toNumber(odoStart, null);
    const end = toNumber(odoEnd, null);
    if (start !== null && end !== null && end >= start) {
      return Math.round((end - start) * 100) / 100;
    }
  }

  return 0;
}

// ── Route / Road Names ─────────────────────────────────────────

/**
 * Extract street/road name from the vehicle object or its location data.
 */
export function getStreetName(vehicle) {
  const direct = firstKey(vehicle, STREET_NAME_KEYS);
  if (direct && typeof direct === 'string' && direct.trim()) return direct.trim();

  // Check nested location/position objects
  const location = firstPresent(vehicle.location, vehicle.position, vehicle.current_position, vehicle.gps, {});
  if (location && typeof location === 'object' && !Array.isArray(location)) {
    const road = firstKey(location, ['road', 'street', 'road_name', 'roadName', 'street_name', 'streetName']);
    if (road && typeof road === 'string' && road.trim()) return road.trim();
  }

  return '';
}

// ── Movement / Motion Status ───────────────────────────────────

/**
 * Determine the trip status based on vehicle telemetry.
 * Returns one of: 'Moving', 'Idling', 'Parked'
 */
export function getTripStatus(vehicle, speed, ignition) {
  if (speed > 0) return 'Moving';

  const motion = firstKey(vehicle, MOTION_KEYS);
  if (motion === true || motion === 'true' || motion === 'moving' || motion === 1) return 'Moving';

  if (ignition && speed === 0) return 'Idling';

  return 'Parked';
}

// ── Previous Location (for origin tracking) ────────────────────

/**
 * Extract the previous/origin location from vehicle state or history.
 */
export function getPreviousLocation(vehicle) {
  const prev = firstKey(vehicle, PREVIOUS_LOCATION_KEYS);
  if (prev && typeof prev === 'string' && prev.trim()) return prev.trim();

  const location = firstPresent(vehicle.location, vehicle.position, {});
  if (location && typeof location === 'object' && !Array.isArray(location)) {
    const origin = firstKey(location, ['origin', 'start', 'previous', 'from']);
    if (origin && typeof origin === 'string') return origin.trim();
  }

  return '';
}

// ── Main Transformer ───────────────────────────────────────────

/**
 * Build a comprehensive GPS trip log record from raw vehicle data
 * and its computed status. This function is a pure data transformer.
 *
 * @param {object} vehicle       - Raw vehicle payload from Cartrack API
 * @param {object} vehicleStatus - Computed status from buildVehicleStatus / syncFleetAndAlert
 * @param {string} currentLocation - Resolved location string for origin
 * @returns {object} Structured trip log record ready for database insertion
 */
export function buildTripLogRecord(vehicle, vehicleStatus, currentLocation) {
  const eventTime = firstPresent(
    vehicle.event_time, vehicle.event_ts, vehicle.timestamp, vehicle.time,
    vehicle.gps_time, vehicle.gpsTime, vehicle.server_time, vehicle.serverTime,
    vehicle.recorded_at, vehicle.recordedAt, vehicle.last_update, vehicle.updated_at,
  );

  const ignition = toNumber(firstPresent(vehicle.ignition, vehicle.engine, vehicle.engine_on, vehicle.engine_status, vehicle.ignition_status, vehicle.acc), 0) ||
    (typeof firstPresent(vehicle.ignition, vehicle.engine) === 'boolean' ? (firstPresent(vehicle.ignition, vehicle.engine) ? 1 : 0) : 0);
  const isIgnitionOn = Boolean(ignition);

  const speed = vehicleStatus?.speed ?? getVehicleSpeed(vehicle);
  const tripStatus = getTripStatus(vehicle, speed, isIgnitionOn);

  // Parse event time into trip_date (YYYY-MM-DD)
  let tripDate = new Date().toISOString().slice(0, 10);
  if (eventTime) {
    let normalized = String(eventTime).trim();
    if (!normalized.includes('T')) normalized = normalized.replace(' ', 'T');
    if (!/[+-]\d\d/.test(normalized.slice(-5))) normalized += '+08:00';
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      tripDate = parsed.toISOString().slice(0, 10);
    }
  }

  // Determine departure and arrival timestamps
  const departureTime = isIgnitionOn ? (eventTime || null) : null;
  const arrivalTime = (!isIgnitionOn && speed === 0) ? (eventTime || null) : null;

  // Build record
  const plateNumber = String(getVehicleName(vehicle) || vehicleStatus?.name || '').trim().toUpperCase();

  return {
    plateNumber,
    tripDate,
    originGpsStartPoint: vehicleStatus?.location || currentLocation || '',
    destinationGpsEndPoint: vehicleStatus?.location || currentLocation || '',
    actualRouteRoadTaken: getStreetName(vehicle),
    departureTimeGps: departureTime,
    arrivalTimeGps: arrivalTime,
    gpsDistanceKm: getGpsDistanceKm(vehicle),
    engineHours: getEngineHours(vehicle),
    maxSpeedKph: speed,
    tripStatus,
    anomalyFlag: Boolean(vehicleStatus?.speeding || vehicleStatus?.low_fuel),
    driverName: vehicleStatus?.driver || null,
    toNumber: vehicleStatus?.to_number || null,
  };
}
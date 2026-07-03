// ── GPS Trip State Tracker ──────────────────────────────────────
//
// Per-vehicle state manager that tracks trip origins, destinations,
// and arrival state. Generates structured trip lifecycle alerts for
// ingestion by the fleet sync pipeline.
//
// SCOPE:
//   - Trip start/end (IGNITION_ON, IGNITION_OFF)
//   - Origin saving
//   - TO-based arrival detection (DESTINATION_ARRIVED)
//   - Return trip management (RETURN_TRIP_STARTED)
//
// NOT IN SCOPE (handled by tracker.js):
//   - Idling alerts (IDLING)
//   - Motion alerts
//   - Speed/fuel alerts
//
// IMPORTANT:
//   - Arrival is ONLY determined by matching GPS coordinates against
//     a Travel Order (TO) destination. Idle time is NEVER used to
//     infer arrival.
//   - Ignition OFF is ONLY triggered by explicit ignition=false or
//     engine=false telemetry fields. Speed=0 is NEVER treated as
//     ignition OFF.

import { getJson, setJson } from './state.js';
import pg from 'pg';

const { Pool } = pg;
let telemetryPool = null;

function getTelemetryPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!telemetryPool) {
    telemetryPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return telemetryPool;
}

async function getLatestTelemetry(vehicleId) {
  const pool = getTelemetryPool();
  if (!pool) return null;
  const result = await pool.query(
    `SELECT speed_kmh, ignition, event_type, active_trip_id
     FROM gps_telemetry
     WHERE vehicle_id = $1
     ORDER BY recorded_at DESC
     LIMIT 1`,
    [vehicleId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    speedKmh: Number(row.speed_kmh ?? 0),
    ignition: row.ignition === true,
    eventType: row.event_type,
    activeTripId: row.active_trip_id ?? null,
  };
}

// ── Constants ────────────────────────────────────────────────────

// Destination radius in meters for TO-based arrival detection.
// Can be overridden via DESTINATION_RADIUS_METERS env variable.
// Default: 100 meters
const DESTINATION_RADIUS_METERS = Number(process.env.DESTINATION_RADIUS_METERS) || 100;

// ── Event Type Constants ─────────────────────────────────────────
// Normalized event types used across the entire telemetry pipeline.
// These match what is actually saved in gps_telemetry.event_type.

const IGNITION_ON = 'IGNITION_ON';
const IGNITION_OFF = 'IGNITION_OFF';
const LOCATION_UPDATE = 'LOCATION_UPDATE';
const IDLING = 'IDLING';
const MOTION_STARTED = 'MOTION_STARTED';
const SPEEDING = 'SPEEDING';
const LOW_FUEL = 'LOW_FUEL';

function normalizeTelemetryEventType(eventType) {
  const raw = String(eventType || '');
  let result;
  switch (raw) {
    case 'IGNITION ON ALERT':
    case 'IGNITION_ON':
      result = IGNITION_ON;
      break;
    case 'IGNITION OFF ALERT':
    case 'IGNITION_OFF':
      result = IGNITION_OFF;
      break;
    case 'LOCATION UPDATE ALERT':
    case 'LOCATION UPDATE':
    case 'LOCATION_UPDATE':
      result = LOCATION_UPDATE;
      break;
    case 'IDLING ALERT':
    case 'IDLING TOO LONG ALERT':
    case 'IDLING':
    case 'IDLING_TOO_LONG':
      result = IDLING;
      break;
    case 'MOVING ALERT':
    case 'MOTION_STARTED':
      result = MOTION_STARTED;
      break;
    case 'SPEEDING ALERT':
    case 'SPEEDING':
      result = SPEEDING;
      break;
    case 'LOW FUEL ALERT':
    case 'LOW_FUEL':
      result = LOW_FUEL;
      break;
    default:
      result = raw;
      break;
  }
  if (raw !== result) {
    console.log('[EVENT NORMALIZED]', { incoming: raw, saved: result });
  }
  return result;
}

// Event types that indicate an active trip is in progress.
// Used when restoring trip state after restart/state loss.
const ACTIVE_TRIP_EVENT_TYPES = new Set([
  IGNITION_ON,
  LOCATION_UPDATE,
  MOTION_STARTED,
  IDLING,
  SPEEDING,
  LOW_FUEL,
]);

// ── State Keys ───────────────────────────────────────────────────

function stateKey(vehicleId) {
  return `trip:${vehicleId}`;
}

function returnStateKey(vehicleId) {
  return `return:trip:${vehicleId}`;
}

// ── Helpers ──────────────────────────────────────────────────────

function defaultState() {
  return {
    currentTripId: null,
    tripStarted: false,
    arrived: false,
    originSaved: false,
    originCoordinate: null,
    destinationSaved: false,
    destinationCoordinate: null,
    arrivalTime: null,
    toDestinationCoordinate: null, // Destination from Travel Order
  };
}

function defaultReturnState() {
  return {
    returnTripStarted: false,
    returnTripId: null,
    originSaved: false,
    originCoordinate: null,
  };
}

function loadState(vehicleId) {
  const raw = getJson(stateKey(vehicleId), null);
  if (!raw) return defaultState();
  return { ...defaultState(), ...raw };
}

function saveState(vehicleId, state) {
  setJson(stateKey(vehicleId), state, 86400);
}

function loadReturnState(vehicleId) {
  const raw = getJson(returnStateKey(vehicleId), null);
  if (!raw) return defaultReturnState();
  return { ...defaultReturnState(), ...raw };
}

function saveReturnState(vehicleId, state) {
  setJson(returnStateKey(vehicleId), state, 86400);
}

function formatCoordinate(lat, lng) {
  if (lat == null || lng == null) return null;
  return `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
}

// ── Distance Calculation (Haversine) ────────────────────────────

export function haversineDistance(coord1, coord2) {
  if (!coord1 || !coord2) return Infinity;
  const match1 = String(coord1).trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  const match2 = String(coord2).trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match1 || !match2) return Infinity;

  const lat1 = Number(match1[1]);
  const lon1 = Number(match1[2]);
  const lat2 = Number(match2[1]);
  const lon2 = Number(match2[2]);

  const R = 6371e3; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function isWithinRadius(coord1, coord2, radiusMeters = DESTINATION_RADIUS_METERS) {
  return haversineDistance(coord1, coord2) <= radiusMeters;
}

// ── Ignition Helpers ─────────────────────────────────────────────

/**
 * Extract the raw ignition value from the vehicle payload.
 * Returns the first non-null/non-undefined value found, or null
 * if no ignition fields exist in the payload at all.
 */
function getIgnitionRaw(vehicle) {
  return vehicle.ignition ??
    vehicle.engine ??
    vehicle.engine_on ??
    vehicle.engine_status ??
    vehicle.ignition_status ??
    vehicle.acc ??
    null;
}

/**
 * Convert a raw ignition value to a boolean.
 */
function rawToBool(raw) {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['true', 'on', '1', 'yes', 'y', 'running'].includes(normalized)) return true;
    if (['false', 'off', '0', 'no', 'n', 'stopped'].includes(normalized)) return false;
  }
  return Boolean(raw);
}

// ── State Transitions ────────────────────────────────────────────

/**
 * Given a vehicle's current telemetry and optional Travel Order
 * destination, process state transitions and return any generated
 * alerts.
 *
 * Trip lifecycle only: IGNITION_ON, IGNITION_OFF, DESTINATION_ARRIVED,
 * RETURN_TRIP_STARTED.
 *
 * Idling alerts are NOT emitted here — they are handled by tracker.js's
 * getIdleStatus() which runs independently.
 *
 * @param {object} vehicle - Raw Cartrack vehicle payload.
 * @param {string} vehicleId - Resolved database vehicle UUID.
 * @param {number|null} latitude
 * @param {number|null} longitude
 * @param {string|null} toDestinationCoordinate - TO destination "lat,lng" or null
 * @returns {Array<{ type: string, message: string, latitude, longitude }>}
 */
export async function processTripState(vehicle, vehicleId, latitude = null, longitude = null, toDestinationCoordinate = null) {
  const alerts = [];

  const speed = Number(
    vehicle.speed ??
    vehicle.speed_kph ??
    vehicle.speedKph ??
    vehicle.speed_kmh ??
    vehicle.speedKmh ??
    vehicle.current_speed ??
    vehicle.currentSpeed ??
    0,
  );

  const now = Date.now();
  const currentCoord = formatCoordinate(latitude, longitude);

  // ── Initialize state from DB on restart ──────────────────────
  // On backend restart, in-memory state is lost. We initialize from
  // the latest telemetry record to avoid false IGNITION ON alerts.
  let state = loadState(vehicleId);
  if (!state.tripStarted && !state.arrived) {
    // No in-memory state — check if we have a last known state from telemetry
    const lastTelemetry = await getLatestTelemetry(vehicleId);
    if (lastTelemetry) {
      const lastEventType = normalizeTelemetryEventType(lastTelemetry.eventType);
      const wasIgnitionOn = lastTelemetry.ignition === true;
      const isMoving = lastTelemetry.speedKmh > 0;

      console.log(`[tripState] Latest DB telemetry for ${vehicleId}:`, JSON.stringify({
        eventType: lastEventType,
        speedKmh: lastTelemetry.speedKmh,
        ignition: lastTelemetry.ignition,
        activeTripId: lastTelemetry.activeTripId,
      }));

      // Restore active trip state when latest telemetry event_type is any
      // active-trip event type, or when ignition=true and speed_kmh > 0.
      const shouldRestoreTrip = ACTIVE_TRIP_EVENT_TYPES.has(lastEventType) ||
        (wasIgnitionOn && isMoving);

      if (shouldRestoreTrip) {
        state.tripStarted = true;
        state.currentTripId = lastTelemetry.activeTripId;
        if (lastEventType === 'DESTINATION_ARRIVED') {
          state.arrived = true;
        }
        saveState(vehicleId, state);
        console.log(`[tripState] Restored active trip for ${vehicleId}:`, JSON.stringify({
          restoredTripId: state.currentTripId,
          reason: lastEventType ? `event_type=${lastEventType}` : 'ignition=true && speed>0',
          lastEventType,
          wasIgnitionOn,
          isMoving,
        }));
      } else {
        console.log(`[tripState] Did NOT restore trip for ${vehicleId}:`, JSON.stringify({
          reason: 'no active trip indicators in latest telemetry',
          lastEventType,
          wasIgnitionOn,
          isMoving,
        }));
      }
    }
  }

  // ── Ignition Detection ──────────────────────────────────────
  // Extract raw ignition from telemetry. If no ignition fields
  // exist at all, preserve the previous ignition state so that
  // trip processing (origin capture, arrival detection, return
  // trip) continues uninterrupted.
  //
  // IGNITION_ON and IGNITION_OFF alerts are ONLY emitted when
  // the ignition value came from explicit telemetry fields.
  const ignitionRaw = getIgnitionRaw(vehicle);
  const hasExplicitIgnition = ignitionRaw !== null;
  const ignition = hasExplicitIgnition ? rawToBool(ignitionRaw) : state.tripStarted;

  // ── Diagnostic: Log ignition field selection for KAR6558 ──
  if (vehicle.registration === 'KAR6558' || vehicle.vehicle_id === 'KAR6558' || vehicle.plate === 'KAR6558') {
    console.log('[DIAGNOSTIC] Ignition field selection for KAR6558:', JSON.stringify({
      raw_fields: {
        ignition: vehicle.ignition,
        engine: vehicle.engine,
        engine_on: vehicle.engine_on,
        engine_status: vehicle.engine_status,
        ignition_status: vehicle.ignition_status,
        acc: vehicle.acc,
      },
      selected_raw: ignitionRaw,
      selected_fields: getIgnitionRaw.toString(),
      resolved_bool: ignition,
      has_explicit: hasExplicitIgnition,
      speed,
      timestamp: new Date().toISOString(),
    }, null, 2));
  }

  const status = inferStatus(ignition, speed);

  // ── Ignition ON – start trip ────────────────────────────────
  // Only emit IGNITION_ON when the value came from telemetry.
  // Do NOT create a new IGNITION ON ALERT if the latest DB telemetry
  // already shows: ignition=true, or speed_kmh > 0, or active_trip_id
  // is not null and latest event is not IGNITION OFF ALERT.
  if (ignition && !state.tripStarted && !state.arrived) {
    if (hasExplicitIgnition) {
      // Check DB to see if vehicle is already in an active trip
      const lastTelemetry = await getLatestTelemetry(vehicleId);
      const dbShowsActiveTrip = lastTelemetry && (
        lastTelemetry.ignition === true ||
        lastTelemetry.speedKmh > 0 ||
        (lastTelemetry.activeTripId !== null && normalizeTelemetryEventType(lastTelemetry.eventType) !== IGNITION_OFF)
      );

      if (dbShowsActiveTrip) {
        // Vehicle is already moving/has active trip — do NOT emit IGNITION ON
        console.log(`[tripState] SKIPPED IGNITION ON for ${vehicleId}:`, JSON.stringify({
          reason: 'DB already shows active trip',
          dbIgnition: lastTelemetry?.ignition,
          dbSpeedKmh: lastTelemetry?.speedKmh,
          dbActiveTripId: lastTelemetry?.activeTripId,
          dbEventType: lastTelemetry?.eventType,
        }));
        // Restore state from DB so subsequent processing works
        state.tripStarted = true;
        state.currentTripId = lastTelemetry.activeTripId;
        state.arrived = false;
        saveState(vehicleId, state);
        return alerts;
      }

      state.tripStarted = true;
      state.arrived = false;
      state.currentTripId = `trip-${vehicleId}-${now}`;
      state.originSaved = false;
      state.originCoordinate = null;
      state.destinationSaved = false;
      state.destinationCoordinate = null;
      state.arrivalTime = null;
      state.toDestinationCoordinate = toDestinationCoordinate;
      saveState(vehicleId, state);

      console.log(`[tripState] EMITTED IGNITION ON for ${vehicleId}:`, JSON.stringify({
        reason: 'explicit_ignition_on_and_no_active_trip_in_db',
        tripId: state.currentTripId,
        coordinate: currentCoord,
        timestamp: new Date(now).toISOString(),
      }));

      alerts.push({
        type: 'IGNITION_ON',
        message: 'Vehicle ignition turned ON',
        latitude,
        longitude,
        vehicleId,
        tripId: state.currentTripId,
        timestamp: new Date(now).toISOString(),
      });
    }
    return alerts;
  }

  // ── Ignition OFF – end trip ─────────────────────────────────
  // Only end the trip when explicitly reported. When the ignition
  // field is missing, we preserve state.tripStarted so the trip
  // continues in a subsequent cycle.
  if (!ignition && state.tripStarted) {
    if (hasExplicitIgnition) {
      const endedTripId = state.currentTripId;

      state.tripStarted = false;
      state.arrived = false;
      state.currentTripId = null;
      state.originSaved = false;
      state.originCoordinate = null;
      state.destinationSaved = false;
      state.destinationCoordinate = null;
      state.arrivalTime = null;
      state.toDestinationCoordinate = null;
      saveState(vehicleId, state);

      // Also clear return trip state since vehicle is off
      const returnState = loadReturnState(vehicleId);
      returnState.returnTripStarted = false;
      returnState.returnTripId = null;
      returnState.originSaved = false;
      returnState.originCoordinate = null;
      saveReturnState(vehicleId, returnState);

      console.log('[trip] END', {
        vehicle: vehicleId,
        tripId: endedTripId,
        reason: 'explicit_ignition_off',
        coordinate: currentCoord,
        timestamp: new Date(now).toISOString(),
      });

      alerts.push({
        type: 'IGNITION_OFF',
        message: 'Vehicle ignition turned OFF',
        latitude,
        longitude,
        vehicleId,
        tripId: endedTripId,
        timestamp: new Date(now).toISOString(),
      });
    }
    return alerts;
  }

  // Engine is off — no further processing this cycle
  if (!ignition) {
    return alerts;
  }

  // ── ARRIVED state: vehicle has completed outbound trip ────
  // Vehicle is still running at destination or just left.
  if (state.arrived && state.tripStarted) {
    if (status === 'driving') {
      // Vehicle left destination — initiate return trip
      state.tripStarted = false;
      state.arrived = false;
      saveState(vehicleId, state);

      const returnState = loadReturnState(vehicleId);
      returnState.returnTripStarted = true;
      returnState.returnTripId = `return-${vehicleId}-${now}`;
      returnState.originSaved = false;
      returnState.originCoordinate = currentCoord || state.destinationCoordinate;
      saveReturnState(vehicleId, returnState);

      console.log('[trip] RETURN_START', {
        vehicle: vehicleId,
        tripId: state.currentTripId,
        returnTripId: returnState.returnTripId,
        speed,
        coordinate: currentCoord,
        timestamp: new Date(now).toISOString(),
      });

      alerts.push({
        type: 'RETURN_TRIP_STARTED',
        message: 'Vehicle left destination — return trip started',
        latitude,
        longitude,
        vehicleId,
        tripId: returnState.returnTripId,
        returnOriginCoordinate: returnState.originCoordinate,
        timestamp: new Date(now).toISOString(),
      });
    }
    return alerts;
  }

  // ── Normal driving trip (not yet arrived) ─────────────────
  if (status === 'driving') {
    // Origin: first time driving in this trip
    if (!state.originSaved) {
      if (!state.originCoordinate && currentCoord) {
        state.originCoordinate = currentCoord;
      }
      state.originSaved = true;
      saveState(vehicleId, state);

      console.log('[trip] ORIGIN', {
        vehicle: vehicleId,
        tripId: state.currentTripId,
        coordinate: state.originCoordinate,
        timestamp: new Date(now).toISOString(),
      });

      return alerts; // origin is returned via state, not as alert
    }
  }

  // ── TO-Based Arrival Detection ─────────────────────────────
  // A vehicle has only arrived if:
  // 1. There is an active Travel Order linked to the vehicle
  //    (toDestinationCoordinate is provided)
  // 2. The current GPS location is within the allowed destination radius
  if (!state.arrived && toDestinationCoordinate && currentCoord) {
    if (isWithinRadius(currentCoord, toDestinationCoordinate)) {
      state.arrived = true;
      state.destinationSaved = true;
      state.destinationCoordinate = currentCoord;
      state.arrivalTime = new Date(now).toISOString();
      state.toDestinationCoordinate = toDestinationCoordinate;
      saveState(vehicleId, state);

      alerts.push({
        type: 'DESTINATION_ARRIVED',
        message: 'Vehicle arrived at destination',
        latitude,
        longitude,
        vehicleId,
        tripId: state.currentTripId,
        destinationCoordinate: state.destinationCoordinate,
        arrivalTime: state.arrivalTime,
        timestamp: new Date(now).toISOString(),
      });

      console.log('[trip] ARRIVED', {
        vehicle: vehicleId,
        tripId: state.currentTripId,
        distance: `${Math.round(haversineDistance(currentCoord, toDestinationCoordinate))}m`,
        destination: toDestinationCoordinate,
        coordinate: currentCoord,
        timestamp: new Date(now).toISOString(),
      });

      return alerts;
    }
  }

  return alerts;
}

/**
 * Consume the saved origin for a trip. Returns null if not available.
 */
export function consumeOrigin(vehicleId) {
  const state = loadState(vehicleId);
  if (!state.originSaved || !state.tripStarted || !state.currentTripId) {
    return null;
  }
  state.originSaved = false;
  saveState(vehicleId, state);
  return { tripId: state.currentTripId, originCoordinate: state.originCoordinate };
}

/**
 * Consume the saved destination for a trip. Returns null if not available.
 *
 * Destination is only saved when TO-based arrival is confirmed.
 */
export function consumeDestination(vehicleId) {
  const state = loadState(vehicleId);
  if (!state.tripStarted || !state.currentTripId) return null;
  if (!state.destinationSaved) return null;

  if (state.arrived) {
    state.destinationSaved = false;
    saveState(vehicleId, state);
    return {
      tripId: state.currentTripId,
      destinationCoordinate: state.destinationCoordinate,
      arrivalTime: state.arrivalTime,
    };
  }

  return null;
}

/**
 * Check whether a vehicle has arrived at its destination.
 */
export function hasVehicleArrived(vehicleId) {
  const state = loadState(vehicleId);
  return state.arrived && state.tripStarted;
}

/**
 * Get the return trip state for a vehicle.
 */
export function getReturnTripState(vehicleId) {
  return loadReturnState(vehicleId);
}

/**
 * Reset all state for a vehicle.
 */
export function resetVehicleState(vehicleId) {
  saveState(vehicleId, defaultState());
  saveReturnState(vehicleId, defaultReturnState());
}

/**
 * Infer vehicle status from ignition and speed.
 */
function inferStatus(ignition, speed) {
  if (!ignition) return 'stationary';
  if (speed > 0) return 'driving';
  return 'idling';
}

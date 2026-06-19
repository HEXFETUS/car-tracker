// ── GPS Trip State Tracker ──────────────────────────────────────
//
// Per-vehicle state manager that tracks trip origins, destinations,
// and idling duration. Generates structured alerts for ingestion by
// the fleet sync pipeline.

import { getJson, setJson } from './state.js';

// ── Constants ────────────────────────────────────────────────────

const ARRIVAL_IDLE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const DESTINATION_RADIUS_METERS = 100; // Configurable radius for destination verification

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
    idleStartTime: null,
    lastIdleAlertTime: null,
    continuousIdleDurationMs: 0,
  };
}

function defaultReturnState() {
  return {
    returnTripStarted: false,
    returnTripId: null,
    originSaved: false,
    originCoordinate: null,
    idleStartTime: null,
    continuousIdleDurationMs: 0,
    lastIdleAlertTime: null,
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

// ── State Transitions ────────────────────────────────────────────

/**
 * Given a vehicle's current telemetry and optional explicit trigger
 * flags, process state transitions and return any generated alerts.
 *
 * @param {object} vehicle - Raw Cartrack vehicle payload.
 * @param {string} vehicleId - Resolved database vehicle UUID.
 * @param {number|null} latitude
 * @param {number|null} longitude
 * @returns {Array<{ type: string, message: string, latitude, longitude }>}
 */
export function processTripState(vehicle, vehicleId, latitude = null, longitude = null) {
  const alerts = [];

  const ignition = Boolean(
    vehicle.ignition ||
    vehicle.engine ||
    vehicle.engine_on ||
    vehicle.engine_status ||
    vehicle.ignition_status ||
    vehicle.acc,
  );

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

  const status = inferStatus(ignition, speed);
  const now = Date.now();
  const currentCoord = formatCoordinate(latitude, longitude);

  const state = loadState(vehicleId);

  // Ignition ON – start trip if not already started
  if (ignition && !state.tripStarted && !state.arrived) {
    state.tripStarted = true;
    state.arrived = false;
    state.currentTripId = `trip-${vehicleId}-${now}`;
    state.originSaved = false;
    state.originCoordinate = null;
    state.destinationSaved = false;
    state.destinationCoordinate = null;
    state.arrivalTime = null;
    state.idleStartTime = null;
    state.lastIdleAlertTime = null;
    state.continuousIdleDurationMs = 0;
    saveState(vehicleId, state);

    alerts.push({
      type: 'IGNITION_ON',
      message: 'Vehicle ignition turned ON',
      latitude,
      longitude,
      vehicleId,
      tripId: state.currentTripId,
      timestamp: new Date(now).toISOString(),
    });
    return alerts;
  }

  // Ignition OFF – end trip and reset
  if (!ignition && state.tripStarted) {
    const wasArrived = state.arrived;
    state.tripStarted = false;
    state.arrived = false;
    state.currentTripId = null;
    state.originSaved = false;
    state.originCoordinate = null;
    state.destinationSaved = false;
    state.destinationCoordinate = null;
    state.arrivalTime = null;
    state.idleStartTime = null;
    state.lastIdleAlertTime = null;
    state.continuousIdleDurationMs = 0;
    saveState(vehicleId, state);

    // Also clear return trip state since vehicle is off
    const returnState = loadReturnState(vehicleId);
    returnState.returnTripStarted = false;
    returnState.returnTripId = null;
    returnState.originSaved = false;
    returnState.originCoordinate = null;
    returnState.idleStartTime = null;
    returnState.continuousIdleDurationMs = 0;
    returnState.lastIdleAlertTime = null;
    saveReturnState(vehicleId, returnState);

    alerts.push({
      type: 'IGNITION_OFF',
      message: 'Vehicle ignition turned OFF',
      latitude,
      longitude,
      vehicleId,
      tripId: null,
      timestamp: new Date(now).toISOString(),
    });
    return alerts;
  }

  if (!ignition) {
    return alerts;
  }

  // ── ARRIVED state: vehicle has completed outbound trip ────
  // Vehicle is still running (idling) at destination
  if (state.arrived && state.tripStarted) {
    // Continue tracking idle duration for additional idling alerts
    if (status === 'idling') {
      if (state.idleStartTime === null) {
        state.idleStartTime = now;
        state.continuousIdleDurationMs = 0;
        state.lastIdleAlertTime = null;
      } else {
        state.continuousIdleDurationMs = now - state.idleStartTime;
      }

      const continuousMs = state.continuousIdleDurationMs;
      const repeatIntervalMs = 30 * 60 * 1000; // 30-minute repeat

      if (state.lastIdleAlertTime === null) {
        // First idle alert at 10 min after arrival
        if (continuousMs >= ARRIVAL_IDLE_THRESHOLD_MS) {
          alerts.push({
            type: 'IDLING',
            message: `Vehicle arrived and idling for ${ARRIVAL_IDLE_THRESHOLD_MS / 60000} minutes`,
            latitude,
            longitude,
            vehicleId,
            tripId: state.currentTripId,
            idleMinutes: ARRIVAL_IDLE_THRESHOLD_MS / 60000,
            timestamp: new Date(now).toISOString(),
          });
          state.lastIdleAlertTime = now;
          saveState(vehicleId, state);
        } else {
          saveState(vehicleId, state);
        }
      } else if (now - state.lastIdleAlertTime >= repeatIntervalMs) {
        const totalMinutes = Math.floor(continuousMs / 60000);
        alerts.push({
          type: 'IDLING',
          message: `Vehicle arrived and idling for ${totalMinutes} minutes`,
          latitude,
          longitude,
          vehicleId,
          tripId: state.currentTripId,
          idleMinutes: totalMinutes,
          timestamp: new Date(now).toISOString(),
        });
        state.lastIdleAlertTime = now;
        saveState(vehicleId, state);
      } else {
        saveState(vehicleId, state);
      }
    } else if (status === 'driving') {
      // Vehicle left destination — initiate return trip
      state.tripStarted = false;
      state.arrived = false;
      saveState(vehicleId, state);

      const returnState = loadReturnState(vehicleId);
      returnState.returnTripStarted = true;
      returnState.returnTripId = `return-${vehicleId}-${now}`;
      returnState.originSaved = false;
      returnState.originCoordinate = currentCoord || state.destinationCoordinate;
      returnState.idleStartTime = null;
      returnState.continuousIdleDurationMs = 0;
      returnState.lastIdleAlertTime = null;
      saveReturnState(vehicleId, returnState);

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
      return alerts; // origin is returned via state, not as alert
    }

    // Driving resets idle timer
    if (state.idleStartTime !== null) {
      state.idleStartTime = null;
      state.continuousIdleDurationMs = 0;
      state.lastIdleAlertTime = null;
      saveState(vehicleId, state);
    }
  }

  if (status === 'idling') {
    if (state.idleStartTime === null) {
      state.idleStartTime = now;
      state.continuousIdleDurationMs = 0;
      state.lastIdleAlertTime = null;
    } else {
      state.continuousIdleDurationMs = now - state.idleStartTime;
    }

    const continuousMs = state.continuousIdleDurationMs;
    const firstThresholdMs = ARRIVAL_IDLE_THRESHOLD_MS;

    if (continuousMs >= firstThresholdMs) {
      // Arrival detected!
      if (!state.arrived && !state.destinationSaved) {
        state.arrived = true;
        state.destinationSaved = true;
        state.destinationCoordinate = currentCoord || state.originCoordinate;
        state.arrivalTime = new Date(now).toISOString();
        state.lastIdleAlertTime = now;
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
        return alerts;
      }

      // Already arrived - repeating idling alert every 30 min
      const repeatIntervalMs = 30 * 60 * 1000;
      if (state.lastIdleAlertTime === null || now - state.lastIdleAlertTime >= repeatIntervalMs) {
        const totalMinutes = Math.floor(continuousMs / 60000);
        alerts.push({
          type: 'IDLING',
          message: `Vehicle idling at destination for ${totalMinutes} minutes`,
          latitude,
          longitude,
          vehicleId,
          tripId: state.currentTripId,
          idleMinutes: totalMinutes,
          timestamp: new Date(now).toISOString(),
        });
        state.lastIdleAlertTime = now;
        saveState(vehicleId, state);
      }
    } else {
      saveState(vehicleId, state);
    }
  }

  if (status === 'stationary') {
    state.idleStartTime = null;
    state.continuousIdleDurationMs = 0;
    state.lastIdleAlertTime = null;
    saveState(vehicleId, state);
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
 */
export function consumeDestination(vehicleId) {
  const state = loadState(vehicleId);
  if (!state.tripStarted || !state.currentTripId) return null;
  if (!state.destinationSaved) return null;

  const continuousMs = state.continuousIdleDurationMs;
  const thresholdMs = ARRIVAL_IDLE_THRESHOLD_MS;

  if (continuousMs >= thresholdMs || state.arrived) {
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
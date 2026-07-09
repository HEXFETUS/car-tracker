// ── GPS Vehicle State Machine ──────────────────────────────────
//
// Per-vehicle state machine that tracks ignition state, pending
// ignition transitions (debounce by consecutive poll count),
// active trip IDs, and motion state. All state is persisted in
// the database so it survives restarts and is shared across
// scheduler cycles.
//
// This is the SINGLE source of truth for ignition detection.
// No other code path should independently detect ignition changes.
//
// ── State Machine ──────────────────────────────────────────────
//
//   OFF ──[ignition=ON for N consecutive polls]──> PENDING_ON
//   PENDING_ON ──[ignition stays ON]──> ON (emit IGNITION_ON)
//   PENDING_ON ──[ignition goes OFF]──> OFF (ignore glitch)
//   ON ──[ignition=OFF for N consecutive polls]──> PENDING_OFF
//   PENDING_OFF ──[ignition stays OFF]──> OFF (emit IGNITION_OFF)
//   PENDING_OFF ──[ignition goes ON]──> ON (ignore glitch)
//
// IMPORTANT: Confirmation is based on CONSECUTIVE POLL COUNT,
// not elapsed time. This is because the scheduler polls at a
// fixed interval (SYNC_INTERVAL_SECONDS). With 30s polling,
// a 15-second time-based debounce would never be measurable.
// Using poll count (default 2) means the state machine needs
// 2 consecutive identical readings before confirming, which
// works correctly regardless of the polling interval.

import { getPool } from '../db/db.js';
import { randomUUID } from 'node:crypto';

// ── Configuration (from env with defaults) ─────────────────────

// Number of consecutive identical polls required to confirm ignition change.
// Default: 2 (needs 2 consecutive ON polls to confirm ON, 2 OFF to confirm OFF).
// This works correctly regardless of SYNC_INTERVAL_SECONDS.
export const IGNITION_CONFIRMATION_POLLS = Number(process.env.IGNITION_CONFIRMATION_POLLS || 2);
export const IGNITION_DUPLICATE_WINDOW_SECONDS = Number(process.env.IGNITION_DUPLICATE_WINDOW_SECONDS || 30);
export const MIN_MOVEMENT_METERS = Number(process.env.MIN_MOVEMENT_METERS || 20);
export const MIN_MOVING_SPEED_KMH = Number(process.env.MIN_MOVING_SPEED_KMH || 3);

// ── State Types ────────────────────────────────────────────────

export type IgnitionState = 'OFF' | 'PENDING_ON' | 'ON' | 'PENDING_OFF';

export interface VehicleState {
  vehicleId: string;
  ignitionState: IgnitionState;
  lastConfirmedIgnition: boolean;
  lastConfirmedIgnitionAt: string | null;
  pendingIgnition: boolean | null;
  pendingSince: string | null;
  pendingPollCount: number;
  activeTripId: string | null;
  lastPacketTime: string | null;
  lastSpeed: number;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastLocationName: string | null;
  lastEventType: string | null;
  updatedAt: string;
  version: number; // Optimistic concurrency version
}

interface VehicleStateDbRow {
  vehicle_id: string;
  ignition_state: string;
  last_confirmed_ignition: boolean;
  last_confirmed_ignition_at: string | null;
  pending_ignition: boolean | null;
  pending_since: string | null;
  pending_poll_count: number;
  active_trip_id: string | null;
  last_packet_time: string | null;
  last_speed: number;
  last_latitude: number | null;
  last_longitude: number | null;
  last_location_name: string | null;
  last_event_type: string | null;
  updated_at: string;
  version: number;
}

// ── Schema Management ──────────────────────────────────────────

let schemaReady = false;

export async function ensureVehicleStateSchema(): Promise<void> {
  if (schemaReady) return;
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gps_vehicle_state (
      vehicle_id UUID PRIMARY KEY,
      ignition_state TEXT NOT NULL DEFAULT 'OFF',
      last_confirmed_ignition BOOLEAN NOT NULL DEFAULT false,
      last_confirmed_ignition_at TIMESTAMPTZ,
      pending_ignition BOOLEAN,
      pending_since TIMESTAMPTZ,
      pending_poll_count INTEGER NOT NULL DEFAULT 0,
      active_trip_id UUID,
      last_packet_time TIMESTAMPTZ,
      last_speed DOUBLE PRECISION NOT NULL DEFAULT 0,
      last_latitude DOUBLE PRECISION,
      last_longitude DOUBLE PRECISION,
      last_location_name TEXT,
      last_event_type TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      version INTEGER NOT NULL DEFAULT 1
    );
  `);
  await pool.query(`
    ALTER TABLE gps_vehicle_state ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
  `);
  schemaReady = true;
}

// ── State Loading / Saving ─────────────────────────────────────

export async function loadVehicleState(vehicleId: string): Promise<VehicleState> {
  await ensureVehicleStateSchema();
  const pool = getPool();
  const result = await pool.query<VehicleStateDbRow>(
    `SELECT * FROM gps_vehicle_state WHERE vehicle_id = $1`,
    [vehicleId],
  );
  if (result.rows.length === 0) {
    return {
      vehicleId,
      ignitionState: 'OFF',
      lastConfirmedIgnition: false,
      lastConfirmedIgnitionAt: null,
      pendingIgnition: null,
      pendingSince: null,
      pendingPollCount: 0,
      activeTripId: null,
      lastPacketTime: null,
      lastSpeed: 0,
      lastLatitude: null,
      lastLongitude: null,
      lastLocationName: null,
      lastEventType: null,
      updatedAt: new Date().toISOString(),
      version: 0,
    };
  }
  const row = result.rows[0];
  return {
    vehicleId: row.vehicle_id,
    ignitionState: row.ignition_state as IgnitionState,
    lastConfirmedIgnition: row.last_confirmed_ignition,
    lastConfirmedIgnitionAt: row.last_confirmed_ignition_at,
    pendingIgnition: row.pending_ignition,
    pendingSince: row.pending_since,
    pendingPollCount: row.pending_poll_count,
    activeTripId: row.active_trip_id,
    lastPacketTime: row.last_packet_time,
    lastSpeed: row.last_speed,
    lastLatitude: row.last_latitude,
    lastLongitude: row.last_longitude,
    lastLocationName: row.last_location_name,
    lastEventType: row.last_event_type,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

// ── Long GPS Outage Recovery ──────────────────────────────────
//
// After a prolonged GPS outage (configurable via GPS_STATE_RESET_AFTER_HOURS),
// the vehicle state may no longer reflect reality. If the last confirmed
// ignition change is older than this threshold, the state machine treats
// the next packet as a fresh baseline rather than attempting to continue
// a potentially stale trip.
//
// Default: 6 hours. Set to 0 to disable this check.
export const GPS_STATE_RESET_AFTER_HOURS = Number(process.env.GPS_STATE_RESET_AFTER_HOURS || 6);

/**
 * Check if the vehicle state should be reset due to prolonged GPS outage.
 * Returns true if the last confirmed ignition timestamp is older than
 * GPS_STATE_RESET_AFTER_HOURS.
 */
export function isStateStaleAfterOutage(state: VehicleState): boolean {
  if (GPS_STATE_RESET_AFTER_HOURS <= 0) return false;
  if (!state.lastConfirmedIgnitionAt) return false;
  const stateAge = Date.now() - new Date(state.lastConfirmedIgnitionAt).getTime();
  return stateAge > GPS_STATE_RESET_AFTER_HOURS * 3600 * 1000;
}

/**
 * Get a fresh baseline state, discarding any previous trip state.
 * Used after prolonged GPS outages when the stored state is no longer
 * reliable.
 */
export function getFreshBaselineState(vehicleId: string): VehicleState {
  return {
    vehicleId,
    ignitionState: 'OFF',
    lastConfirmedIgnition: false,
    lastConfirmedIgnitionAt: null,
    pendingIgnition: null,
    pendingSince: null,
    pendingPollCount: 0,
    activeTripId: null,
    lastPacketTime: null,
    lastSpeed: 0,
    lastLatitude: null,
    lastLongitude: null,
    lastLocationName: null,
    lastEventType: null,
    updatedAt: new Date().toISOString(),
    version: 0,
  };
}

/**
 * Save vehicle state with optimistic concurrency.
 *
 * Pattern:
 *   1. UPDATE ... WHERE version = $N
 *   2. If 0 rows affected, RELOAD the latest state and RECOMPUTE
 *   3. Retry (up to MAX_RETRIES times)
 *
 * On conflict, the caller must decide: reload + recompute + retry, or abort.
 * This function NEVER silently overwrites a concurrent modification.
 */
const MAX_SAVE_RETRIES = 3;

export interface SaveVehicleStateResult {
  saved: boolean;
  latestState: VehicleState;
  retriesUsed: number;
}

export async function saveVehicleStateWithRetry(
  state: VehicleState,
  currentIgnition: boolean,
  now: string,
): Promise<SaveVehicleStateResult> {
  await ensureVehicleStateSchema();
  const pool = getPool();
  let currentState = state;
  let retries = 0;

  while (retries <= MAX_SAVE_RETRIES) {
    const result = await pool.query(
      `UPDATE gps_vehicle_state SET
         ignition_state = $2,
         last_confirmed_ignition = $3,
         last_confirmed_ignition_at = $4,
         pending_ignition = $5,
         pending_since = $6,
         pending_poll_count = $7,
         active_trip_id = $8,
         last_packet_time = $9,
         last_speed = $10,
         last_latitude = $11,
         last_longitude = $12,
         last_location_name = $13,
         last_event_type = $14,
         updated_at = now(),
         version = version + 1
       WHERE vehicle_id = $1 AND version = $15`,
      [
        currentState.vehicleId,
        currentState.ignitionState,
        currentState.lastConfirmedIgnition,
        currentState.lastConfirmedIgnitionAt,
        currentState.pendingIgnition,
        currentState.pendingSince,
        currentState.pendingPollCount,
        currentState.activeTripId,
        currentState.lastPacketTime,
        currentState.lastSpeed,
        currentState.lastLatitude,
        currentState.lastLongitude,
        currentState.lastLocationName,
        currentState.lastEventType,
        currentState.version,
      ],
    );

    if (result.rowCount && result.rowCount > 0) {
      return { saved: true, latestState: currentState, retriesUsed: retries };
    }

    // Row doesn't exist yet - INSERT it (idempotent, no version conflict)
    if (retries === 0 && currentState.version === 0) {
      try {
        await pool.query(
          `INSERT INTO gps_vehicle_state
             (vehicle_id, ignition_state, last_confirmed_ignition, last_confirmed_ignition_at,
              pending_ignition, pending_since, pending_poll_count, active_trip_id, last_packet_time,
              last_speed, last_latitude, last_longitude, last_location_name,
              last_event_type, updated_at, version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now(), 1)`,
          [
            currentState.vehicleId,
            currentState.ignitionState,
            currentState.lastConfirmedIgnition,
            currentState.lastConfirmedIgnitionAt,
            currentState.pendingIgnition,
            currentState.pendingSince,
            currentState.pendingPollCount,
            currentState.activeTripId,
            currentState.lastPacketTime,
            currentState.lastSpeed,
            currentState.lastLatitude,
            currentState.lastLongitude,
            currentState.lastLocationName,
            currentState.lastEventType,
          ],
        );
        return { saved: true, latestState: currentState, retriesUsed: 0 };
      } catch {
        // INSERT failed (race: another process created the row)
        // Fall through to retry with UPDATE
      }
    }

    // Version conflict: reload the latest state and recompute
    retries++;
    if (retries > MAX_SAVE_RETRIES) {
      console.warn(`[vehicle-state] SAVE FAILED after ${MAX_SAVE_RETRIES} retries for vehicle=${state.vehicleId} - version conflict`);
      const latest = await loadVehicleState(state.vehicleId);
      return { saved: false, latestState: latest, retriesUsed: retries };
    }

    // Reload and recompute
    const freshState = await loadVehicleState(state.vehicleId);
    console.log(`[vehicle-state] Version conflict vehicle=${state.vehicleId} local=${state.version} db=${freshState.version} retry=${retries}/${MAX_SAVE_RETRIES}`);

    // Re-process the ignition reading with the latest DB state
    const { newState } = processIgnitionReading(freshState, currentIgnition, now);
    newState.lastSpeed = state.lastSpeed;
    newState.lastLatitude = state.lastLatitude;
    newState.lastLongitude = state.lastLongitude;
    newState.lastLocationName = state.lastLocationName;
    newState.lastEventType = state.lastEventType;
    currentState = newState;
  }

  const latest = await loadVehicleState(state.vehicleId);
  return { saved: false, latestState: latest, retriesUsed: retries };
}

/**
 * Legacy save function (no retry, non-version-checking fallback).
 * Use saveVehicleStateWithRetry instead for all new code.
 * Kept for backward compatibility.
 */
export async function saveVehicleState(state: VehicleState): Promise<void> {
  await ensureVehicleStateSchema();
  const pool = getPool();
  await pool.query(
    `INSERT INTO gps_vehicle_state
       (vehicle_id, ignition_state, last_confirmed_ignition, last_confirmed_ignition_at,
        pending_ignition, pending_since, pending_poll_count, active_trip_id, last_packet_time,
        last_speed, last_latitude, last_longitude, last_location_name,
        last_event_type, updated_at, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now(), 1)
     ON CONFLICT (vehicle_id) DO UPDATE SET
       ignition_state = EXCLUDED.ignition_state,
       last_confirmed_ignition = EXCLUDED.last_confirmed_ignition,
       last_confirmed_ignition_at = EXCLUDED.last_confirmed_ignition_at,
       pending_ignition = EXCLUDED.pending_ignition,
       pending_since = EXCLUDED.pending_since,
       pending_poll_count = EXCLUDED.pending_poll_count,
       active_trip_id = EXCLUDED.active_trip_id,
       last_packet_time = EXCLUDED.last_packet_time,
       last_speed = EXCLUDED.last_speed,
       last_latitude = EXCLUDED.last_latitude,
       last_longitude = EXCLUDED.last_longitude,
       last_location_name = EXCLUDED.last_location_name,
       last_event_type = EXCLUDED.last_event_type,
       updated_at = now()`,
    [
      state.vehicleId,
      state.ignitionState,
      state.lastConfirmedIgnition,
      state.lastConfirmedIgnitionAt,
      state.pendingIgnition,
      state.pendingSince,
      state.pendingPollCount,
      state.activeTripId,
      state.lastPacketTime,
      state.lastSpeed,
      state.lastLatitude,
      state.lastLongitude,
      state.lastLocationName,
      state.lastEventType,
    ],
  );
}

// ── Ignition Transition Detection ──────────────────────────────
//
// Processes a raw ignition reading from the GPS tracker and
// returns what action (if any) should be taken.
//
// Confirmation is based on CONSECUTIVE POLL COUNT, not elapsed time.
// With default IGNITION_CONFIRMATION_POLLS=2, the state machine needs
// 2 consecutive identical readings before confirming a transition.
//
// Returns:
//   { transition: 'none' } - no state change
//   { transition: 'confirmed_on', tripId: string } - emit IGNITION_ON
//   { transition: 'confirmed_off', tripId: string } - emit IGNITION_OFF
//   { transition: 'pending_on' } - debounce in progress (poll 1/N)
//   { transition: 'pending_off' } - debounce in progress (poll 1/N)
//   { transition: 'glitch_suppressed' } - false transition ignored

export interface IgnitionTransitionResult {
  transition: 'none' | 'confirmed_on' | 'confirmed_off' | 'pending_on' | 'pending_off' | 'glitch_suppressed';
  tripId?: string;
  previousState?: IgnitionState;
  newState?: IgnitionState;
}

export function processIgnitionReading(
  state: VehicleState,
  currentIgnition: boolean,
  now: string,
): { newState: VehicleState; result: IgnitionTransitionResult } {
  const newState = { ...state };
  newState.lastPacketTime = now;

  // ── Pending confirmation/glitch handling comes first ───────
  // Pending states compare against the pending direction, not the
  // last confirmed ignition value. Otherwise PENDING_ON/PENDING_OFF
  // can never reach the confirmation threshold.
  if (state.ignitionState === 'PENDING_ON') {
    if (currentIgnition === true) {
      newState.pendingPollCount = state.pendingPollCount + 1;
      if (newState.pendingPollCount >= IGNITION_CONFIRMATION_POLLS) {
        newState.ignitionState = 'ON';
        newState.lastConfirmedIgnition = true;
        newState.lastConfirmedIgnitionAt = now;
        newState.pendingIgnition = null;
        newState.pendingSince = null;
        newState.pendingPollCount = 0;
        const tripId = randomUUID();
        newState.activeTripId = tripId;
        console.log(`[vehicle-state] IGNITION CONFIRMED ON vehicle=${state.vehicleId} polls=${newState.pendingPollCount}/${IGNITION_CONFIRMATION_POLLS} tripId=${tripId}`);
        return {
          newState,
          result: {
            transition: 'confirmed_on',
            tripId,
            previousState: state.ignitionState,
            newState: 'ON',
          },
        };
      }
      console.log(`[vehicle-state] Still debouncing IGNITION ON vehicle=${state.vehicleId} poll=${newState.pendingPollCount}/${IGNITION_CONFIRMATION_POLLS}`);
      return {
        newState,
        result: { transition: 'pending_on', previousState: state.ignitionState, newState: 'PENDING_ON' },
      };
    }

    newState.ignitionState = 'OFF';
    newState.lastConfirmedIgnition = false;
    newState.lastConfirmedIgnitionAt = now;
    newState.pendingIgnition = null;
    newState.pendingSince = null;
    newState.pendingPollCount = 0;
    newState.activeTripId = null;
    console.log(`[vehicle-state] Glitch suppressed: PENDING_ON→OFF vehicle=${state.vehicleId}`);
    return {
      newState,
      result: { transition: 'glitch_suppressed', previousState: state.ignitionState, newState: 'OFF' },
    };
  }

  if (state.ignitionState === 'PENDING_OFF') {
    if (currentIgnition === false) {
      newState.pendingPollCount = state.pendingPollCount + 1;
      if (newState.pendingPollCount >= IGNITION_CONFIRMATION_POLLS) {
        newState.ignitionState = 'OFF';
        newState.lastConfirmedIgnition = false;
        newState.lastConfirmedIgnitionAt = now;
        newState.pendingIgnition = null;
        newState.pendingSince = null;
        newState.pendingPollCount = 0;
        const closedTripId = state.activeTripId;
        newState.activeTripId = null;
        console.log(`[vehicle-state] IGNITION CONFIRMED OFF vehicle=${state.vehicleId} polls=${newState.pendingPollCount}/${IGNITION_CONFIRMATION_POLLS} closedTripId=${closedTripId}`);
        return {
          newState,
          result: {
            transition: 'confirmed_off',
            tripId: closedTripId ?? undefined,
            previousState: state.ignitionState,
            newState: 'OFF',
          },
        };
      }
      console.log(`[vehicle-state] Still debouncing IGNITION OFF vehicle=${state.vehicleId} poll=${newState.pendingPollCount}/${IGNITION_CONFIRMATION_POLLS}`);
      return {
        newState,
        result: { transition: 'pending_off', previousState: state.ignitionState, newState: 'PENDING_OFF' },
      };
    }

    newState.ignitionState = 'ON';
    newState.lastConfirmedIgnition = true;
    newState.lastConfirmedIgnitionAt = now;
    newState.pendingIgnition = null;
    newState.pendingSince = null;
    newState.pendingPollCount = 0;
    console.log(`[vehicle-state] Glitch suppressed: PENDING_OFF→ON vehicle=${state.vehicleId} tripId=${state.activeTripId}`);
    return {
      newState,
      result: { transition: 'glitch_suppressed', previousState: state.ignitionState, newState: 'ON' },
    };
  }

  // ── No change: same as last confirmed ignition ──────────────
  if (currentIgnition === state.lastConfirmedIgnition) {
    // Stable state, no transition
    return { newState, result: { transition: 'none' } };
  }

  // ── Ignition changed from last confirmed state ──────────────

  if (currentIgnition === true && state.lastConfirmedIgnition === false) {
    // OFF → ON transition detected
    // Start debouncing ON (poll 1/2)
    newState.ignitionState = 'PENDING_ON';
    newState.pendingIgnition = true;
    newState.pendingSince = now;
    newState.pendingPollCount = 1;
    console.log(`[vehicle-state] PENDING ON vehicle=${state.vehicleId} poll=1/${IGNITION_CONFIRMATION_POLLS}`);
    return {
      newState,
      result: { transition: 'pending_on', previousState: state.ignitionState, newState: 'PENDING_ON' },
    };
  }

  if (currentIgnition === false && state.lastConfirmedIgnition === true) {
    // ON → OFF transition detected
    // Start debouncing OFF (poll 1/2)
    newState.ignitionState = 'PENDING_OFF';
    newState.pendingIgnition = false;
    newState.pendingSince = now;
    newState.pendingPollCount = 1;
    console.log(`[vehicle-state] PENDING OFF vehicle=${state.vehicleId} poll=1/${IGNITION_CONFIRMATION_POLLS}`);
    return {
      newState,
      result: { transition: 'pending_off', previousState: state.ignitionState, newState: 'PENDING_OFF' },
    };
  }

  return { newState, result: { transition: 'none' } };
}

// ── Duplicate Detection ────────────────────────────────────────
//
// Check if an identical ignition event was already saved within
// the duplicate window. Uses the GPS PACKET timestamp (recorded_at),
// NOT database NOW(), to avoid clock drift issues.
//
// If the packet timestamp is older than last processed timestamp,
// it's a stale/out-of-order packet and should be ignored.

export async function hasRecentIgnitionEvent(
  vehicleId: string,
  eventType: string,
  ignition: boolean,
  packetRecordedAt: string,
): Promise<boolean> {
  const pool = getPool();
  const windowSeconds = IGNITION_DUPLICATE_WINDOW_SECONDS;
  // Use packet timestamp for dedup, not DB insertion time
  const result = await pool.query(
    `SELECT 1 FROM gps_telemetry
     WHERE vehicle_id = $1
       AND event_type = $2
       AND ignition = $3
       AND recorded_at >= $4::timestamptz - INTERVAL '1 second' * $5
       AND recorded_at <= $4::timestamptz + INTERVAL '1 second' * 5
     LIMIT 1`,
    [vehicleId, eventType, ignition, packetRecordedAt, windowSeconds],
  );
  return result.rows.length > 0;
}

// ── Stale/Out-of-Order Packet Detection ───────────────────────
//
// Some GPS devices resend old packets. Skip packets whose timestamp
// is older than the last processed packet for this vehicle.

export function isStalePacket(
  state: VehicleState,
  packetRecordedAt: string,
): boolean {
  if (!state.lastPacketTime) return false;
  const packetTime = new Date(packetRecordedAt).getTime();
  const lastTime = new Date(state.lastPacketTime).getTime();
  if (Number.isNaN(packetTime) || Number.isNaN(lastTime)) return false;
  // Packet is stale if its timestamp is more than tolerance older
  // than the last processed packet.
  const tolerance = Number(process.env.GPS_STALE_PACKET_TOLERANCE_SECONDS || 5);
  return packetTime < lastTime - tolerance * 1000;
}

// ── Active Trip Check ──────────────────────────────────────────
//
// Check if there's an existing active trip for this vehicle.
// Returns the activeTripId if found, null otherwise.

export async function findExistingActiveTrip(vehicleId: string): Promise<string | null> {
  const pool = getPool();
  const result = await pool.query<{ active_trip_id: string }>(
    `SELECT active_trip_id FROM gps_telemetry
     WHERE vehicle_id = $1
       AND active_trip_id IS NOT NULL
       AND event_type != 'IGNITION_OFF'
     ORDER BY recorded_at DESC
     LIMIT 1`,
    [vehicleId],
  );
  return result.rows[0]?.active_trip_id ?? null;
}

// ── Reset State ────────────────────────────────────────────────

export async function resetVehicleState(vehicleId: string): Promise<void> {
  await ensureVehicleStateSchema();
  const pool = getPool();
  await pool.query(
    `DELETE FROM gps_vehicle_state WHERE vehicle_id = $1`,
    [vehicleId],
  );
  console.log(`[vehicle-state] Reset state for vehicle=${vehicleId}`);
}

export async function upsertVehicleState(params: {
  vehicleId: string;
  ignitionState: 'ON' | 'OFF';
  lastConfirmedIgnition: boolean;
  lastConfirmedIgnitionAt: string | null;
  activeTripId: string | null;
  lastPacketTime: string;
  lastSpeed: number;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastLocationName: string | null;
  lastEventType: string;
}): Promise<void> {
  await ensureVehicleStateSchema();
  const pool = getPool();
  await pool.query(
    `INSERT INTO gps_vehicle_state
       (vehicle_id, ignition_state, last_confirmed_ignition, last_confirmed_ignition_at,
        active_trip_id, last_packet_time, last_speed, last_latitude, last_longitude,
        last_location_name, last_event_type, updated_at, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), 1)
     ON CONFLICT (vehicle_id) DO UPDATE SET
       ignition_state = EXCLUDED.ignition_state,
       last_confirmed_ignition = EXCLUDED.last_confirmed_ignition,
       last_confirmed_ignition_at = EXCLUDED.last_confirmed_ignition_at,
       active_trip_id = EXCLUDED.active_trip_id,
       last_packet_time = EXCLUDED.last_packet_time,
       last_speed = EXCLUDED.last_speed,
       last_latitude = EXCLUDED.last_latitude,
       last_longitude = EXCLUDED.last_longitude,
       last_location_name = EXCLUDED.last_location_name,
       last_event_type = EXCLUDED.last_event_type,
       updated_at = now(),
       version = gps_vehicle_state.version + 1`,
    [
      params.vehicleId,
      params.ignitionState,
      params.lastConfirmedIgnition,
      params.lastConfirmedIgnitionAt,
      params.activeTripId,
      params.lastPacketTime,
      params.lastSpeed,
      params.lastLatitude,
      params.lastLongitude,
      params.lastLocationName,
      params.lastEventType,
    ],
  );
}

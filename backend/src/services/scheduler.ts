// ── Fleet Sync Scheduler ───────────────────────────────────────
//
// Runs the fleet telemetry sync (Cartrack fetch → alert dispatch →
// GPS log persistence) on a configurable interval.
//
// The scheduler automatically starts when the backend boots up
// and runs syncFleetAndAlert() every SYNC_INTERVAL_SECONDS.
//
// The interval can be changed at runtime via updateInterval().

import { randomUUID } from 'node:crypto';
import {
  syncFleetAndAlert,
  sendTelegram,
  getVehicleEmoji,
  formatIgnitionAlert,
  formatVehicleHeader,
  formatIdlingTooLongAlert,
  IDLE_ALERT_THRESHOLDS_MINUTES,
} from '@car-tracker/tracker';
import { findVehicleByPlate, syncGpsTripLogsFromTelemetry } from './gpsLogService.js';
import { syncNoToLogsFromTelemetry } from './noToLifecycleService.js';
import { insertTelemetry, getLatestTelemetry, updateTelemetryTelegramDelivery, updateTelemetryTelegramMessage } from './gpsTelemetryService.js';
import { getPool } from '../db/db.js';
import { SYNC_INTERVAL_SECONDS } from '../config/env.js';
import { getFleetConfig } from './fleetConfigService.js';
import {
  getActiveTripTravelOrderOverrides,
  syncApprovedTravelOrdersToActiveTrips,
  syncUnlinkedGpsTripLogsToTravelOrders,
} from './travelOrderSyncService.js';

// ── Scheduler State ────────────────────────────────────────────

interface SchedulerState {
  running: boolean;
  startedAt: string | null;
  lastRunAt: string | null;
  lastRunDuration: number | null; // seconds
  lastResult: string | null;
  cyclesCompleted: number;
  errors: number;
  intervalId: ReturnType<typeof setInterval> | null;
  paused: boolean;
  intervalSeconds: number;
}

export interface SchedulerCycleSummary {
  skipped: boolean;
  skipReason: string | null;
  vehiclesProcessed: number;
  telemetrySaved: number;
  telemetrySkipped: number;
  telegramSent: number;
  telegramFailed: number;
  alertsSent: number;
  alertsSkipped: number;
  alertsFailed: number;
  alertsPersisted: number;
  gpsLogsSaved: number;
  gpsLogsFailed: number;
  travelOrdersMatched: number;
  unauthorizedTravelAlerts: number;
  durationSeconds: number;
  fleetConfigVersion: string;
}

// ── Mutable current interval (initialised from env, but can be
// changed at runtime via updateInterval()) ──────────────────────

let currentIntervalSeconds = SYNC_INTERVAL_SECONDS;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const state: SchedulerState = {
  running: false,
  startedAt: null,
  lastRunAt: null,
  lastRunDuration: null,
  lastResult: null,
  cyclesCompleted: 0,
  errors: 0,
  intervalId: null,
  paused: false,
  intervalSeconds: currentIntervalSeconds,
};

// Mutex to prevent overlapping cycle executions
let cycleLock = false;

// ── Event Type Constants ───────────────────────────────────────
// Must match the event_type values saved in gps_telemetry.
// These are the canonical event types used across the entire pipeline.

const EVENT_TYPE = {
  IGNITION_ON: 'IGNITION_ON',
  IGNITION_OFF: 'IGNITION_OFF',
  LOCATION_UPDATE: 'LOCATION_UPDATE',
  IDLING: 'IDLING_TOO_LONG',
  MOTION_STARTED: 'MOTION_STARTED',
  SPEEDING: 'SPEEDING',
  LOW_FUEL: 'LOW_FUEL',
  NO_APPROVED_TRAVEL_ORDER: 'NO_APPROVED_TRAVEL_ORDER',
} as const;

type PreviousMotionState = {
  speedKmh: number;
  eventType: string;
} | null | undefined;

type ActiveIdlingState = {
  activeTripId: string;
} | null | undefined;

export function idlingMilestoneForMinutes(idleMinutes: number): number | null {
  const reached = IDLE_ALERT_THRESHOLDS_MINUTES.filter((threshold) => idleMinutes >= threshold);
  return reached.length ? reached[reached.length - 1] : null;
}

function canonicalEventType(sourceEventType: string): string | null {
  let result: string | null;
  switch (sourceEventType) {
    case 'IGNITION ON ALERT':
    case 'IGNITION_ON':
      result = EVENT_TYPE.IGNITION_ON;
      break;
    case 'IGNITION OFF ALERT':
    case 'IGNITION_OFF':
      result = EVENT_TYPE.IGNITION_OFF;
      break;
    case 'LOCATION UPDATE ALERT':
    case 'LOCATION UPDATE':
    case 'LOCATION_UPDATE':
      result = EVENT_TYPE.LOCATION_UPDATE;
      break;
    case 'IDLING ALERT':
    case 'IDLING TOO LONG ALERT':
    case 'IDLING':
    case 'IDLING_TOO_LONG':
      result = EVENT_TYPE.IDLING;
      break;
    case 'MOVING ALERT':
    case 'MOTION_STARTED':
      result = EVENT_TYPE.MOTION_STARTED;
      break;
    case 'SPEEDING ALERT':
    case 'SPEEDING':
      result = EVENT_TYPE.SPEEDING;
      break;
    case 'LOW FUEL ALERT':
    case 'LOW_FUEL':
      result = EVENT_TYPE.LOW_FUEL;
      break;
    case 'NO_APPROVED_TRAVEL_ORDER':
      result = EVENT_TYPE.NO_APPROVED_TRAVEL_ORDER;
      break;
    default:
      result = null;
      break;
  }
  if (sourceEventType !== result) {
    console.log('[EVENT NORMALIZED]', { incoming: sourceEventType, saved: result });
  }
  return result;
}

export function shouldPersistMotionStartedFromPreviousState(
  previous: PreviousMotionState,
  activeIdlingSession: ActiveIdlingState,
  currentSpeedKmh: number,
  currentIgnition: boolean,
): boolean {
  if (!currentIgnition || currentSpeedKmh <= 0) return false;

  const previousEventType = previous?.eventType ? canonicalEventType(previous.eventType) ?? previous.eventType : null;
  const previousSpeed = Number(previous?.speedKmh ?? 0);

  if (
    previousEventType === EVENT_TYPE.MOTION_STARTED ||
    (previousEventType === EVENT_TYPE.LOCATION_UPDATE && previousSpeed > 0)
  ) {
    return false;
  }

  return previousSpeed <= 0 ||
    previousEventType === EVENT_TYPE.IDLING ||
    previousEventType === 'IDLING' ||
    previousEventType === EVENT_TYPE.IGNITION_ON ||
    Boolean(activeIdlingSession?.activeTripId);
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Get a snapshot of the current scheduler state.
 */
export function getSchedulerState(): Readonly<Omit<SchedulerState, 'intervalId'>> {
  return {
    running: state.running,
    startedAt: state.startedAt,
    lastRunAt: state.lastRunAt,
    lastRunDuration: state.lastRunDuration,
    lastResult: state.lastResult,
    cyclesCompleted: state.cyclesCompleted,
    errors: state.errors,
    paused: state.paused,
    intervalSeconds: currentIntervalSeconds,
  };
}

/**
 * Update the scheduler interval at runtime. Stops the current
 * scheduler and restarts it with the new interval.
 */
export function updateInterval(seconds: number): void {
  const clamped = Math.max(seconds, 10);
  currentIntervalSeconds = clamped;

  if (!state.intervalId) {
    // Not running – just update the stored value
    console.log(`[scheduler] Interval updated to ${clamped}s (not running)`);
    return;
  }

  console.log(`[scheduler] Restarting with new interval ${clamped}s…`);
  clearInterval(state.intervalId);
  state.intervalId = null;

  const intervalMs = clamped * 1000;
  state.intervalId = setInterval(runCycle, intervalMs);

  console.log(`[scheduler] Interval changed to ${clamped}s`);
}

/**
 * Start the scheduler. If already running, this is a no-op.
 * The scheduler will run syncFleetAndAlert() every `currentIntervalSeconds`.
 */
export function startScheduler(): void {
  if (state.intervalId) {
    console.log('[scheduler] Already running — skipping start');
    return;
  }

  if (currentIntervalSeconds < 10) {
    console.warn(
      `[scheduler] currentIntervalSeconds (${currentIntervalSeconds}) is too low; clamping to 10s`,
    );
  }

  const intervalMs = Math.max(currentIntervalSeconds, 10) * 1000;

  state.running = true;
  state.startedAt = new Date().toISOString();
  state.paused = false;

  console.log(
    `[scheduler] Starting fleet sync every ${Math.max(currentIntervalSeconds, 10)}s`,
  );

  // Run immediately on start, then on interval
  void runCycle();

  state.intervalId = setInterval(runCycle, intervalMs);
}

/**
 * Stop the scheduler.
 */
export function stopScheduler(): void {
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
  state.running = false;
  state.paused = false;
  console.log('[scheduler] Stopped');
}

/**
 * Pause the scheduler temporarily (e.g. during maintenance).
 */
export function pauseScheduler(): void {
  state.paused = true;
  console.log('[scheduler] Paused');
}

/**
 * Resume the scheduler after pause.
 */
export function resumeScheduler(): void {
  state.paused = false;
  console.log('[scheduler] Resumed');
}

/**
 * Export runCycle so it can be called directly by the
 * cron-job.org endpoint (/api/cron/sync-tracker) without duplicating logic.
 */
export { runCycle };

// ── Internal ───────────────────────────────────────────────────

function haversineDistanceMeters(
  lat1: number | null, lng1: number | null,
  lat2: number | null, lng2: number | null,
): number | null {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ── Cross-cycle idling milestone deduplication (DB-backed) ────
// Tracks which idling milestones have been persisted per vehicle
// across scheduler runs. Persisted milestones are stored in a
// dedicated database table (gps_idling_dedup) so they survive
// restarts and are shared across cycles.
// Composite key: vehicle_id + active_trip_id + threshold_minutes
let idlingSchemaReady = false;

async function ensureIdlingDedupSchema(): Promise<void> {
  if (idlingSchemaReady) return;
  const pool = getPool();
  await pool.query(`
    ALTER TABLE gps_idling_dedup
      ALTER COLUMN threshold_minutes DROP NOT NULL;

    ALTER TABLE gps_idling_dedup
      ADD COLUMN IF NOT EXISTS idling_started_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_alerted_duration_minutes INTEGER,
      ADD COLUMN IF NOT EXISTS last_alerted_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

    UPDATE gps_idling_dedup
       SET idling_started_at = COALESCE(idling_started_at, created_at),
           last_alerted_duration_minutes = COALESCE(last_alerted_duration_minutes, threshold_minutes),
           last_alerted_at = COALESCE(last_alerted_at, created_at),
           is_active = COALESCE(is_active, true)
     WHERE idling_started_at IS NULL
        OR last_alerted_duration_minutes IS NULL
        OR last_alerted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_gps_idling_dedup_active_trip
      ON gps_idling_dedup (vehicle_id, active_trip_id, is_active);
  `);
  idlingSchemaReady = true;
}

async function getActiveIdlingDedupDb(vehicleId: string, activeTripId: string): Promise<{
  idlingStartedAt: string | null;
  lastAlertedDurationMinutes: number | null;
} | null> {
  await ensureIdlingDedupSchema();
  const pool = getPool();
  const result = await pool.query<{ idling_started_at: string | null; last_alerted_duration_minutes: number | null }>(
    `SELECT idling_started_at, last_alerted_duration_minutes
       FROM gps_idling_dedup
     WHERE vehicle_id = $1
       AND active_trip_id = $2
       AND is_active = true
     ORDER BY COALESCE(last_alerted_duration_minutes, threshold_minutes, 0) DESC, created_at DESC
     LIMIT 1`,
    [vehicleId, activeTripId],
  );
  const row = result.rows[0];
  return row ? {
    idlingStartedAt: row.idling_started_at,
    lastAlertedDurationMinutes: row.last_alerted_duration_minutes,
  } : null;
}

export async function shouldPersistIdlingAlertDb(vehicleId: string, activeTripId: string, thresholdMinutes: number): Promise<boolean> {
  const stateRow = await getActiveIdlingDedupDb(vehicleId, activeTripId);
  return Number(stateRow?.lastAlertedDurationMinutes ?? 0) < thresholdMinutes;
}

async function getActiveIdlingSessionForVehicle(vehicleId: string): Promise<{
  activeTripId: string;
  idlingStartedAt: string | null;
  lastAlertedDurationMinutes: number | null;
} | null> {
  await ensureIdlingDedupSchema();
  const pool = getPool();
  const result = await pool.query<{ active_trip_id: string; idling_started_at: string | null; last_alerted_duration_minutes: number | null }>(
    `SELECT active_trip_id, idling_started_at, last_alerted_duration_minutes
       FROM gps_idling_dedup
      WHERE vehicle_id = $1
        AND is_active = true
      ORDER BY COALESCE(last_alerted_at, idling_started_at, created_at) DESC
      LIMIT 1`,
    [vehicleId],
  );
  const row = result.rows[0];
  return row ? {
    activeTripId: row.active_trip_id,
    idlingStartedAt: row.idling_started_at,
    lastAlertedDurationMinutes: row.last_alerted_duration_minutes,
  } : null;
}

async function markIdlingAlertDb(vehicleId: string, activeTripId: string, idlingStartedAt: string, thresholdMinutes: number): Promise<void> {
  await ensureIdlingDedupSchema();
  const pool = getPool();
  // Only update the alert timestamp and threshold, NEVER update idling_started_at
  // The idling_started_at marks when idling began and should persist until the trip ends
  const updated = await pool.query(
    `UPDATE gps_idling_dedup
        SET last_alerted_duration_minutes = $4,
            last_alerted_at = now(),
            is_active = true
      WHERE vehicle_id = $1
        AND active_trip_id = $2
        AND is_active = true`,
    [vehicleId, activeTripId, idlingStartedAt, thresholdMinutes],
  );
  if ((updated.rowCount ?? 0) > 0) {
    console.log(`[idling-dedup] Updated existing record vehicle=${vehicleId} trip=${activeTripId} threshold=${thresholdMinutes}min`);
    return;
  }

  // Insert new record preserving the original idling_started_at
  await pool.query(
    `INSERT INTO gps_idling_dedup
       (vehicle_id, active_trip_id, threshold_minutes, idling_started_at, last_alerted_duration_minutes, last_alerted_at, is_active)
     VALUES ($1, $2, $3, $4, $3, now(), true)
     ON CONFLICT DO NOTHING`,
    [vehicleId, activeTripId, thresholdMinutes, idlingStartedAt],
  );
  console.log(`[idling-dedup] Inserted new record vehicle=${vehicleId} trip=${activeTripId} threshold=${thresholdMinutes}min`);
}

export async function closeIdlingDedupDb(vehicleId: string, activeTripId?: string | null): Promise<void> {
  await ensureIdlingDedupSchema();
  const pool = getPool();
  if (activeTripId) {
    await pool.query(
      `UPDATE gps_idling_dedup
          SET is_active = false,
              ended_at = now()
        WHERE vehicle_id = $1
          AND active_trip_id = $2
          AND is_active = true`,
      [vehicleId, activeTripId],
    );
    console.log(`[idling-dedup] Closed idling session vehicle=${vehicleId} trip=${activeTripId}`);
    return;
  }
  await pool.query(
    `UPDATE gps_idling_dedup
        SET is_active = false,
            ended_at = now()
      WHERE vehicle_id = $1
        AND is_active = true`,
    [vehicleId],
  );
  console.log(`[idling-dedup] Closed all idling sessions for vehicle=${vehicleId}`);
}

// ── Helper: Get latest active_trip_id for a vehicle ────────────
// Returns the activeTripId from the latest telemetry record, or null.
async function getLatestActiveTripId(vehicleId: string): Promise<string | null> {
  const pool = getPool();
  const result = await pool.query<{ active_trip_id: string | null }>(
    `SELECT active_trip_id FROM gps_telemetry
     WHERE vehicle_id = $1
       AND active_trip_id IS NOT NULL
     ORDER BY recorded_at DESC
     LIMIT 1`,
    [vehicleId],
  );
  return result.rows[0]?.active_trip_id ?? null;
}

// ── Unified Alert Pipeline ─────────────────────────────────────
//
// All alert types (LOCATION_UPDATE, IDLING_TOO_LONG, MOTION_STARTED,
// IGNITION_ON, IGNITION_OFF, SPEEDING, LOW_FUEL) use this single
// function to persist telemetry and send Telegram notifications.

interface SaveAndSendTelemetryAlertParams {
  eventType: string;
  vehicleId: string;
  plateNumber: string;
  activeTripId: string | null;
  latitude: number | null;
  longitude: number | null;
  speedKmh: number;
  fuelLiters: number | null;
  ignition: boolean;
  locationName: string | null;
  recordedAt: string;
  telegramMessage: string | null;
  allowDuplicate?: boolean;
}

interface SaveAndSendTelemetryAlertResult {
  savedTelemetry: { inserted: boolean; updated: boolean; id: string | null };
  telegramSent: boolean;
  telegramError: string | null;
}

async function saveAndSendTelemetryAlert(params: SaveAndSendTelemetryAlertParams): Promise<SaveAndSendTelemetryAlertResult> {
  const { eventType, vehicleId, plateNumber, activeTripId, latitude, longitude, speedKmh, fuelLiters, ignition, locationName, recordedAt, telegramMessage } = params;

  console.log(`[alert-pipeline] attempt ${eventType} ${plateNumber} ${activeTripId}`);

  const savedTelemetry = await insertTelemetry({
    vehicleId,
    plateNumber,
    eventType,
    latitude,
    longitude,
    speedKmh,
    fuelLiters,
    ignition,
    locationName,
    driverId: null,
    toNumber: null,
    recordedAt,
    activeTripId,
    telegramMessage,
  });

  if (!savedTelemetry.id) {
    console.log(`[alert-pipeline] saved ${eventType} null inserted=${savedTelemetry.inserted} updated=${savedTelemetry.updated} skippedReason=missing_id`);
    return { savedTelemetry, telegramSent: false, telegramError: 'missing_id' };
  }

  // Log the result
  const action = savedTelemetry.inserted ? 'inserted' : savedTelemetry.updated ? 'updated' : 'skipped';
  console.log(`[alert-pipeline] saved ${eventType} ${savedTelemetry.id} inserted=${savedTelemetry.inserted} updated=${savedTelemetry.updated} skippedReason=${action === 'skipped' ? 'duplicate' : 'none'}`);

  // Send Telegram whenever savedTelemetry.id exists and telegramMessage is provided
  let telegramSent = false;
  let telegramError: string | null = null;

  if (telegramMessage) {
    console.log(`[alert-pipeline] telegram attempt ${eventType} ${savedTelemetry.id}`);
    try {
      const tg = await sendTelegram(telegramMessage);
      const attemptedAt = new Date().toISOString();
      if (tg?.ok) {
        telegramSent = true;
        await updateTelemetryTelegramDelivery(savedTelemetry.id, 'sent', null, attemptedAt);
        console.log(`[alert-pipeline] telegram result ${eventType} ok sent`);
      } else {
        telegramError = tg?.error ?? 'telegram_not_ok';
        await updateTelemetryTelegramDelivery(savedTelemetry.id, 'failed', telegramError, attemptedAt);
        console.error(`[alert-pipeline] telegram result ${eventType} fail ${telegramError}`);
      }
    } catch (err) {
      const attemptedAt = new Date().toISOString();
      telegramError = errorMessage(err);
      await updateTelemetryTelegramDelivery(savedTelemetry.id, 'failed', telegramError, attemptedAt);
      console.error(`[alert-pipeline] telegram result ${eventType} exception ${telegramError}`);
    }
  } else {
    await updateTelemetryTelegramDelivery(savedTelemetry.id, 'skipped', null, new Date().toISOString());
    console.log(`[alert-pipeline] telegram skipped ${eventType} ${savedTelemetry.id} reason=no_message`);
  }

  return { savedTelemetry, telegramSent, telegramError };
}

// ── Helper: Check whether an ignition boundary event already exists for a trip ──
async function telemetryTripEventExists(
  vehicleId: string,
  activeTripId: string,
  eventType: string,
): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT 1
       FROM gps_telemetry
      WHERE vehicle_id = $1
        AND active_trip_id = $2
        AND event_type = $3
      LIMIT 1`,
    [vehicleId, activeTripId, eventType],
  );
  return result.rows.length > 0;
}

async function getLatestCanonicalTripEventType(
  vehicleId: string,
  activeTripId: string,
): Promise<string | null> {
  const pool = getPool();
  const result = await pool.query<{ event_type: string }>(
    `SELECT CASE trim(event_type)
        WHEN 'IGNITION ON' THEN 'IGNITION_ON'
        WHEN 'IGNITION ON ALERT' THEN 'IGNITION_ON'
        WHEN 'IGNITION_ON' THEN 'IGNITION_ON'
        WHEN 'IGNITION OFF' THEN 'IGNITION_OFF'
        WHEN 'IGNITION OFF ALERT' THEN 'IGNITION_OFF'
        WHEN 'IGNITION_OFF' THEN 'IGNITION_OFF'
        WHEN 'LOCATION UPDATE' THEN 'LOCATION_UPDATE'
        WHEN 'LOCATION UPDATE ALERT' THEN 'LOCATION_UPDATE'
        WHEN 'LOCATION_UPDATE' THEN 'LOCATION_UPDATE'
        WHEN 'MOVING ALERT' THEN 'MOTION_STARTED'
        WHEN 'MOTION_STARTED' THEN 'MOTION_STARTED'
        WHEN 'IDLING ALERT' THEN 'IDLING'
        WHEN 'IDLING TOO LONG ALERT' THEN 'IDLING'
        WHEN 'IDLING_TOO_LONG' THEN 'IDLING'
        WHEN 'IDLING' THEN 'IDLING'
        ELSE trim(event_type)
      END AS event_type
       FROM gps_telemetry
      WHERE vehicle_id = $1
        AND active_trip_id = $2
      ORDER BY recorded_at DESC
      LIMIT 1`,
    [vehicleId, activeTripId],
  );
  return result.rows[0]?.event_type ?? null;
}

async function getLatestTelemetryForTrip(
  vehicleId: string,
  activeTripId: string,
): Promise<{ eventType: string; speedKmh: number } | null> {
  const pool = getPool();
  const result = await pool.query<{ event_type: string; speed_kmh: number }>(
    `SELECT event_type, speed_kmh
       FROM gps_telemetry
      WHERE vehicle_id = $1
        AND active_trip_id = $2
      ORDER BY recorded_at DESC, created_at DESC
      LIMIT 1`,
    [vehicleId, activeTripId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    eventType: row.event_type,
    speedKmh: Number(row.speed_kmh ?? 0),
  };
}

async function getLatestMovingTelemetryTimestamp(vehicleId: string, activeTripId: string): Promise<string | null> {
  const pool = getPool();
  const result = await pool.query<{ recorded_at: string }>(
    `SELECT recorded_at
       FROM gps_telemetry
      WHERE vehicle_id = $1
        AND active_trip_id = $2
        AND ignition = true
        AND speed_kmh > 0
      ORDER BY recorded_at DESC, created_at DESC
      LIMIT 1`,
    [vehicleId, activeTripId],
  );
  return result.rows[0]?.recorded_at ?? null;
}

// ── Helper: Get latest LOCATION_UPDATE for same vehicle_id + active_trip_id ──
// Returns the location_name of the most recent LOCATION_UPDATE, or null.
async function getLatestLocationUpdateLocation(vehicleId: string, activeTripId: string | null): Promise<string | null> {
  const pool = getPool();
  const result = await pool.query<{ location_name: string | null }>(
    `SELECT location_name
       FROM gps_telemetry
      WHERE vehicle_id = $1
        AND active_trip_id IS NOT DISTINCT FROM $2
        AND event_type = 'LOCATION_UPDATE'
      ORDER BY recorded_at DESC, created_at DESC
      LIMIT 1`,
    [vehicleId, activeTripId],
  );
  return result.rows[0]?.location_name ?? null;
}

// ── Arrival Detection ──────────────────────────────────────────
// Compares current GPS position against the next pending destination.
// Uses FLEET_CONFIG.arrival for radius and idle thresholds.

interface NextPendingDestination {
  id: string;
  travelOrderId: string;
  stopOrder: number;
  locationName: string;
  latLong: string | null;
}

/**
 * Find the next pending destination for a travel order.
 * Returns the first destination with status = 'PENDING' ordered by stop_order.
 */
async function findNextPendingDestination(travelOrderId: string): Promise<NextPendingDestination | null> {
  const pool = getPool();
  const result = await pool.query<{ id: string; travel_order_id: string; stop_order: number; location_name: string; lat_long: string | null }>(
    `SELECT id, travel_order_id, stop_order, location_name, lat_long
     FROM travel_order_destinations
     WHERE travel_order_id = $1
       AND status = 'PENDING'
     ORDER BY stop_order ASC
     LIMIT 1`,
    [travelOrderId],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    travelOrderId: row.travel_order_id,
    stopOrder: row.stop_order,
    locationName: row.location_name,
    latLong: row.lat_long,
  };
}

/**
 * Mark a destination as ARRIVED and advance the next destination to IN_PROGRESS.
 * Also updates the travel_orders row with the last destination info for backward compatibility.
 */
async function markDestinationArrived(
  destinationId: string,
  travelOrderId: string,
  distanceMeters: number,
  gpsTripLogId?: string | null,
): Promise<void> {
  const pool = getPool();
  const now = new Date().toISOString();

  // Mark current destination as ARRIVED
  await pool.query(
    `UPDATE travel_order_destinations
        SET status = 'ARRIVED',
            arrived_at = $2,
            arrival_distance_meters = $3,
            gps_trip_log_id = COALESCE($4, gps_trip_log_id)
      WHERE id = $1`,
    [destinationId, now, distanceMeters, gpsTripLogId],
  );

  // Find the next pending destination and set it to IN_PROGRESS
  const nextResult = await pool.query<{ id: string; stop_order: number }>(
    `SELECT id, stop_order
     FROM travel_order_destinations
     WHERE travel_order_id = $1
       AND status = 'PENDING'
     ORDER BY stop_order ASC
     LIMIT 1`,
    [travelOrderId],
  );

  if (nextResult.rows.length > 0) {
    // There's a next destination — set it to IN_PROGRESS
    await pool.query(
      `UPDATE travel_order_destinations
          SET status = 'IN_PROGRESS'
        WHERE id = $1`,
      [nextResult.rows[0].id],
    );
    console.log(`[arrival] Advanced to next destination id=${nextResult.rows[0].id} stop=${nextResult.rows[0].stop_order} for travel_order=${travelOrderId}`);
  } else {
    // No more pending destinations — all stops completed
    // Update travel_orders to COMPLETED
    await pool.query(
      `UPDATE travel_orders
          SET status = 'COMPLETED',
              actual_arrival_at = $2,
              updated_at = $2
        WHERE id = $1`,
      [travelOrderId, now],
    );
    console.log(`[arrival] All destinations completed for travel_order=${travelOrderId} — marked as COMPLETED`);
  }

  // Update backward-compat columns on travel_orders with the last ARRIVED destination
  const lastArrived = await pool.query<{ location_name: string; lat_long: string | null }>(
    `SELECT location_name, lat_long
     FROM travel_order_destinations
     WHERE travel_order_id = $1
       AND status = 'ARRIVED'
     ORDER BY stop_order DESC
     LIMIT 1`,
    [travelOrderId],
  );
  if (lastArrived.rows.length > 0) {
    await pool.query(
      `UPDATE travel_orders
          SET destination_target = $2,
              location_name = $2,
              lat_long_destination = $3
        WHERE id = $1`,
      [travelOrderId, lastArrived.rows[0].location_name, lastArrived.rows[0].lat_long],
    );
  }
}

/**
 * Check if a vehicle has arrived at its next pending destination.
 * Called during each scheduler cycle for vehicles with active travel orders.
 */
async function checkArrival(
  vehicleId: string,
  travelOrderId: string,
  latitude: number | null,
  longitude: number | null,
  speedKmh: number,
  currentIgnition: boolean,
  elapsedIdleMinutes: number,
): Promise<{ arrived: boolean; destinationId: string | null; distanceMeters: number | null }> {
  // Only check arrival if vehicle is idling (speed <= 0, ignition on)
  if (!currentIgnition || speedKmh > 0) {
    return { arrived: false, destinationId: null, distanceMeters: null };
  }

  // Must be idling for at least FLEET_CONFIG.arrival.idleMinutes
  if (elapsedIdleMinutes < getFleetConfig().arrival.idleMinutes) {
    return { arrived: false, destinationId: null, distanceMeters: null };
  }

  // Find the next pending destination
  const nextDest = await findNextPendingDestination(travelOrderId);
  if (!nextDest || !nextDest.latLong) {
    return { arrived: false, destinationId: null, distanceMeters: null };
  }

  // Parse destination coordinates
  const [destLat, destLng] = nextDest.latLong.split(',').map(Number);
  if (isNaN(destLat) || isNaN(destLng)) {
    return { arrived: false, destinationId: null, distanceMeters: null };
  }

  // Calculate distance from current GPS to destination
  const distance = haversineDistanceMeters(latitude, longitude, destLat, destLng);
  if (distance === null) {
    return { arrived: false, destinationId: null, distanceMeters: null };
  }

  console.log(`[arrival] vehicle=${vehicleId} dest=${nextDest.locationName} distance=${distance.toFixed(1)}m idle=${elapsedIdleMinutes.toFixed(1)}min threshold=${getFleetConfig().arrival.radiusMeters}m/${getFleetConfig().arrival.idleMinutes}min`);

  // Check if within arrival radius
  if (distance <= getFleetConfig().arrival.radiusMeters) {
    console.log(`[arrival] ARRIVED at ${nextDest.locationName} vehicle=${vehicleId} distance=${distance.toFixed(1)}m`);
    await markDestinationArrived(nextDest.id, travelOrderId, Math.round(distance));
    return { arrived: true, destinationId: nextDest.id, distanceMeters: Math.round(distance) };
  }

  return { arrived: false, destinationId: null, distanceMeters: null };
}

function skippedCycleSummary(skipReason: string): SchedulerCycleSummary {
  return {
    skipped: true,
    skipReason,
    vehiclesProcessed: 0,
    telemetrySaved: 0,
    telemetrySkipped: 0,
    telegramSent: 0,
    telegramFailed: 0,
    alertsSent: 0,
    alertsSkipped: 0,
    alertsFailed: 0,
    alertsPersisted: 0,
    gpsLogsSaved: 0,
    gpsLogsFailed: 0,
    travelOrdersMatched: 0,
    unauthorizedTravelAlerts: 0,
    durationSeconds: 0,
    fleetConfigVersion: String(getFleetConfig().version),
  };
}

async function runCycle(): Promise<SchedulerCycleSummary> {
  // Prevent overlapping executions
  if (cycleLock) {
    console.log('[scheduler] Previous cycle still running — skipping this execution');
    return skippedCycleSummary('lock_active');
  }
  cycleLock = true;

  if (state.paused) {
    console.log('[scheduler] Paused — skipping cycle');
    cycleLock = false;
    return skippedCycleSummary('paused');
  }

  const cycleStart = Date.now();
  const cycleLabel = `#${state.cyclesCompleted + 1}`;

  console.log(`[scheduler] Starting sync cycle ${cycleLabel}...`);

  try {
    const pool = getPool();

    // ── Fetch driver, TO number & destination coordinates from approved travel orders ───
    // Single query to get all vehicle-to-driver mappings and TO destination coordinates
    // Now also fetches multiple destinations from travel_order_destinations for GPS matching
    const driverOverrides = new Map<string, string>();
    const toNumberOverrides = new Map<string, string>();
    const toDestinationOverrides = new Map<string, string>();
    const toDestinationsList = new Map<string, Array<{ locationName: string; latLong: string | null; stopOrder: number }>>();
    const toTravelOrderIds = new Map<string, string>(); // vehicle_id → travel_order_id
    const noToVehicleIds = new Set<string>();
    try {
      const activeTripSync = await syncApprovedTravelOrdersToActiveTrips();
      if (activeTripSync.checked > 0 || activeTripSync.linked > 0) {
        console.log(`[scheduler] Active-trip TO sync checked=${activeTripSync.checked} linked=${activeTripSync.linked}`);
      }

      const allTOData = await pool.query<{ vehicle_id: string; driver_name: string | null; to_number: string; lat_long_destination: string | null; id: string }>(
        `SELECT DISTINCT ON (to_table.vehicle_id) 
           to_table.vehicle_id, 
           d.full_name AS driver_name,
           to_table.to_number,
           to_table.lat_long_destination,
           to_table.id
         FROM travel_orders to_table
         LEFT JOIN drivers d ON d.id = to_table.driver_id
         WHERE to_table.status IN ('APPROVED', 'ACTIVE')
         AND to_table.vehicle_id IS NOT NULL
         AND DATE(to_table.scheduled_departure) = CURRENT_DATE`,
      );
      for (const row of allTOData.rows) {
        if (row.driver_name) driverOverrides.set(row.vehicle_id, row.driver_name);
        if (row.to_number) toNumberOverrides.set(row.vehicle_id, row.to_number);
        if (row.lat_long_destination) toDestinationOverrides.set(row.vehicle_id, row.lat_long_destination);
        toTravelOrderIds.set(row.vehicle_id, row.id);

        // Fetch all destinations for this travel order
        try {
          const destResult = await pool.query<{ location_name: string; lat_long: string | null; stop_order: number }>(
            `SELECT location_name, lat_long, stop_order
             FROM travel_order_destinations
             WHERE travel_order_id = $1
             ORDER BY stop_order ASC`,
            [row.id],
          );
          if (destResult.rows.length > 0) {
            toDestinationsList.set(row.vehicle_id, destResult.rows.map((d) => ({
              locationName: d.location_name,
              latLong: d.lat_long,
              stopOrder: d.stop_order,
            })));
          }
        } catch (destErr) {
          // travel_order_destinations table may not exist yet on older DBs
          console.log(`[scheduler] No destinations found for travel order ${row.id}: ${(destErr as Error).message}`);
        }
      }
      const activeTripOverrides = await getActiveTripTravelOrderOverrides();
      for (const [vehicleId, driverName] of Object.entries(activeTripOverrides.driverOverrides)) {
        driverOverrides.set(vehicleId, driverName);
      }
      for (const [vehicleId, toNumber] of Object.entries(activeTripOverrides.toNumberOverrides)) {
        toNumberOverrides.set(vehicleId, toNumber);
      }
      for (const [vehicleId, destination] of Object.entries(activeTripOverrides.toDestinationOverrides)) {
        toDestinationOverrides.set(vehicleId, destination);
      }
      // Track vehicles with NO approved TO for today (for warning suffix)
      const allVehicleResult = await pool.query<{ vehicle_id: string }>(
        `SELECT id AS vehicle_id FROM vehicles WHERE id IS NOT NULL`,
      );
      for (const v of allVehicleResult.rows) {
        if (!toNumberOverrides.has(v.vehicle_id)) {
          noToVehicleIds.add(v.vehicle_id);
        }
      }
      console.log(`[scheduler] Fetched ${driverOverrides.size} driver, ${toNumberOverrides.size} TO overrides, ${toDestinationOverrides.size} TO destinations, ${toDestinationsList.size} multi-destination routes, ${noToVehicleIds.size} vehicles with no TO`);
    } catch (err) {
      console.error('[scheduler] Failed to fetch overrides:', (err as Error).message);
    }

    const result = await syncFleetAndAlert({
      // Use the backend's direct PostgreSQL pool for plate validation
      resolveVehicleId: (plateNumber: string) => findVehicleByPlate(plateNumber),
      driverOverrides: Object.fromEntries(driverOverrides),
      toNumberOverrides: Object.fromEntries(toNumberOverrides),
      toDestinationOverrides: Object.fromEntries(toDestinationOverrides),
      noToVehicleIds: Array.from(noToVehicleIds),
      dispatchAlerts: false,
    });

    console.log(`[scheduler] Sync result: ${result.vehicles} vehicles, ${result.data.length} statuses, ${result.tripLogs.length} trip logs, ${result.emittedAlerts?.length || 0} emitted alerts`);
    console.log('[scheduler] emittedAlerts.length', result.emittedAlerts?.length ?? 0);
    for (const emittedAlert of result.emittedAlerts ?? []) {
      console.log('[scheduler] emittedAlert', {
        vehicleId: emittedAlert.vehicleId,
        plateNumber: emittedAlert.plateNumber,
        eventType: emittedAlert.eventType,
        message: emittedAlert.message,
      });
    }
    if (result.data.length > 0) {
      console.log('[scheduler] Sample vehicle:', JSON.stringify(result.data[0], null, 2));
    }

    // ── No-TO Log Sync ───────────────────────────────────────
    try {
      const noToResult = await syncNoToLogsFromTelemetry();
      console.log(`[scheduler] No-TO sync: created=${noToResult.created} updated=${noToResult.updated} skipped=${noToResult.skipped} failed=${noToResult.failed}`);
    } catch (noToErr) {
      console.error('[scheduler] No-TO sync failed:', (noToErr as Error).message);
    }

    // ── GPS Log Persistence (DISABLED for scheduler) ───────────
    // IMPORTANT: The scheduler runs on current fleet status snapshots
    // from the Cartrack fleet API. These are NOT trip history records.
    //
    // Trip logs generated from live vehicle telemetry (ignition on/off,
    // motion detection, etc.) are unreliable for TO matching because
    // they lack the `Time`, `Status`, `Events`, and `Location` columns
    // from the fleet trip history table.
    //
    // GPS logs should ONLY be created through the manual Sync History
    // button, which uses /rest/trips/{plate} and fleet trip history
    // detail endpoints that return proper Time/Status/Events/Location.
    //
    // Therefore, scheduler MUST NOT persist GPS logs from live status.
    let gpsLogsSaved = 0;
    let gpsLogsFailed = 0;
    let telegramSent = 0;
    let telegramFailed = 0;
    const trackTelegramResult = (alertResult: SaveAndSendTelemetryAlertResult) => {
      if (alertResult.telegramSent) {
        telegramSent += 1;
      } else if (alertResult.telegramError && alertResult.telegramError !== 'missing_id') {
        telegramFailed += 1;
      }
    };
    // GPS log persistence from scheduler is disabled.
    // See trackingHistorySyncService.ts for the proper sync flow.

    // ── GPS Telemetry Persistence ──────────────────────────────
    //
    // All telemetry events are persisted via the unified alert pipeline
    // (saveAndSendTelemetryAlert). This includes DB-backed detection
    // (ignition transitions, idling, location updates) and emitted alerts
    // from tracker.js.
    let telemetrySaved = 0;
    let telemetrySkipped = 0;

    const emittedAlerts = result.emittedAlerts as unknown as Array<{
      vehicleId: string;
      vehicleName: string;
      plateNumber: string;
      eventType: string;
      latitude: number | null;
      longitude: number | null;
      location: string;
      speed: number;
      fuel: number | null;
      ignition: boolean;
      driver: string | null;
      toNumber: string | null;
      timestamp: string;
      message: string;
      tripId?: string | null;
      idleAlertCount?: number;
      idlingThresholdReached?: number | null;
      idlingStartedAt?: string | null;
    }> | undefined;

    const vehicles = result.data as unknown as Array<Record<string, unknown>> | undefined;

    console.log('[scheduler] Telemetry persistence via unified alert pipeline');

    // ── Unauthorized Travel Alert Detection ────────────────────
    // After telemetry is saved, check for vehicles traveling without
    // an approved travel order and create alerts if needed.
    // Uses direct DB lookup to ensure accuracy (not Cartrack's to_number).
    let unauthorizedTravelAlertsCreated = 0;
    const unauthorizedTravelAlertVehicleIds = new Set<string>();
    if (vehicles && vehicles.length > 0) {
      for (const vehicle of vehicles) {
        try {
          const vid = String(vehicle.id ?? '');
          const speed = Number(vehicle.speed || 0);
          const isMoving = speed > 0;

          // Only alert if vehicle is currently moving
          if (!isMoving) continue;

          // Check DB directly for approved travel order (today only)
          const toResult = await pool.query<{ exists: boolean }>(
            `SELECT EXISTS(
               SELECT 1 FROM travel_orders
               WHERE vehicle_id = $1
                 AND status = 'APPROVED'
                 AND DATE(scheduled_departure) = CURRENT_DATE
               LIMIT 1
             ) as exists`,
            [vid],
          );
          const hasApprovedTO = toResult.rows[0]?.exists ?? false;

          // Skip if vehicle has an approved travel order
          if (hasApprovedTO) continue;
          // Get latest telemetry for location data and current active trip.
          const latestTelemetry = await getLatestTelemetry(vid);

          // Find the most recent trip that already has NO_APPROVED_TRAVEL_ORDER
          // This prevents duplicate alerts for the same unauthorized trip
          const existingTripResult = await pool.query<{ active_trip_id: string }>(
            `SELECT DISTINCT active_trip_id
               FROM gps_telemetry
              WHERE vehicle_id = $1
                AND event_type = $2
                AND active_trip_id IS NOT NULL
              ORDER BY recorded_at DESC
              LIMIT 1`,
            [vid, EVENT_TYPE.NO_APPROVED_TRAVEL_ORDER],
          );

          let activeTripId = existingTripResult.rows[0]?.active_trip_id ?? null;

          // If no existing unauthorized trip found, check if latest trip is still active
          // Only create new trip if latest event was IGNITION_OFF or no active trip
          if (!activeTripId) {
            if (latestTelemetry?.eventType === EVENT_TYPE.IGNITION_OFF || !latestTelemetry?.activeTripId) {
              activeTripId = randomUUID();
            } else {
              // Reuse the latest active trip
              activeTripId = latestTelemetry.activeTripId;
            }
          }

          const existingUnauthorizedAlert = await pool.query<{ id: string }>(
            `SELECT id
               FROM gps_telemetry
              WHERE active_trip_id = $1
                AND event_type = $2
              LIMIT 1`,
            [activeTripId, EVENT_TYPE.NO_APPROVED_TRAVEL_ORDER],
          );
          if (existingUnauthorizedAlert.rows.length > 0) {
            console.log(`[scheduler] Skipping NO_APPROVED_TRAVEL_ORDER vehicle=${vid} tripId=${activeTripId} reason=already_alerted_for_active_trip`);
            continue;
          }
          const latitude = latestTelemetry?.latitude ?? null;
          const longitude = latestTelemetry?.longitude ?? null;
          const locationName = latestTelemetry?.locationName || null;

          const plate = await (await import('./gpsAlertService.js')).getVehiclePlate(vid);
          const locationText = locationName || 'Unknown location';
          const driverName = driverOverrides.get(vid) || 'Unassigned';
          const vehicleEmoji = getVehicleEmoji(plate ?? '');
          const message = `🚨 NO APPROVED TRAVEL ORDER - ${vehicleEmoji} ${formatVehicleHeader(plate ?? 'Unknown', null)}\n👤 Driver: ${driverName}\n📍 Location: ${locationText}\n🕘 ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })} PHT`;
          console.log('[TELEMETRY INSERT]', {
            plateNumber: plate ?? 'Unknown',
            sourceEventType: EVENT_TYPE.NO_APPROVED_TRAVEL_ORDER,
            finalEventType: EVENT_TYPE.NO_APPROVED_TRAVEL_ORDER,
            message,
          });

          const result = await saveAndSendTelemetryAlert({
            eventType: EVENT_TYPE.NO_APPROVED_TRAVEL_ORDER,
            vehicleId: vid,
            plateNumber: plate ?? 'Unknown',
            activeTripId,
            latitude,
            longitude,
            speedKmh: speed,
            fuelLiters: latestTelemetry?.fuelLiters ?? null,
            ignition: latestTelemetry?.ignition ?? speed > 0,
            locationName,
            recordedAt: new Date().toISOString(),
            telegramMessage: message,
          });
          trackTelegramResult(result);

          if (!result.savedTelemetry.id) {
            telemetrySkipped += 1;
            console.log(`[scheduler] DB insert failed missing_id NO_APPROVED_TRAVEL_ORDER vehicle=${vid}`);
            continue;
          }

          if (result.savedTelemetry.updated) {
            telemetrySkipped += 1;
            console.log(`[scheduler] NO_APPROVED_TRAVEL_ORDER telemetry duplicate existing_id=${result.savedTelemetry.id} vehicle=${vid}`);
            continue;
          }

          telemetrySaved += 1;
          unauthorizedTravelAlertsCreated += 1;
          unauthorizedTravelAlertVehicleIds.add(vid);
        } catch (err) {
          console.error(`[scheduler] Failed to check/save unauthorized travel for ${String(vehicle.id)}:`, errorMessage(err));
        }
      }
    }

    // ── DB-backed Telemetry From Current Fleet Snapshot ────────
    //
    // External cron services don't maintain warm in-memory state.
    // Persist IGNITION_ON/IGNITION_OFF, LOCATION_UPDATE, and IDLING here
    // from database state so external cron invocations still save telemetry reliably.
    //
    // ── Ignition transition detection ─────────────────────────────
    // Compares current fleet snapshot ignition with the DB's last known ignition.
    // This catches IGNITION_OFF events that tracker.js's sendVehicleAlerts()
    // may not have persisted to gps_telemetry.
    // Do NOT rely on old in-memory tracker state or emittedAlerts for ignition events.
    // This must work even when Vercel/cron has no memory.
    if (vehicles && vehicles.length > 0) {
      for (const vehicle of vehicles) {
        const vehicleId = String(vehicle.id ?? '');
        if (!vehicleId) continue;

        try {
          const speed = Number(vehicle.speed ?? 0);
          const currentIgnition = vehicle.ignition === true;
          const latestTelemetry = await getLatestTelemetry(vehicleId);
          const prevIgnition = latestTelemetry?.ignition ?? null;
          const latestActiveTripId = latestTelemetry?.eventType === EVENT_TYPE.IGNITION_OFF
            ? null
            : latestTelemetry?.activeTripId ?? null;
          const plateNumber = String(vehicle.name ?? '').split(' ')[0] || String(vehicleId);
          const locationName = String(vehicle.location ?? '').trim() || null;
          const coordinates = vehicle.coordinates as { latitude?: unknown; longitude?: unknown } | null | undefined;
          const latitude = coordinates?.latitude == null ? null : Number(coordinates.latitude);
          const longitude = coordinates?.longitude == null ? null : Number(coordinates.longitude);
          const fuelLiters = vehicle.fuel == null ? null : Number(vehicle.fuel);
          const driverName = typeof vehicle.driver === 'string' ? vehicle.driver : null;
          const toNumber = typeof vehicle.to_number === 'string' ? vehicle.to_number : null;
          const recordedAt = new Date().toISOString();

          // Log ignition check for every vehicle
          console.log(`[scheduler] DB-backed ignition check prev=${prevIgnition} current=${currentIgnition} vehicle=${vehicleId} plate=${plateNumber}`);

          // ── IGNITION_OFF detection: prev ON → current OFF ──────
          if (prevIgnition === true && currentIgnition === false) {
            const eventTripId = latestActiveTripId;
            if (!eventTripId) {
              telemetrySkipped += 1;
              console.log(`[scheduler] SKIPPING DB-backed IGNITION_OFF for ${vehicleId} - no active trip found`);
              continue;
            }
            const message = formatIgnitionAlert(plateNumber, false, locationName || 'Unknown location', recordedAt, toNumber, driverName);
            console.log(`[scheduler] DB-backed IGNITION_OFF detected vehicle=${vehicleId} plate=${plateNumber} prevIgnition=${prevIgnition} currentIgnition=${currentIgnition}`);

            const result = await saveAndSendTelemetryAlert({
              eventType: EVENT_TYPE.IGNITION_OFF,
              vehicleId,
              plateNumber,
              activeTripId: eventTripId,
              latitude,
              longitude,
              speedKmh: speed,
              fuelLiters,
              ignition: false,
              locationName,
              recordedAt,
              telegramMessage: message,
            });
            trackTelegramResult(result);

            if (!result.savedTelemetry.id) {
              telemetrySkipped += 1;
              console.log(`[scheduler] DB-backed IGNITION_OFF insert skipped reason=missing_telemetry_id vehicle=${vehicleId} trip=${eventTripId}`);
            } else {
              if (result.savedTelemetry.inserted) {
                telemetrySaved += 1;
                console.log(`[scheduler] DB-backed IGNITION_OFF saved telemetry_id=${result.savedTelemetry.id} vehicle=${vehicleId} trip=${eventTripId}`);
              } else {
                telemetrySkipped += 1;
                console.log(`[scheduler] DB-backed IGNITION_OFF insert skipped reason=duplicate existing_id=${result.savedTelemetry.id} vehicle=${vehicleId} trip=${eventTripId}`);
              }
            }

            // Close active idling session if one exists
            await closeIdlingDedupDb(vehicleId, eventTripId);
            // Close/finish active trip after saving IGNITION_OFF
            console.log(`[scheduler] DB-backed IGNITION_OFF trip closed vehicle=${vehicleId} trip=${eventTripId}`);
            continue;
          }

          // ── IGNITION_ON detection: prev OFF → current ON ───────
          if (prevIgnition === false && currentIgnition === true) {
            const eventTripId = randomUUID();
            const message = formatIgnitionAlert(plateNumber, true, locationName || 'Unknown location', recordedAt, toNumber, driverName);
            console.log(`[scheduler] DB-backed IGNITION_ON detected vehicle=${vehicleId} plate=${plateNumber} prevIgnition=${prevIgnition} currentIgnition=${currentIgnition}`);

            const result = await saveAndSendTelemetryAlert({
              eventType: EVENT_TYPE.IGNITION_ON,
              vehicleId,
              plateNumber,
              activeTripId: eventTripId,
              latitude,
              longitude,
              speedKmh: speed,
              fuelLiters,
              ignition: true,
              locationName,
              recordedAt,
              telegramMessage: message,
            });
            trackTelegramResult(result);

            if (!result.savedTelemetry.id) {
              telemetrySkipped += 1;
              console.log(`[scheduler] DB-backed IGNITION_ON insert skipped reason=missing_telemetry_id vehicle=${vehicleId} trip=${eventTripId}`);
            } else {
              if (result.savedTelemetry.inserted) {
                telemetrySaved += 1;
                console.log(`[scheduler] DB-backed IGNITION_ON saved telemetry_id=${result.savedTelemetry.id} vehicle=${vehicleId} trip=${eventTripId}`);
              } else {
                telemetrySkipped += 1;
                console.log(`[scheduler] DB-backed IGNITION_ON insert skipped reason=duplicate existing_id=${result.savedTelemetry.id} vehicle=${vehicleId} trip=${eventTripId}`);
              }
            }
            // Fall through to continue processing LOCATION_UPDATE/IDLING below
          }

          // ── If vehicle is off and wasn't a transition, just skip ──
          if (!currentIgnition) {
            await closeIdlingDedupDb(vehicleId, latestActiveTripId);
            continue;
          }

          const isMoving = currentIgnition && speed > 0;
          const activeIdlingSession = await getActiveIdlingSessionForVehicle(vehicleId);
          const activeTripId = latestActiveTripId ?? activeIdlingSession?.activeTripId ?? null;

          if (isMoving) {
            const latestTripTelemetry = activeTripId
              ? await getLatestTelemetryForTrip(vehicleId, activeTripId)
              : null;
            // ── MOTION_STARTED check (before LOCATION_UPDATE) ──
            // Save the first moving row when the DB's previous state was stopped/idling.
            if (activeTripId && shouldPersistMotionStartedFromPreviousState(latestTripTelemetry, activeIdlingSession, speed, currentIgnition)) {
              const motionTripId = activeTripId;
              const message = `🟢 MOTION STARTED - ${getVehicleEmoji(plateNumber)} ${formatVehicleHeader(plateNumber, toNumber)}\n\n👤 Driver: ${driverName || 'Unassigned'}\n📍 ${locationName || 'Unknown location'}\n🕘 ${new Date(recordedAt).toLocaleString('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })} PHT`;

              const result = await saveAndSendTelemetryAlert({
                eventType: EVENT_TYPE.MOTION_STARTED,
                vehicleId,
                plateNumber,
                activeTripId: motionTripId,
                latitude,
                longitude,
                speedKmh: speed,
                fuelLiters,
                ignition: currentIgnition,
                locationName,
                recordedAt,
                telegramMessage: message,
              });
              trackTelegramResult(result);

              if (result.savedTelemetry.id) {
                if (result.savedTelemetry.inserted) {
                  telemetrySaved += 1;
                  console.log(`[motion-started] action=saved vehicle=${vehicleId} trip=${motionTripId}`);
                } else {
                  telemetrySkipped += 1;
                  console.log(`[motion-started] action=skipped reason=duplicate vehicle=${vehicleId} trip=${motionTripId}`);
                }
                await closeIdlingDedupDb(vehicleId, motionTripId);
                console.log(`[scheduler] LOCATION_UPDATE skipped because MOTION_STARTED was saved vehicle=${vehicleId} trip=${motionTripId}`);
                continue;
              } else {
                telemetrySkipped += 1;
                console.log(`[motion-started] action=skipped reason=missing_telemetry_id vehicle=${vehicleId} trip=${motionTripId}`);
              }
            } else if (activeTripId) {
              console.log(`[motion-started] action=skipped reason=already_moving vehicle=${vehicleId} trip=${activeTripId}`);
            } else {
              console.log(`[motion-started] action=skipped reason=no_active_trip vehicle=${vehicleId}`);
            }

            if (!activeTripId) {
              telemetrySkipped += 1;
              console.log(`[scheduler] SKIPPING DB-backed LOCATION_UPDATE for ${vehicleId} - no active trip found`);
              continue;
            }

            // ── LOCATION_UPDATE ─────────────────────────────────
            // Rule: compare by location_name only (same vehicle_id + active_trip_id).
            // If no previous LOCATION_UPDATE: save/send new LOCATION_UPDATE.
            // If current location_name is different from previous: save/send new LOCATION_UPDATE.
            // If current location_name is same: skip.
            // Ignore latitude/longitude changes completely.
            // Never update an existing LOCATION_UPDATE row.
            const previousLocationName = await getLatestLocationUpdateLocation(vehicleId, activeTripId);
            const currentLocationName = locationName;
            const locationNameChanged = Boolean(
              currentLocationName &&
              currentLocationName.trim() &&
              previousLocationName !== currentLocationName,
            );

            console.log(`[location-update] previous=${previousLocationName ?? 'null'} current=${currentLocationName ?? 'null'} action=${!previousLocationName ? 'insert' : locationNameChanged ? 'insert' : 'skip_same_location'}`);

            if (previousLocationName && !locationNameChanged) {
              telemetrySkipped += 1;
              console.log(`[scheduler] SKIPPING DB-backed LOCATION_UPDATE for ${vehicleId} reason=same_location_name`);
              continue;
            }

            const message = `🗺 LOCATION UPDATE - ${getVehicleEmoji(plateNumber)} ${formatVehicleHeader(plateNumber, toNumber)}\n\n📍 ${locationName}\n⚡ Speed: ${speed} km/h\n⛽ Fuel: ${fuelLiters ?? 'Unknown'} L\n👤 Driver: ${driverName || 'Unassigned'}\n🕘 ${new Date(recordedAt).toLocaleString('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })} PHT`;

            const result = await saveAndSendTelemetryAlert({
              eventType: EVENT_TYPE.LOCATION_UPDATE,
              vehicleId,
              plateNumber,
              activeTripId,
              latitude,
              longitude,
              speedKmh: speed,
              fuelLiters,
              ignition: currentIgnition,
              locationName,
              recordedAt,
              telegramMessage: message,
            });
            trackTelegramResult(result);

            if (result.savedTelemetry.id) {
              if (result.savedTelemetry.inserted) {
                telemetrySaved += 1;
                console.log(`[scheduler] DB-backed LOCATION_UPDATE saved telemetry_id=${result.savedTelemetry.id} vehicle=${vehicleId}`);
              } else {
                telemetrySkipped += 1;
                console.log(`[scheduler] DB-backed LOCATION_UPDATE skipped telemetry_id=${result.savedTelemetry.id} vehicle=${vehicleId} reason=${result.savedTelemetry.updated ? 'updated' : 'duplicate'}`);
              }
            } else {
              telemetrySkipped += 1;
              console.log(`[scheduler] DB-backed LOCATION_UPDATE skipped reason=missing_id vehicle=${vehicleId}`);
            }
            continue;
          }

          if (currentIgnition && speed <= 0) {
            if (!activeTripId) {
              telemetrySkipped += 1;
              console.log(`[idling-alert] action=skipped reason=no_active_trip vehicle=${vehicleId}`);
              continue;
            }

            const movingTelemetryAt = activeIdlingSession?.idlingStartedAt
              ? null
              : await getLatestMovingTelemetryTimestamp(vehicleId, activeTripId);
            const idlingStartedAt = activeIdlingSession?.idlingStartedAt ?? movingTelemetryAt ?? recordedAt;
            const idlingStartedMs = new Date(idlingStartedAt).getTime();
            const recordedAtMs = new Date(recordedAt).getTime();
            const idleMinutes = Number.isFinite(idlingStartedMs) && Number.isFinite(recordedAtMs)
              ? Math.max(0, (recordedAtMs - idlingStartedMs) / 60000)
              : 0;
            const thresholdMinutes = idlingMilestoneForMinutes(idleMinutes);

            if (thresholdMinutes === null) {
              console.log(`[idling-alert] action=skipped reason=below_threshold idle=${idleMinutes.toFixed(1)}min vehicle=${vehicleId} trip=${activeTripId}`);
              continue;
            }

            const shouldPersistIdling = await shouldPersistIdlingAlertDb(vehicleId, activeTripId, thresholdMinutes);
            if (!shouldPersistIdling) {
              telemetrySkipped += 1;
              console.log(`[idling-alert] action=skipped reason=already_alerted threshold=${thresholdMinutes}min vehicle=${vehicleId} trip=${activeTripId}`);
              continue;
            }

            const message = formatIdlingTooLongAlert(
              plateNumber,
              Math.floor(idleMinutes),
              fuelLiters,
              locationName || 'Unknown location',
              recordedAt,
              toNumber,
              driverName,
            );

            const result = await saveAndSendTelemetryAlert({
              eventType: EVENT_TYPE.IDLING,
              vehicleId,
              plateNumber,
              activeTripId,
              latitude,
              longitude,
              speedKmh: speed,
              fuelLiters,
              ignition: currentIgnition,
              locationName,
              recordedAt,
              telegramMessage: message,
            });
            trackTelegramResult(result);

            if (result.savedTelemetry.id) {
              if (result.savedTelemetry.inserted) {
                telemetrySaved += 1;
                console.log(`[idling-alert] action=saved threshold=${thresholdMinutes}min idle=${idleMinutes.toFixed(1)}min vehicle=${vehicleId} trip=${activeTripId}`);
              } else {
                telemetrySkipped += 1;
                console.log(`[idling-alert] action=skipped reason=${result.savedTelemetry.updated ? 'updated' : 'duplicate'} threshold=${thresholdMinutes}min vehicle=${vehicleId} trip=${activeTripId}`);
              }
              await markIdlingAlertDb(vehicleId, activeTripId, idlingStartedAt, thresholdMinutes);
            } else {
              telemetrySkipped += 1;
              console.log(`[idling-alert] action=skipped reason=missing_telemetry_id threshold=${thresholdMinutes}min vehicle=${vehicleId} trip=${activeTripId}`);
            }
            continue;
          }
        } catch (err) {
          console.error(`[scheduler] Failed DB-backed telemetry persistence for ${vehicleId}:`, errorMessage(err));
        }
      }
    }

    // ── STEP 2: Persist Emitted Alerts as GPS Telemetry ────────
    // This saves the actual alert types that were sent to Telegram.
    // The eventType comes directly from tracker.js's canonical mapping.
    console.log("[SCHEDULER] emittedAlerts", emittedAlerts?.length ?? 0);

    if (emittedAlerts && emittedAlerts.length > 0) {
      console.log("[TRACKER EMITTED]", emittedAlerts.map(a => ({
        plate: a.plateNumber,
        event: a.eventType
      })));
      console.log(`[scheduler] Processing ${emittedAlerts.length} emitted alerts for telemetry persistence`);

      for (const alert of emittedAlerts) {
        try {
          const vehicleId = alert.vehicleId;
          if (!vehicleId) {
            telemetrySkipped += 1;
            continue;
          }

          const eventType = alert.eventType;
          let finalEventType = canonicalEventType(eventType);
          if (!eventType || !finalEventType) {
            telemetrySkipped += 1;
            continue;
          }
          console.log("[SCHEDULER RECEIVED]", {
            eventType,
            tripId: alert.tripId ?? null,
            vehicleId,
            timestamp: alert.timestamp
          });

          const spd = Number(alert.speed || 0);
          const ign = alert.ignition;
          const effectiveIgnition = finalEventType === EVENT_TYPE.IGNITION_OFF ? false : spd > 0 ? true : ign;
          const latitude = alert.latitude ?? null;
          const longitude = alert.longitude ?? null;
          const fuelLiters = alert.fuel ?? null;
          const locationName = alert.location || null;
          const driverName = alert.driver || null;
          const toNumber = alert.toNumber || null;
          const plateNumber = alert.plateNumber || '';

          // Round timestamp to sync interval to enable deduplication
          const now = Date.now();
          const intervalMs = SYNC_INTERVAL_SECONDS * 1000;
          const rounded = new Date(Math.floor(now / intervalMs) * intervalMs).toISOString();
          const recordedAt = rounded;

          let activeTripId: string | null = alert.tripId ?? null;
          if (finalEventType === EVENT_TYPE.IGNITION_ON) {
            // ── IMPORTANT: Always generate a NEW UUID for each IGNITION_ON ──
            // DO NOT reuse an activeTripId from a previous trip cycle.
            // A new ignition cycle = a brand new trip = a brand new UUID.
            // The alert.tripId from tripStateTracker is non-UUID format,
            // and getLatestActiveTripId() would return the OLD trip's UUID.
            activeTripId = randomUUID();
            console.log(`[ACTIVE TRIP] Created UUID ${activeTripId} for vehicle=${vehicleId} IGNITION_ON`);
          } else if (finalEventType === EVENT_TYPE.IGNITION_OFF) {
            activeTripId = activeTripId ?? await getLatestActiveTripId(vehicleId);
          } else if (finalEventType === EVENT_TYPE.IDLING || finalEventType === EVENT_TYPE.MOTION_STARTED || finalEventType === EVENT_TYPE.LOCATION_UPDATE) {
            activeTripId = activeTripId ?? await getLatestActiveTripId(vehicleId);
            if (!activeTripId) {
              console.log(`[scheduler] SKIPPING ${finalEventType} for ${vehicleId} - no active trip found`);
              telemetrySkipped += 1;
              continue;
            }
          } else {
            activeTripId = activeTripId ?? await getLatestActiveTripId(vehicleId);
            if (!activeTripId) {
              console.log(`[scheduler] SKIPPING ${finalEventType} for ${vehicleId} - no active trip found`);
              telemetrySkipped += 1;
              continue;
            }
          }

          if (finalEventType === EVENT_TYPE.MOTION_STARTED && activeTripId) {
            const latestTripTelemetry = await getLatestTelemetryForTrip(vehicleId, activeTripId);
            if (!shouldPersistMotionStartedFromPreviousState(latestTripTelemetry, null, spd, effectiveIgnition)) {
              finalEventType = EVENT_TYPE.LOCATION_UPDATE;
              console.log(`[motion-started] downgraded to LOCATION_UPDATE vehicle=${vehicleId} trip=${activeTripId} reason=already_moving`);
            }
          }

          // IGNITION_OFF bypasses all filters and always saves/sends
          if (finalEventType === EVENT_TYPE.IGNITION_OFF) {
            if (!activeTripId) {
              telemetrySkipped += 1;
              console.log(`[scheduler] SKIPPING IGNITION_OFF for ${vehicleId} - no active trip found`);
              continue;
            }
            const latestTripEventType = await getLatestCanonicalTripEventType(vehicleId, activeTripId);
            if (latestTripEventType === EVENT_TYPE.IGNITION_OFF) {
              telemetrySkipped += 1;
              console.log(`[scheduler] SKIPPING IGNITION_OFF for ${vehicleId} - latest trip event is already IGNITION_OFF`);
              continue;
            }
            // IGNITION_OFF always proceeds to save and send
          } else if (finalEventType === EVENT_TYPE.IDLING && activeTripId) {
            const thresholdMinutes = alert.idlingThresholdReached;
            if (thresholdMinutes === undefined || thresholdMinutes === null) {
              telemetrySkipped += 1;
              console.log(`[idling-alert] Skipping IDLING vehicle=${vehicleId} trip=${activeTripId} reason=missing_threshold`);
              continue;
            }
            // Event priority: skip IDLING if MOTION_STARTED or IGNITION_ON exists for this vehicle
            // Only check same vehicle, same polling cycle (this emittedAlerts array)
            const hasHigherPriorityEvent = emittedAlerts.some((ea) => {
              if (ea.vehicleId !== vehicleId) return false;
              const candidateEventType = canonicalEventType(ea.eventType);
              return candidateEventType === EVENT_TYPE.IGNITION_ON ||
                candidateEventType === EVENT_TYPE.MOTION_STARTED;
            });
            if (hasHigherPriorityEvent) {
              telemetrySkipped += 1;
              console.log(`[idling-alert] Skipping IDLING vehicle=${vehicleId} trip=${activeTripId} reason=higher_priority_event`);
              continue;
            }
            const shouldPersistIdling = await shouldPersistIdlingAlertDb(vehicleId, activeTripId, thresholdMinutes);
            if (!shouldPersistIdling) {
              telemetrySkipped += 1;
              console.log(`[idling-alert] Skipping IDLING threshold=${thresholdMinutes}min vehicle=${vehicleId} trip=${activeTripId} reason=already_alerted`);
              continue;
            }
          } else if (finalEventType === EVENT_TYPE.LOCATION_UPDATE) {
            const hasHigherPriorityEvent = emittedAlerts.some((ea) => {
              if (ea.vehicleId !== vehicleId) return false;
              const candidateEventType = canonicalEventType(ea.eventType);
              return candidateEventType === EVENT_TYPE.IGNITION_ON ||
                candidateEventType === EVENT_TYPE.MOTION_STARTED;
            });
            if (!effectiveIgnition || spd <= 0 || hasHigherPriorityEvent) {
              telemetrySkipped += 1;
              console.log(`[scheduler] SKIPPING LOCATION_UPDATE for ${vehicleId} reason=${!effectiveIgnition ? 'ignition_off' : spd <= 0 ? 'not_moving' : 'higher_priority_event'}`);
              continue;
            }

            // Location deduplication: compare by location_name only (same vehicle_id + active_trip_id)
            const previousLocationName = await getLatestLocationUpdateLocation(vehicleId, activeTripId);
            const currentLocationName = locationName;
            const locationNameChanged = Boolean(
              currentLocationName &&
              currentLocationName.trim() &&
              previousLocationName !== currentLocationName,
            );

            console.log(`[location-update] previous=${previousLocationName ?? 'null'} current=${currentLocationName ?? 'null'} action=${!previousLocationName ? 'insert' : locationNameChanged ? 'insert' : 'skip_same_location'}`);

            if (previousLocationName && !locationNameChanged) {
              telemetrySkipped += 1;
              console.log(`[scheduler] SKIPPING LOCATION_UPDATE for ${vehicleId} reason=same_location_name`);
              continue;
            }
          }

          console.log('[TELEMETRY INSERT]', {
            plateNumber,
            sourceEventType: alert.eventType,
            finalEventType,
            message: alert.message,
          });

          console.log("[DB INSERT EVENT]", {
            plate: plateNumber,
            alertEventType: alert.eventType,
            finalEventType,
            speed: spd,
            ignition: effectiveIgnition,
            message: alert.message?.slice(0, 80)
          });
          console.log("[DB INSERT]", {
            finalEventType,
            tripId: activeTripId,
            vehicleId
          });

          const telegramMessage = alert.message || null;
          const result = await saveAndSendTelemetryAlert({
            eventType: finalEventType,
            vehicleId,
            plateNumber,
            activeTripId,
            latitude,
            longitude,
            speedKmh: spd,
            fuelLiters,
            ignition: effectiveIgnition,
            locationName,
            recordedAt,
            telegramMessage,
          });
          trackTelegramResult(result);

          if (!result.savedTelemetry.id) {
            telemetrySkipped += 1;
            console.log(`[idling-alert] DB insert failed missing_id vehicle=${vehicleId} event=${finalEventType} trip=${activeTripId ?? 'null'}`);
            continue;
          }

          // ── Track telemetry counts ──────────────────────────────
          if (result.savedTelemetry.updated) {
            telemetrySkipped += 1;
            console.log(`[idling-alert] ${finalEventType} LOCATION_UPDATE updated telemetry_id=${result.savedTelemetry.id} vehicle=${vehicleId} trip=${activeTripId ?? 'null'}`);
          } else if (result.savedTelemetry.inserted) {
            telemetrySaved += 1;
            console.log(`[idling-alert] ${finalEventType} telemetry inserted telemetry_id=${result.savedTelemetry.id} vehicle=${vehicleId} trip=${activeTripId ?? 'null'}`);
          } else {
            telemetrySkipped += 1;
            console.log(`[idling-alert] ${finalEventType} telemetry duplicate existing_id=${result.savedTelemetry.id} vehicle=${vehicleId} trip=${activeTripId ?? 'null'}`);
          }

          if (finalEventType === EVENT_TYPE.IDLING && activeTripId) {
            const thresholdMinutes = alert.idlingThresholdReached;
            if (thresholdMinutes !== undefined && thresholdMinutes !== null) {
              // Use the actual idling start time from tracker state (preserves original timer)
              const idlingStartedAt = alert.idlingStartedAt || new Date(Date.now() - thresholdMinutes * 60 * 1000).toISOString();
              await markIdlingAlertDb(vehicleId, activeTripId, idlingStartedAt, thresholdMinutes);
              console.log(`[idling-alert] IDLING dedup marked threshold=${thresholdMinutes}min telemetry_id=${result.savedTelemetry.id} vehicle=${vehicleId} trip=${activeTripId}`);
            }
          }

          if (finalEventType === EVENT_TYPE.MOTION_STARTED || finalEventType === EVENT_TYPE.IGNITION_OFF) {
            await closeIdlingDedupDb(vehicleId, activeTripId);
            console.log(`[idling-alert] Closed active idling state vehicle=${vehicleId} trip=${activeTripId ?? 'null'} event=${finalEventType}`);
          }
        } catch (err) {
          console.error(`[scheduler] Failed to save telemetry for ${alert.vehicleId}:`, errorMessage(err));
        }
      }
    } else {
      console.log('[scheduler] No emitted alerts to persist');
    }

    try {
      const tripLogSync = await syncGpsTripLogsFromTelemetry();
      gpsLogsSaved = tripLogSync.created + tripLogSync.updated;
      gpsLogsFailed = tripLogSync.failed;
      const activeTripSync = await syncApprovedTravelOrdersToActiveTrips();
      const unlinkedTripSync = await syncUnlinkedGpsTripLogsToTravelOrders();
      if (activeTripSync.checked > 0 || activeTripSync.linked > 0) {
        console.log(`[scheduler] Post-telemetry active-trip TO sync checked=${activeTripSync.checked} linked=${activeTripSync.linked}`);
      }
      if (unlinkedTripSync.checked > 0 || unlinkedTripSync.linked > 0) {
        console.log(`[scheduler] Post-telemetry unlinked-trip TO sync checked=${unlinkedTripSync.checked} linked=${unlinkedTripSync.linked}`);
      }
      for (const syncResult of activeTripSync.results) {
        if (syncResult.linked) {
          toTravelOrderIds.set(syncResult.activeTripId ?? syncResult.travelOrderId ?? '', syncResult.travelOrderId ?? '');
        }
      }
      for (const syncResult of unlinkedTripSync.results) {
        if (syncResult.linked) {
          toTravelOrderIds.set(syncResult.activeTripId ?? syncResult.travelOrderId ?? '', syncResult.travelOrderId ?? '');
        }
      }
    } catch (err) {
      gpsLogsFailed += 1;
      console.error('[scheduler] Active-trip GPS log/TO sync failed:', errorMessage(err));
    }

    const duration = (Date.now() - cycleStart) / 1000;
    state.lastRunDuration = duration;
    state.lastRunAt = new Date().toISOString();
    state.cyclesCompleted += 1;

    const fleetConfigVersion = getFleetConfig().version;

    const summary = [
      `vehicles=${result.vehicles}`,
      `alerts_sent=${result.alerts.sent}`,
      `alerts_skipped=${result.alerts.skipped}`,
      `alerts_failed=${result.alerts.failed}`,
      `alerts_persisted=${result.alerts.persisted}`,
      `gps_logs_saved=${gpsLogsSaved}`,
      `gps_logs_failed=${gpsLogsFailed}`,
      `telemetry_saved=${telemetrySaved}`,
      `telemetry_skipped=${telemetrySkipped}`,
      `telegram_sent=${telegramSent}`,
      `telegram_failed=${telegramFailed}`,
      `travel_orders_matched=${toTravelOrderIds.size}`,
      `unauthorized_travel_alerts=${unauthorizedTravelAlertsCreated}`,
      `duration=${duration.toFixed(2)}s`,
      `fleet_config=${fleetConfigVersion}`,
    ].join(', ');

    state.lastResult = `ok: ${summary}`;

    console.log(`[scheduler] Cycle ${cycleLabel} completed — ${summary}`);
    return {
      skipped: false,
      skipReason: null,
      vehiclesProcessed: Number(result.vehicles ?? 0),
      telemetrySaved,
      telemetrySkipped,
      telegramSent,
      telegramFailed,
      alertsSent: Number(result.alerts?.sent ?? 0),
      alertsSkipped: Number(result.alerts?.skipped ?? 0),
      alertsFailed: Number(result.alerts?.failed ?? 0),
      alertsPersisted: Number(result.alerts?.persisted ?? 0),
      gpsLogsSaved,
      gpsLogsFailed,
      travelOrdersMatched: toTravelOrderIds.size,
      unauthorizedTravelAlerts: unauthorizedTravelAlertsCreated,
      durationSeconds: duration,
      fleetConfigVersion: String(fleetConfigVersion),
    };
  } catch (error) {
    const duration = (Date.now() - cycleStart) / 1000;
    state.errors += 1;
    state.lastRunDuration = duration;
    state.lastRunAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    state.lastResult = `error: ${message}`;

    console.error(`[scheduler] Cycle ${cycleLabel} failed — ${message}`);
    throw error;
  } finally {
    // Always release the lock
    cycleLock = false;
  }
}

// ── Scheduler Health Check ──────────────────────────────────────
//
// Run this after a cron execution to verify the scheduler processed
// all expected scenarios correctly.
//
// Expected scenarios:
// - IGNITION_ON: One event
// - LOCATION_UPDATE (new location): One new row
// - LOCATION_UPDATE (same location): Skip
// - IDLING_TOO_LONG: tracker-emitted only; thresholds live in tracker.js
// - MOTION_STARTED: No LOCATION_UPDATE in same poll
// - IGNITION_OFF: Active trip closed
//
// Returns a summary object for health check endpoints.
export function getSchedulerHealthCheck(): {
  running: boolean;
  cyclesCompleted: number;
  errors: number;
  lastRunAt: string | null;
  lastRunDuration: number | null;
  lastResult: string | null;
  fleetConfigVersion: string;
} {
  return {
    running: state.running,
    cyclesCompleted: state.cyclesCompleted,
    errors: state.errors,
    lastRunAt: state.lastRunAt,
    lastRunDuration: state.lastRunDuration,
    lastResult: state.lastResult,
    fleetConfigVersion: String(getFleetConfig().version),
  };
}

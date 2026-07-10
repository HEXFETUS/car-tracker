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
  sendTelegram as trackerSendTelegram,
  getVehicleEmoji,
  IDLE_ALERT_THRESHOLDS_MINUTES,
} from '@car-tracker/tracker';
import { findVehicleByPlate } from './gpsLogService.js';
import { insertTelemetry, updateTelemetryTelegramDelivery, getLastIdlingThreshold } from './gpsTelemetryService.js';
import { getPool } from '../db/db.js';
import { SYNC_INTERVAL_SECONDS } from '../config/env.js';
import {
  loadVehicleState,
  ensureVehicleStateSchema,
  upsertVehicleState,
} from './gpsVehicleStateService.js';
import { createGpsAlert } from './gpsAlertService.js';
import { createNotificationForRoles } from './notificationService.js';

type SendTelegramFn = typeof trackerSendTelegram;
let sendTelegram: SendTelegramFn = trackerSendTelegram;

export function setSendTelegramForTest(fn: SendTelegramFn | null): void {
  sendTelegram = fn ?? trackerSendTelegram;
}

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
  durationSeconds: number;
}

// ── Mutable current interval (initialised from env, but can be
// changed at runtime via updateInterval()) ──────────────────────

let currentIntervalSeconds = SYNC_INTERVAL_SECONDS;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shouldSendTelegram(eventType: string): boolean {
  return [
    'IGNITION_ON',
    'IGNITION_OFF',
    'LOCATION_UPDATE',
    'IDLING_TOO_LONG',
    'SPEEDING',
    'MOTION_STARTED',
    'LOW_FUEL',
  ].includes(eventType);
}

function initialTelegramStatus(eventType: string): 'skipped' | null {
  return shouldSendTelegram(eventType) ? null : 'skipped';
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

const EVENT_TYPE = {
  IGNITION_ON: 'IGNITION_ON',
  IGNITION_OFF: 'IGNITION_OFF',
  LOCATION_UPDATE: 'LOCATION_UPDATE',
  IDLING: 'IDLING_TOO_LONG',
  MOTION_STARTED: 'MOTION_STARTED',
  SPEEDING: 'SPEEDING',
  LOW_FUEL: 'LOW_FUEL',
} as const;

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
    default:
      result = null;
      break;
  }
  if (sourceEventType !== result) {
    console.log('[EVENT NORMALIZED]', { incoming: sourceEventType, saved: result });
  }
  return result;
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
 */
export function startScheduler(): void {
  if (state.intervalId) {
    console.log('[scheduler] Already running — skipping start');
    return;
  }

  if (currentIntervalSeconds < 10) {
    console.warn(`[scheduler] currentIntervalSeconds (${currentIntervalSeconds}) is too low; clamping to 10s`);
  }

  const intervalMs = Math.max(currentIntervalSeconds, 10) * 1000;

  state.running = true;
  state.startedAt = new Date().toISOString();
  state.paused = false;

  console.log(`[scheduler] Starting fleet sync every ${Math.max(currentIntervalSeconds, 10)}s`);

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
 * Pause the scheduler temporarily.
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
 * Export runCycle so it can be called directly by the cron endpoint.
 */
export { runCycle };

// ── Helper: Update gps_vehicle_state for ignition events ──────

async function updateVehicleIgnitionState(
  vehicleId: string,
  ignitionOn: boolean,
  activeTripId: string | null,
): Promise<void> {
  await ensureVehicleStateSchema();
  const pool = getPool();
  if (ignitionOn) {
    await pool.query(
      `INSERT INTO gps_vehicle_state (vehicle_id, ignition_state, last_confirmed_ignition, active_trip_id, updated_at, version)
       VALUES ($1, 'ON', true, $2, now(), 1)
       ON CONFLICT (vehicle_id) DO UPDATE SET
         ignition_state = 'ON',
         last_confirmed_ignition = true,
         active_trip_id = COALESCE($2, gps_vehicle_state.active_trip_id),
         updated_at = now(),
         version = gps_vehicle_state.version + 1`,
      [vehicleId, activeTripId],
    );
  } else {
    await pool.query(
      `UPDATE gps_vehicle_state
          SET ignition_state = 'OFF',
              last_confirmed_ignition = false,
              active_trip_id = NULL,
              updated_at = now(),
              version = version + 1
        WHERE vehicle_id = $1`,
      [vehicleId],
    );
  }
}

// ── Helper: Load last known ignition state ─────────────────────

async function loadLastIgnitionState(vehicleId: string): Promise<{
  lastConfirmedIgnition: boolean;
  activeTripId: string | null;
}> {
  await ensureVehicleStateSchema();
  const pool = getPool();
  const result = await pool.query<{ last_confirmed_ignition: boolean; active_trip_id: string | null }>(
    `SELECT last_confirmed_ignition, active_trip_id
       FROM gps_vehicle_state
      WHERE vehicle_id = $1`,
    [vehicleId],
  );
  if (result.rows.length === 0) {
    return { lastConfirmedIgnition: false, activeTripId: null };
  }
  return {
    lastConfirmedIgnition: result.rows[0].last_confirmed_ignition,
    activeTripId: result.rows[0].active_trip_id,
  };
}

// ── Helper: Reload full vehicle state from DB ──────────────────

async function reloadVehicleState(vehicleId: string): Promise<{
  lastConfirmedIgnition: boolean;
  activeTripId: string | null;
  version: number;
}> {
  await ensureVehicleStateSchema();
  const pool = getPool();
  const result = await pool.query<{ last_confirmed_ignition: boolean; active_trip_id: string | null; version: number }>(
    `SELECT last_confirmed_ignition, active_trip_id, version
       FROM gps_vehicle_state
      WHERE vehicle_id = $1`,
    [vehicleId],
  );
  if (result.rows.length === 0) {
    return { lastConfirmedIgnition: false, activeTripId: null, version: 0 };
  }
  return {
    lastConfirmedIgnition: result.rows[0].last_confirmed_ignition,
    activeTripId: result.rows[0].active_trip_id,
    version: result.rows[0].version,
  };
}

// ── Helper: Send Telegram for a saved telemetry record ─────────

async function sendTelegramForTelemetry(
  telemetryId: string,
  message: string,
): Promise<{ sent: boolean; error: string | null }> {
  const attemptedAt = new Date().toISOString();
  try {
    const tg = await sendTelegram(message);
    if (tg?.ok) {
      await updateTelemetryTelegramDelivery(telemetryId, 'sent', null, attemptedAt);
      return { sent: true, error: null };
    }
    const error = tg?.error ?? 'telegram_not_ok';
    await updateTelemetryTelegramDelivery(telemetryId, 'failed', error, attemptedAt);
    return { sent: false, error };
  } catch (err) {
    const error = errorMessage(err);
    await updateTelemetryTelegramDelivery(telemetryId, 'failed', error, attemptedAt);
    return { sent: false, error };
  }
}

// Helper: Resolve pre-formatted telegram message from tracker emittedAlerts.

function resolveMessageFromEmitted(
  emittedAlerts: Array<{ vehicleId?: string; eventType?: string; message?: string }>,
  vehicleId: string,
  eventType: string,
  plateNumber: string,
  fallback?: string,
): string | null {
  const match = emittedAlerts.find(
    (a) => a.vehicleId === vehicleId && a.eventType === eventType && a.message,
  );
  return (match?.message as string | undefined) ?? fallback ?? null;
}

// ── Helper: Save telemetry and optionally send Telegram ────────

async function saveTelemetryAndSendTelegram(
  eventType: string,
  vehicleId: string,
  plateNumber: string,
  activeTripId: string | null,
  latitude: number | null,
  longitude: number | null,
  speedKmh: number,
  fuelLiters: number | null,
  ignition: boolean,
  locationName: string | null,
  recordedAt: string,
  telegramMessage: string | null,
  emittedAlerts: Array<{ vehicleId?: string; eventType?: string; message?: string }>,
  idlingThresholdMinutes?: number | null,
): Promise<{ saved: boolean; telemetryId: string | null; telegramSent: boolean; telegramError: string | null }> {
  const resolvedMessage = telegramMessage ?? resolveMessageFromEmitted(emittedAlerts, vehicleId, eventType, plateNumber);
  if (shouldSendTelegram(eventType) && !resolvedMessage) {
    throw new Error(`Cannot insert sendable telemetry without message vehicle=${vehicleId} event=${eventType}`);
  }

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
    telegramMessage: resolvedMessage,
    telegramStatus: initialTelegramStatus(eventType),
    idlingThresholdMinutes: idlingThresholdMinutes ?? null,
  });

  if (!savedTelemetry.id) {
    return { saved: false, telemetryId: null, telegramSent: false, telegramError: null };
  }

  // Telegram delivery: attempt to send if message is present and event is sendable,
  // regardless of whether the row was newly inserted or found as a duplicate.
  if (resolvedMessage && shouldSendTelegram(eventType)) {
    const tgResult = await sendTelegramForTelemetry(savedTelemetry.id, resolvedMessage);
    return { saved: savedTelemetry.inserted, telemetryId: savedTelemetry.id, telegramSent: tgResult.sent, telegramError: tgResult.error };
  }

  // No message to send - mark as skipped
  if (savedTelemetry.id && !resolvedMessage) {
    await updateTelemetryTelegramDelivery(savedTelemetry.id, 'skipped', null, new Date().toISOString());
  }
  return { saved: savedTelemetry.inserted, telemetryId: savedTelemetry.id, telegramSent: false, telegramError: null };
}

// ── Helper: Check idling dedup ─────────────────────────────────
// First alert at 10 minutes, then every 30 minutes after that.

async function shouldSaveIdlingAlert(vehicleId: string, activeTripId: string, thresholdMinutes: number): Promise<boolean> {
  const lastThreshold = await getLastIdlingThreshold(vehicleId, activeTripId);
  if (lastThreshold === 0) {
    return thresholdMinutes >= 10;
  }
  return thresholdMinutes >= lastThreshold + 30;
}

// ── Internal ───────────────────────────────────────────────────

function skippedCycleSummary(skipReason: string): SchedulerCycleSummary {
  return {
    skipped: true,
    skipReason,
    vehiclesProcessed: 0,
    telemetrySaved: 0,
    telemetrySkipped: 0,
    telegramSent: 0,
    telegramFailed: 0,
    durationSeconds: 0,
  };
}

async function runCycle(): Promise<SchedulerCycleSummary> {
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
    const result = await syncFleetAndAlert({
      resolveVehicleId: (plateNumber: string) => findVehicleByPlate(plateNumber),
      dispatchAlerts: false,
    });

    console.log('[scheduler-debug]', {
      vehicles: result.data?.length ?? 0,
      emittedAlerts: result.emittedAlerts?.length ?? 0,
    });

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

    let telemetrySaved = 0;
    let telemetrySkipped = 0;
    let telegramSent = 0;
    let telegramFailed = 0;

    const vehicles = result.data as unknown as Array<{
      id: string;
      plateNumber?: string;
      name?: string;
      latitude?: number | null;
      longitude?: number | null;
      location?: string | null;
      eventTime?: string;
      speed?: number;
      fuel?: number | null;
      ignition?: boolean;
      driver?: string | null;
      toNumber?: string | null;
    }> | undefined;

    if (vehicles && vehicles.length > 0) {
      for (const v of vehicles) {
        try {
          const vehicleId = String(v.id ?? '');
          if (!vehicleId) {
            telemetrySkipped += 1;
            continue;
          }

          const currentIgnition = v.ignition === true;
          const plateNumber = v.plateNumber || String(v.name ?? '').split(' ')[0] || vehicleId;
          const latitude = v.latitude ?? null;
          const longitude = v.longitude ?? null;
          const locationName = v.location ?? null;
          const speedKmh = Number(v.speed ?? 0);
          const fuelLiters = v.fuel ?? null;
          const recordedAt = v.eventTime || new Date().toISOString();

          const previousState = await loadVehicleState(vehicleId);
          let action: string;

          // BOOTSTRAP CASE: no previous state
          if (!previousState.lastConfirmedIgnitionAt && previousState.version === 0) {
            const bootstrapTripId = currentIgnition ? randomUUID() : null;
            await upsertVehicleState({
              vehicleId,
              ignitionState: currentIgnition ? 'ON' : 'OFF',
              lastConfirmedIgnition: currentIgnition,
              lastConfirmedIgnitionAt: currentIgnition ? recordedAt : null,
              activeTripId: bootstrapTripId,
              lastPacketTime: recordedAt,
              lastSpeed: speedKmh,
              lastLatitude: latitude,
              lastLongitude: longitude,
              lastLocationName: locationName,
              lastEventType: 'BOOTSTRAP',
            });
            action = 'bootstrap';
            telemetrySkipped += 1;
            console.log('[scheduler-state]', {
              plateNumber,
              vehicleId,
              currentIgnition,
              wasOn: false,
              activeTripId: bootstrapTripId,
              action,
            });
            continue;
          }

          const wasOn = previousState.lastConfirmedIgnition === true;
          const activeTripId = previousState.activeTripId;
          action = 'none';

          // OFF -> ON
          if (!wasOn && currentIgnition) {
            action = 'ignition_on';
            const newTripId = randomUUID();

            // Reload from DB to handle race conditions
            const reloadedState = await reloadVehicleState(vehicleId);
            if (reloadedState.lastConfirmedIgnition && reloadedState.activeTripId) {
              // Another process already confirmed ignition - update instead
              action = 'location_update';
              const saveResult = await saveTelemetryAndSendTelegram(
                EVENT_TYPE.LOCATION_UPDATE, vehicleId, plateNumber, reloadedState.activeTripId,
                latitude, longitude, speedKmh, fuelLiters, true, locationName, recordedAt, null, emittedAlerts ?? [],
              );
              if (saveResult.saved) {
                telemetrySaved += 1;
                if (saveResult.telegramSent) telegramSent += 1;
                if (saveResult.telegramError) telegramFailed += 1;
              } else {
                telemetrySkipped += 1;
              }
              console.log('[scheduler-state]', {
                plateNumber,
                vehicleId,
                currentIgnition,
                wasOn: true,
                activeTripId: reloadedState.activeTripId,
                action,
              });
              continue;
            }

            const saveResult = await saveTelemetryAndSendTelegram(
              EVENT_TYPE.IGNITION_ON, vehicleId, plateNumber, newTripId,
              latitude, longitude, speedKmh, fuelLiters, true, locationName, recordedAt, null, emittedAlerts ?? [],
            );
            if (!saveResult.saved) {
              console.error(`[scheduler-state] CRITICAL: IGNITION_ON insert failed vehicle=${vehicleId}`);
              throw new Error(`Failed to insert IGNITION_ON telemetry for vehicle=${vehicleId}`);
            }

            await upsertVehicleState({
              vehicleId,
              ignitionState: 'ON',
              lastConfirmedIgnition: true,
              lastConfirmedIgnitionAt: recordedAt,
              activeTripId: newTripId,
              lastPacketTime: recordedAt,
              lastSpeed: speedKmh,
              lastLatitude: latitude,
              lastLongitude: longitude,
              lastLocationName: locationName,
              lastEventType: 'IGNITION_ON',
            });

            // Verify the state was saved correctly
            const verifyState = await reloadVehicleState(vehicleId);
            if (!verifyState.activeTripId || verifyState.activeTripId !== newTripId) {
              console.error(`[scheduler-state] CRITICAL: active_trip_id not saved after IGNITION_ON vehicle=${vehicleId} expected=${newTripId} actual=${verifyState.activeTripId}`);
              throw new Error(`Failed to save active_trip_id for IGNITION_ON vehicle=${vehicleId}`);
            }

            if (saveResult.telegramSent) telegramSent += 1;
            if (saveResult.telegramError) telegramFailed += 1;
            telemetrySaved += 1;
            console.log('[scheduler-state]', {
              plateNumber,
              vehicleId,
              currentIgnition,
              wasOn,
              activeTripId: newTripId,
              action,
            });
            continue;
          }

          // ON -> ON
          if (wasOn && currentIgnition) {
            action = 'location_update';
            if (!activeTripId) {
              // Repair bad state without creating fake ignition
              const repairedTripId = randomUUID();
              await upsertVehicleState({
                vehicleId,
                ignitionState: 'ON',
                lastConfirmedIgnition: true,
                lastConfirmedIgnitionAt: previousState.lastConfirmedIgnitionAt ?? recordedAt,
                activeTripId: repairedTripId,
                lastPacketTime: recordedAt,
                lastSpeed: speedKmh,
                lastLatitude: latitude,
                lastLongitude: longitude,
                lastLocationName: locationName,
                lastEventType: 'STATE_REPAIR',
              });
              action = 'state_repair';
              telemetrySkipped += 1;
              console.log('[scheduler-state]', {
                plateNumber,
                vehicleId,
                currentIgnition,
                wasOn,
                activeTripId: null,
                action,
              });
              continue;
            }

            const saveResult = await saveTelemetryAndSendTelegram(
              EVENT_TYPE.LOCATION_UPDATE, vehicleId, plateNumber, activeTripId,
              latitude, longitude, speedKmh, fuelLiters, true, locationName, recordedAt, null, emittedAlerts ?? [],
            );
            if (saveResult.saved) {
              if (saveResult.telegramSent) telegramSent += 1;
              if (saveResult.telegramError) telegramFailed += 1;
              telemetrySaved += 1;
            } else {
              telemetrySkipped += 1;
            }
            console.log('[scheduler-state]', {
              plateNumber,
              vehicleId,
              currentIgnition,
              wasOn,
              activeTripId,
              action,
            });
            continue;
          }

          // ON -> OFF
          if (wasOn && !currentIgnition) {
            action = 'ignition_off';
            if (!activeTripId) {
              // Fake OFF or broken state
              await upsertVehicleState({
                vehicleId,
                ignitionState: 'OFF',
                lastConfirmedIgnition: false,
                lastConfirmedIgnitionAt: recordedAt,
                activeTripId: null,
                lastPacketTime: recordedAt,
                lastSpeed: speedKmh,
                lastLatitude: latitude,
                lastLongitude: longitude,
                lastLocationName: locationName,
                lastEventType: 'FAKE_IGNITION_OFF_SKIPPED',
              });
              action = 'fake_off_skipped';
              telemetrySkipped += 1;
              console.log('[scheduler-state]', {
                plateNumber,
                vehicleId,
                currentIgnition,
                wasOn,
                activeTripId: null,
                action,
              });
              continue;
            }

            const saveResult = await saveTelemetryAndSendTelegram(
              EVENT_TYPE.IGNITION_OFF, vehicleId, plateNumber, activeTripId,
              latitude, longitude, speedKmh, fuelLiters, false, locationName, recordedAt, null, emittedAlerts ?? [],
            );
            if (!saveResult.saved) {
              console.error(`[scheduler-state] CRITICAL: IGNITION_OFF insert failed vehicle=${vehicleId}`);
              throw new Error(`Failed to insert IGNITION_OFF telemetry for vehicle=${vehicleId}`);
            }

            await upsertVehicleState({
              vehicleId,
              ignitionState: 'OFF',
              lastConfirmedIgnition: false,
              lastConfirmedIgnitionAt: recordedAt,
              activeTripId: null,
              lastPacketTime: recordedAt,
              lastSpeed: speedKmh,
              lastLatitude: latitude,
              lastLongitude: longitude,
              lastLocationName: locationName,
              lastEventType: 'IGNITION_OFF',
            });

            // Verify state was updated
            const offVerifyState = await reloadVehicleState(vehicleId);
            if (offVerifyState.lastConfirmedIgnition || offVerifyState.activeTripId) {
              console.error(`[scheduler-state] CRITICAL: IGNITION_OFF state not saved vehicle=${vehicleId} ignition=${offVerifyState.lastConfirmedIgnition} trip=${offVerifyState.activeTripId}`);
              throw new Error(`Failed to save IGNITION_OFF state for vehicle=${vehicleId}`);
            }

            if (saveResult.telegramSent) telegramSent += 1;
            if (saveResult.telegramError) telegramFailed += 1;
            telemetrySaved += 1;
            console.log('[scheduler-state]', {
              plateNumber,
              vehicleId,
              currentIgnition,
              wasOn,
              activeTripId,
              action,
            });
            continue;
          }

          // OFF -> OFF
          if (!wasOn && !currentIgnition) {
            action = 'off_state_update';
            await upsertVehicleState({
              vehicleId,
              ignitionState: 'OFF',
              lastConfirmedIgnition: false,
              lastConfirmedIgnitionAt: null,
              activeTripId: null,
              lastPacketTime: recordedAt,
              lastSpeed: speedKmh,
              lastLatitude: latitude,
              lastLongitude: longitude,
              lastLocationName: locationName,
              lastEventType: 'OFF_STATE_UPDATE',
            });
            telemetrySkipped += 1;
            console.log('[scheduler-state]', {
              plateNumber,
              vehicleId,
              currentIgnition,
              wasOn,
              activeTripId: null,
              action,
            });
            continue;
          }
        } catch (err) {
          console.error(`[scheduler] Failed to process vehicle ${v.id}:`, errorMessage(err));
          telemetrySkipped += 1;
        }
      }
    }

    // ── Step 3: Process emitted alerts (non-ignition only) ──────
    if (emittedAlerts && emittedAlerts.length > 0) {
      for (const alert of emittedAlerts) {
        try {
          const vehicleId = alert.vehicleId;
          if (!vehicleId) { telemetrySkipped += 1; continue; }

          const rawEventType = alert.eventType;
          const finalEventType = canonicalEventType(rawEventType);
          if (!rawEventType || !finalEventType) { telemetrySkipped += 1; continue; }

          // Do NOT depend on emittedAlerts for ignition events.
          if (finalEventType === EVENT_TYPE.IGNITION_ON || finalEventType === EVENT_TYPE.IGNITION_OFF) {
            continue;
          }

          const plateNumber = alert.plateNumber || '';
          const latitude = alert.latitude ?? null;
          const longitude = alert.longitude ?? null;
          const speedKmh = Number(alert.speed || 0);
          const fuelLiters = alert.fuel ?? null;
          const ignition = alert.ignition;
          const locationName = alert.location || null;
          const recordedAt = alert.timestamp || new Date().toISOString();
          const telegramMessage = alert.message || null;

          // For non-ignition events, load vehicle state
          const vs = await loadVehicleState(vehicleId);
          const activeTripId = vs.activeTripId;

          // IDLING_TOO_LONG
          if (finalEventType === EVENT_TYPE.IDLING) {
            if (!activeTripId) {
              telemetrySkipped += 1;
              console.log(`[scheduler] IDLING SKIPPED vehicle=${vehicleId} reason=no_active_trip`);
              continue;
            }

            const thresholdMinutes = alert.idlingThresholdReached;
            if (!thresholdMinutes || thresholdMinutes < 10) {
              telemetrySkipped += 1;
              console.log(`[scheduler] IDLING SKIPPED vehicle=${vehicleId} reason=invalid_threshold`);
              continue;
            }

            const idlingStartedAt = alert.idlingStartedAt || new Date().toISOString();
            const txResult = await handleIdlingAlertInTransaction({
              vehicleId,
              plateNumber,
              activeTripId,
              latitude,
              longitude,
              speedKmh,
              fuelLiters: fuelLiters ?? null,
              ignition,
              locationName,
              recordedAt,
              idlingStartedAt,
              thresholdMinutes,
              telegramMessage: telegramMessage || '',
            });
            if (txResult.skipped) {
              telemetrySkipped += 1;
              console.log(`[scheduler] IDLING SKIPPED vehicle=${vehicleId} reason=${txResult.reason}`);
              continue;
            }

            telemetrySaved += 1;
            if (txResult.telegramSent) telegramSent += 1;
            if (txResult.telegramError) telegramFailed += 1;
            console.log(`[scheduler] IDLING SAVED vehicle=${vehicleId} threshold=${thresholdMinutes}min`);

            // Create notification for all roles when idling alert is saved
            if (txResult.telemetryId) {
              try {
                await createNotificationForRoles(['SUPERADMIN', 'ADMIN', 'DISPATCHER', 'HR', 'VIEWER'], {
                  type: 'gps_alert',
                  title: 'Idling Alert',
                  message: `Vehicle ${plateNumber} has been idling for ${thresholdMinutes} minutes.`,
                  targetUrl: '/gps-logs',
                  targetTab: 'alerts',
                  entityId: txResult.telemetryId,
                });
              } catch (notifError) {
                console.error(`[scheduler] Failed to create idling notification vehicle=${vehicleId}:`, (notifError as Error).message);
              }
            }
            continue;
          }

          // LOCATION_UPDATE / MOTION_STARTED
          if (finalEventType === EVENT_TYPE.LOCATION_UPDATE || finalEventType === EVENT_TYPE.MOTION_STARTED) {
            if (!activeTripId) {
              telemetrySkipped += 1;
              console.log(`[scheduler] ${finalEventType} SKIPPED vehicle=${vehicleId} reason=no_active_trip`);
              continue;
            }

            if (!telegramMessage) {
              telemetrySkipped += 1;
              console.log(`[scheduler] ${finalEventType} SKIPPED vehicle=${vehicleId} reason=no_telegram_message`);
              continue;
            }

            const saveResult = await saveTelemetryAndSendTelegram(
              finalEventType, vehicleId, plateNumber, activeTripId,
              latitude, longitude, speedKmh, fuelLiters, ignition, locationName, recordedAt, telegramMessage, emittedAlerts ?? [],
            );
            if (saveResult.saved) {
              telemetrySaved += 1;
              if (saveResult.telegramSent) telegramSent += 1;
              if (saveResult.telegramError) telegramFailed += 1;
              console.log(`[scheduler] ${finalEventType} SAVED vehicle=${vehicleId}`);
            } else {
              telemetrySkipped += 1;
              console.log(`[scheduler] ${finalEventType} SKIPPED vehicle=${vehicleId}`);
            }
            continue;
          }

          // SPEEDING
          if (finalEventType === EVENT_TYPE.SPEEDING) {
            if (!ignition && speedKmh <= 0) {
              telemetrySkipped += 1;
              console.log(`[scheduler] SPEEDING SKIPPED vehicle=${vehicleId} reason=no_ignition_no_speed`);
              continue;
            }

            if (!telegramMessage) {
              telemetrySkipped += 1;
              console.log(`[scheduler] SPEEDING SKIPPED vehicle=${vehicleId} reason=no_telegram_message`);
              continue;
            }

            const saveResult = await saveTelemetryAndSendTelegram(
              EVENT_TYPE.SPEEDING, vehicleId, plateNumber, activeTripId,
              latitude, longitude, speedKmh, fuelLiters, ignition, locationName, recordedAt, telegramMessage, emittedAlerts ?? [],
            );
            if (saveResult.saved) {
              telemetrySaved += 1;
              if (saveResult.telegramSent) telegramSent += 1;
              if (saveResult.telegramError) telegramFailed += 1;
              console.log(`[scheduler] SPEEDING SAVED vehicle=${vehicleId}`);
            } else {
              telemetrySkipped += 1;
              console.log(`[scheduler] SPEEDING SKIPPED vehicle=${vehicleId}`);
            }

            // Create notification for all roles when speeding alert is saved
            if (saveResult.saved && saveResult.telemetryId) {
              try {
                await createNotificationForRoles(['SUPERADMIN', 'ADMIN', 'DISPATCHER', 'HR', 'VIEWER'], {
                  type: 'gps_alert',
                  title: 'Speeding Alert',
                  message: `Vehicle ${plateNumber} is speeding at ${speedKmh} km/h.`,
                  targetUrl: '/gps-logs',
                  targetTab: 'alerts',
                  entityId: saveResult.telemetryId,
                });
              } catch (notifError) {
                console.error(`[scheduler] Failed to create speeding notification vehicle=${vehicleId}:`, (notifError as Error).message);
              }
            }
            continue;
          }

          // LOW_FUEL
          if (finalEventType === EVENT_TYPE.LOW_FUEL) {
            if (!telegramMessage) {
              telemetrySkipped += 1;
              console.log(`[scheduler] LOW_FUEL SKIPPED vehicle=${vehicleId} reason=no_telegram_message`);
              continue;
            }

            const saveResult = await saveTelemetryAndSendTelegram(
              EVENT_TYPE.LOW_FUEL, vehicleId, plateNumber, activeTripId,
              latitude, longitude, speedKmh, fuelLiters, ignition, locationName, recordedAt, telegramMessage, emittedAlerts ?? [],
            );
            if (saveResult.saved) {
              telemetrySaved += 1;
              if (saveResult.telegramSent) telegramSent += 1;
              if (saveResult.telegramError) telegramFailed += 1;
              console.log(`[scheduler] LOW_FUEL SAVED vehicle=${vehicleId}`);
            } else {
              telemetrySkipped += 1;
              console.log(`[scheduler] LOW_FUEL SKIPPED vehicle=${vehicleId}`);
            }

            // Create notification for all roles when low fuel alert is saved
            if (saveResult.saved && saveResult.telemetryId) {
              try {
                await createNotificationForRoles(['SUPERADMIN', 'ADMIN', 'DISPATCHER', 'HR', 'VIEWER'], {
                  type: 'gps_alert',
                  title: 'Low Fuel Alert',
                  message: `Vehicle ${plateNumber} has low fuel: ${fuelLiters} liters.`,
                  targetUrl: '/gps-logs',
                  targetTab: 'alerts',
                  entityId: saveResult.telemetryId,
                });
              } catch (notifError) {
                console.error(`[scheduler] Failed to create low fuel notification vehicle=${vehicleId}:`, (notifError as Error).message);
              }
            }
            continue;
          }

          // Unknown event type
          telemetrySkipped += 1;
          console.log(`[scheduler] Unknown event type ${finalEventType} vehicle=${vehicleId}`);
        } catch (err) {
          console.error(`[scheduler] Failed to process alert for ${alert.vehicleId}:`, errorMessage(err));
          telemetrySkipped += 1;
        }
      }
    }

    const duration = (Date.now() - cycleStart) / 1000;
    state.lastRunDuration = duration;
    state.lastRunAt = new Date().toISOString();
    state.cyclesCompleted += 1;

    const summary = [
      `vehicles=${result.data?.length ?? 0}`,
      `telemetry_saved=${telemetrySaved}`,
      `telemetry_skipped=${telemetrySkipped}`,
      `telegram_sent=${telegramSent}`,
      `telegram_failed=${telegramFailed}`,
      `duration=${duration.toFixed(2)}s`,
    ].join(', ');

    state.lastResult = `ok: ${summary}`;
    console.log(`[scheduler] Cycle ${cycleLabel} completed — ${summary}`);

    return {
      skipped: false,
      skipReason: null,
      vehiclesProcessed: Number(result.data?.length ?? 0),
      telemetrySaved,
      telemetrySkipped,
      telegramSent,
      telegramFailed,
      durationSeconds: duration,
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
    cycleLock = false;
  }
}

// ── Helper: Placeholder for telegram dispatch ──────────────────

async function sendTelegramForSavedTelemetry(vehicleId: string): Promise<void> {
  console.log(`[scheduler] telegram dispatched via saveTelemetryAndSendTelegram for vehicle=${vehicleId}`);
}

// ── Exported Helpers (kept for backward compatibility and tests) ──

export function idlingMilestoneForMinutes(idleMinutes: number): number | null {
  const reached = IDLE_ALERT_THRESHOLDS_MINUTES.filter((threshold) => idleMinutes >= threshold);
  return reached.length ? reached[reached.length - 1] : null;
}

export function hasHigherPriorityTelemetryEventForSnapshot(
  alerts: Array<{ vehicleId?: string | null; eventType?: string | null }>,
  vehicleId: string,
  currentEventType: string,
): boolean {
  return alerts.some((alert) => {
    if (alert.vehicleId !== vehicleId) return false;
    const candidateEventType = alert.eventType ? canonicalEventType(alert.eventType) : null;
    if (currentEventType === 'IDLING_TOO_LONG') {
      return candidateEventType === 'IGNITION_ON' || candidateEventType === 'MOTION_STARTED';
    }
    if (currentEventType === 'LOCATION_UPDATE') {
      return candidateEventType === 'IGNITION_ON' ||
        candidateEventType === 'MOTION_STARTED' ||
        candidateEventType === 'SPEEDING';
    }
    return false;
  });
}

export function shouldPersistMotionStartedFromPreviousState(
  previous: { speedKmh: number; eventType: string } | null | undefined,
  activeIdlingSession: { activeTripId: string } | null | undefined,
  currentSpeedKmh: number,
  currentIgnition: boolean,
): boolean {
  if (!currentIgnition || currentSpeedKmh <= 0) return false;

  const previousEventType = previous?.eventType ? canonicalEventType(previous.eventType) ?? previous.eventType : null;
  const previousSpeed = Number(previous?.speedKmh ?? 0);

  if (
    previousEventType === 'MOTION_STARTED' ||
    (previousEventType === 'LOCATION_UPDATE' && previousSpeed > 0)
  ) {
    return false;
  }

  return previousSpeed <= 0 ||
    previousEventType === 'IDLING_TOO_LONG' ||
    previousEventType === 'IDLING' ||
    previousEventType === 'IGNITION_ON' ||
    Boolean(activeIdlingSession?.activeTripId);
}

// ── Idling dedup helpers ──────────────────────────────────────

let idlingSchemaReady = false;

async function ensureIdlingDedupSchema(): Promise<void> {
  if (idlingSchemaReady) return;
  const pool = getPool();
  await pool.query(`
    ALTER TABLE gps_idling_dedup ALTER COLUMN threshold_minutes DROP NOT NULL;
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
    DROP INDEX IF EXISTS idx_gps_idling_dedup_active_trip;
    CREATE INDEX IF NOT EXISTS idx_gps_idling_dedup_active_trip
      ON gps_idling_dedup (vehicle_id, active_trip_id, COALESCE(last_alerted_duration_minutes, threshold_minutes, 0) DESC)
      WHERE is_active = true;
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

export async function persistIdlingAlertIfNewThreshold(
  vehicleId: string,
  activeTripId: string,
  thresholdMinutes: number,
): Promise<boolean> {
  await ensureIdlingDedupSchema();
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lockResult = await client.query<{ last_alerted_duration_minutes: number | null }>(
      `SELECT last_alerted_duration_minutes
         FROM gps_idling_dedup
        WHERE vehicle_id = $1
          AND active_trip_id = $2
          AND is_active = true
        ORDER BY COALESCE(last_alerted_duration_minutes, threshold_minutes, 0) DESC
        LIMIT 1
        FOR UPDATE`,
      [vehicleId, activeTripId],
    );
    const lockedRow = lockResult.rows[0];
    const currentAlerted = Number(lockedRow?.last_alerted_duration_minutes ?? 0);
    if (currentAlerted >= thresholdMinutes) {
      await client.query('COMMIT');
      return false;
    }
    await client.query(
      `INSERT INTO gps_idling_dedup
         (vehicle_id, active_trip_id, threshold_minutes, last_alerted_duration_minutes, last_alerted_at, is_active)
       VALUES ($1, $2, $3, $3, now(), true)
       ON CONFLICT (vehicle_id, active_trip_id) WHERE is_active = true
       DO UPDATE SET
         last_alerted_duration_minutes = EXCLUDED.last_alerted_duration_minutes,
         last_alerted_at = now(),
         threshold_minutes = EXCLUDED.threshold_minutes`,
      [vehicleId, activeTripId, thresholdMinutes],
    );
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[idling-dedup] Atomic persist failed vehicle=${vehicleId} trip=${activeTripId}:`, (err as Error).message);
    throw err;
  } finally {
    client.release();
  }
}

export async function markIdlingAlertDb(vehicleId: string, activeTripId: string, idlingStartedAt: string, thresholdMinutes: number): Promise<void> {
  await ensureIdlingDedupSchema();
  const pool = getPool();
  await pool.query(
    `INSERT INTO gps_idling_dedup
       (vehicle_id, active_trip_id, threshold_minutes, idling_started_at, last_alerted_duration_minutes, last_alerted_at, is_active)
     VALUES ($1, $2, $3, $4, $3, now(), true)
     ON CONFLICT (vehicle_id, active_trip_id) WHERE is_active = true
     DO UPDATE SET
       last_alerted_duration_minutes = EXCLUDED.last_alerted_duration_minutes,
       last_alerted_at = now(),
       threshold_minutes = EXCLUDED.threshold_minutes`,
    [vehicleId, activeTripId, thresholdMinutes, idlingStartedAt],
  );
}

export async function closeIdlingDedupDb(vehicleId: string, activeTripId?: string | null): Promise<void> {
  await ensureIdlingDedupSchema();
  const pool = getPool();
  if (activeTripId) {
    await pool.query(
      `UPDATE gps_idling_dedup
          SET is_active = false, ended_at = now()
        WHERE vehicle_id = $1
          AND active_trip_id = $2
          AND is_active = true`,
      [vehicleId, activeTripId],
    );
    return;
  }
  await pool.query(
    `UPDATE gps_idling_dedup
        SET is_active = false, ended_at = now()
      WHERE vehicle_id = $1
        AND is_active = true`,
    [vehicleId],
  );
}

export interface HandleIdlingAlertTxParams {
  vehicleId: string;
  plateNumber: string;
  activeTripId: string;
  latitude: number | null;
  longitude: number | null;
  speedKmh: number;
  fuelLiters: number | null;
  ignition: boolean;
  locationName: string | null;
  recordedAt: string;
  idlingStartedAt: string;
  thresholdMinutes: number;
  telegramMessage: string;
}

export interface HandleIdlingAlertTxResult {
  skipped: boolean;
  reason?: 'already_alerted' | 'telemetry_exists';
  telemetryId: string | null;
  telegramSent: boolean;
  telegramError: string | null;
}

export async function handleIdlingAlertInTransaction(params: HandleIdlingAlertTxParams): Promise<HandleIdlingAlertTxResult> {
  await ensureIdlingDedupSchema();
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lockResult = await client.query<{ last_alerted_duration_minutes: number | null }>(
      `SELECT last_alerted_duration_minutes
         FROM gps_idling_dedup
        WHERE vehicle_id = $1
          AND active_trip_id = $2
          AND is_active = true
        ORDER BY COALESCE(last_alerted_duration_minutes, threshold_minutes, 0) DESC
        LIMIT 1
        FOR UPDATE`,
      [params.vehicleId, params.activeTripId],
    );
    const currentAlerted = Number(lockResult.rows[0]?.last_alerted_duration_minutes ?? 0);
    if (currentAlerted >= params.thresholdMinutes) {
      await client.query('COMMIT');
      return { skipped: true, reason: 'already_alerted', telemetryId: null, telegramSent: false, telegramError: null };
    }
    const dupResult = await client.query<{ id: string }>(
      `SELECT id FROM gps_telemetry
        WHERE vehicle_id = $1
          AND active_trip_id = $2
          AND event_type = 'IDLING_TOO_LONG'
          AND idling_threshold_minutes = $3
        LIMIT 1`,
      [params.vehicleId, params.activeTripId, params.thresholdMinutes],
    );
    if (dupResult.rows.length > 0) {
      await client.query('COMMIT');
      return { skipped: true, reason: 'telemetry_exists', telemetryId: dupResult.rows[0].id, telegramSent: false, telegramError: null };
    }
    await client.query(
      `INSERT INTO gps_idling_dedup
         (vehicle_id, active_trip_id, threshold_minutes, last_alerted_duration_minutes, last_alerted_at, is_active)
       VALUES ($1, $2, $3, $3, now(), true)
       ON CONFLICT (vehicle_id, active_trip_id) WHERE is_active = true
       DO UPDATE SET
         last_alerted_duration_minutes = EXCLUDED.last_alerted_duration_minutes,
         last_alerted_at = now(),
         threshold_minutes = EXCLUDED.threshold_minutes`,
      [params.vehicleId, params.activeTripId, params.thresholdMinutes],
    );
    const telemResult = await client.query<{ id: string }>(
      `INSERT INTO gps_telemetry
         (vehicle_id, plate_number, event_type, latitude, longitude, speed_kmh, fuel_liters,
          ignition, location_name, recorded_at, active_trip_id, idling_threshold_minutes, telegram_message,
          telegram_status)
       VALUES ($1, $2, 'IDLING_TOO_LONG', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL)
       RETURNING id`,
      [
        params.vehicleId,
        params.plateNumber,
        params.latitude,
        params.longitude,
        params.speedKmh,
        params.fuelLiters,
        params.ignition,
        params.locationName,
        params.recordedAt,
        params.activeTripId,
        params.thresholdMinutes,
        params.telegramMessage,
      ],
    );
    const telemetryId = telemResult.rows[0]?.id ?? null;
    let telegramSent = false;
    let telegramError: string | null = null;
    const attemptedAt = new Date().toISOString();
    if (telemetryId && params.telegramMessage) {
      try {
        const tg = await sendTelegram(params.telegramMessage);
        if (tg?.ok) {
          telegramSent = true;
        } else {
          telegramError = tg?.error ?? 'telegram_not_ok';
        }
      } catch (err) {
        telegramError = errorMessage(err);
      }
    }
    await client.query('COMMIT');
    if (telemetryId) {
      await updateTelemetryTelegramDelivery(
        telemetryId,
        telegramSent ? 'sent' : telegramError ? 'failed' : 'skipped',
        telegramError,
        attemptedAt,
      );
    }
    return { skipped: false, telemetryId, telegramSent, telegramError };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[idling-dedup] handleIdlingAlertInTransaction failed vehicle=${params.vehicleId} trip=${params.activeTripId}:`, errorMessage(err));
    throw err;
  } finally {
    client.release();
  }
}

// ── Scheduler Health Check ──────────────────────────────────────

export function getSchedulerHealthCheck(): {
  running: boolean;
  cyclesCompleted: number;
  errors: number;
  lastRunAt: string | null;
  lastRunDuration: number | null;
  lastResult: string | null;
} {
  return {
    running: state.running,
    cyclesCompleted: state.cyclesCompleted,
    errors: state.errors,
    lastRunAt: state.lastRunAt,
    lastRunDuration: state.lastRunDuration,
    lastResult: state.lastResult,
  };
}
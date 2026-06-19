// ── Fleet Sync Scheduler ───────────────────────────────────────
//
// Runs the fleet telemetry sync (Cartrack fetch → alert dispatch →
// GPS log persistence) on a configurable interval.
//
// The scheduler automatically starts when the backend boots up
// and runs syncFleetAndAlert() every SYNC_INTERVAL_SECONDS.
//
// The interval can be changed at runtime via updateInterval().

import { syncFleetAndAlert } from '@car-tracker/tracker';
import { findVehicleByPlate, persistGpsTripLogs } from './gpsLogService.js';
import { SYNC_INTERVAL_SECONDS } from '../config/env.js';

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

// ── Mutable current interval (initialised from env, but can be
// changed at runtime via updateInterval()) ──────────────────────

let currentIntervalSeconds = SYNC_INTERVAL_SECONDS;

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
  runCycle();

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

// ── Internal ───────────────────────────────────────────────────

async function runCycle(): Promise<void> {
  if (state.paused) {
    console.log('[scheduler] Paused — skipping cycle');
    return;
  }

  const cycleStart = Date.now();
  const cycleLabel = `#${state.cyclesCompleted + 1}`;

  console.log(`[scheduler] Starting sync cycle ${cycleLabel}...`);

  try {
    const result = await syncFleetAndAlert({
      // Use the backend's direct PostgreSQL pool for plate validation
      resolveVehicleId: (plateNumber: string) => findVehicleByPlate(plateNumber),
    });

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
    // GPS log persistence from scheduler is disabled.
    // See trackingHistorySyncService.ts for the proper sync flow.

    const duration = (Date.now() - cycleStart) / 1000;
    state.lastRunDuration = duration;
    state.lastRunAt = new Date().toISOString();
    state.cyclesCompleted += 1;

    const summary = [
      `vehicles=${result.vehicles}`,
      `alerts_sent=${result.alerts.sent}`,
      `alerts_skipped=${result.alerts.skipped}`,
      `alerts_failed=${result.alerts.failed}`,
      `alerts_persisted=${result.alerts.persisted}`,
      `gps_logs_saved=${gpsLogsSaved}`,
      `gps_logs_failed=${gpsLogsFailed}`,
      `duration=${duration.toFixed(2)}s`,
    ].join(', ');

    state.lastResult = `ok: ${summary}`;

    console.log(`[scheduler] Cycle ${cycleLabel} completed — ${summary}`);
  } catch (error) {
    const duration = (Date.now() - cycleStart) / 1000;
    state.errors += 1;
    state.lastRunDuration = duration;
    state.lastRunAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    state.lastResult = `error: ${message}`;

    console.error(`[scheduler] Cycle ${cycleLabel} failed — ${message}`);
  }
}
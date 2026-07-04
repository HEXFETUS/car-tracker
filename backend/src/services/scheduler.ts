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
import { syncFleetAndAlert, sendTelegram, getVehicleEmoji } from '@car-tracker/tracker';
import { findVehicleByPlate } from './gpsLogService.js';
import { insertTelemetry, getLatestTelemetry, updateTelemetryTelegramMessage } from './gpsTelemetryService.js';
import { getPool } from '../db/db.js';
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

// ── Event Type Constants ───────────────────────────────────────
// Must match the event_type values saved in gps_telemetry.
// These are the canonical event types used across the entire pipeline.

const EVENT_TYPE = {
  IGNITION_ON: 'IGNITION_ON',
  IGNITION_OFF: 'IGNITION_OFF',
  LOCATION_UPDATE: 'LOCATION_UPDATE',
  IDLING: 'IDLING',
  MOTION_STARTED: 'MOTION_STARTED',
  SPEEDING: 'SPEEDING',
  LOW_FUEL: 'LOW_FUEL',
  NO_APPROVED_TRAVEL_ORDER: 'NO_APPROVED_TRAVEL_ORDER',
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

/**
 * Export runCycle so it can be called directly by the Vercel Cron
 * endpoint (/api/cron/sync-tracker) without duplicating logic.
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

async function shouldPersistIdlingAlertDb(vehicleId: string, activeTripId: string, thresholdMinutes: number): Promise<boolean> {
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

async function ensureIdlingSessionDb(vehicleId: string, activeTripId: string, idlingStartedAt: string): Promise<string> {
  await ensureIdlingDedupSchema();
  const pool = getPool();
  const existing = await getActiveIdlingDedupDb(vehicleId, activeTripId);
  if (existing?.idlingStartedAt) return new Date(existing.idlingStartedAt).toISOString();

  await pool.query(
    `INSERT INTO gps_idling_dedup
       (vehicle_id, active_trip_id, threshold_minutes, idling_started_at, last_alerted_duration_minutes, last_alerted_at, is_active)
     VALUES ($1, $2, NULL, $3, NULL, NULL, true)
     ON CONFLICT DO NOTHING`,
    [vehicleId, activeTripId, idlingStartedAt],
  );
  return idlingStartedAt;
}

function idlingThresholdForMinutes(minutes: number): number | null {
  if (minutes < 10) return null;
  if (minutes < 30) return 10;
  if (minutes < 60) return 30;
  if (minutes < 90) return 60;
  if (minutes < 120) return 90;
  return Math.floor(minutes / 30) * 30;
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

async function closeIdlingDedupDb(vehicleId: string, activeTripId?: string | null): Promise<void> {
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

async function runCycle(): Promise<void> {
  if (state.paused) {
    console.log('[scheduler] Paused — skipping cycle');
    return;
  }

  const cycleStart = Date.now();
  const cycleLabel = `#${state.cyclesCompleted + 1}`;

  console.log(`[scheduler] Starting sync cycle ${cycleLabel}...`);

  try {
    const pool = getPool();

    // ── Fetch driver, TO number & destination coordinates from approved travel orders ───
    // Single query to get all vehicle-to-driver mappings and TO destination coordinates
    const driverOverrides = new Map<string, string>();
    const toNumberOverrides = new Map<string, string>();
    const toDestinationOverrides = new Map<string, string>();
    const noToVehicleIds = new Set<string>();
    try {
      const allTOData = await pool.query<{ vehicle_id: string; driver_name: string | null; to_number: string; lat_long_destination: string | null }>(
        `SELECT DISTINCT ON (to_table.vehicle_id) 
           to_table.vehicle_id, 
           d.full_name AS driver_name,
           to_table.to_number,
           to_table.lat_long_destination
         FROM travel_orders to_table
         LEFT JOIN drivers d ON d.id = to_table.driver_id
         WHERE to_table.status = 'APPROVED'
         AND to_table.vehicle_id IS NOT NULL
         AND DATE(to_table.scheduled_departure) = CURRENT_DATE`,
      );
      for (const row of allTOData.rows) {
        if (row.driver_name) driverOverrides.set(row.vehicle_id, row.driver_name);
        if (row.to_number) toNumberOverrides.set(row.vehicle_id, row.to_number);
        if (row.lat_long_destination) toDestinationOverrides.set(row.vehicle_id, row.lat_long_destination);
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
      console.log(`[scheduler] Fetched ${driverOverrides.size} driver, ${toNumberOverrides.size} TO overrides, ${toDestinationOverrides.size} TO destinations, ${noToVehicleIds.size} vehicles with no TO`);
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

    // ── GPS Telemetry Persistence ──────────────────────────────
    //
    // LOCATION UPDATE and other telemetry events are persisted
    // exclusively via emitted alerts from tracker.js.
    // Raw location snapshot persistence has been removed to prevent
    // duplicate 'LOCATION UPDATE' records.
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

    console.log('[scheduler] Telemetry persistence via emitted alerts only');

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
          const message = `🚨 NO APPROVED TRAVEL ORDER - ${vehicleEmoji} ${plate ?? 'Unknown'}\n👤 Driver: ${driverName}\n📍 Location: ${locationText}\n🕘 ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })} PHT`;
          console.log('[TELEMETRY INSERT]', {
            plateNumber: plate ?? 'Unknown',
            sourceEventType: EVENT_TYPE.NO_APPROVED_TRAVEL_ORDER,
            finalEventType: EVENT_TYPE.NO_APPROVED_TRAVEL_ORDER,
            message,
          });
          const savedTelemetry = await insertTelemetry({
            vehicleId: vid,
            plateNumber: plate ?? 'Unknown',
            eventType: EVENT_TYPE.NO_APPROVED_TRAVEL_ORDER,
            latitude,
            longitude,
            speedKmh: speed,
            fuelLiters: latestTelemetry?.fuelLiters ?? null,
            ignition: latestTelemetry?.ignition ?? speed > 0,
            locationName,
            driverId: null,
            toNumber: null,
            recordedAt: new Date().toISOString(),
            activeTripId,
            telegramMessage: null,
          });

          if (!savedTelemetry.inserted) {
            console.error(`[scheduler] Telegram skipped because gps_telemetry was not inserted NO_APPROVED_TRAVEL_ORDER vehicle=${vid}`);
            continue;
          }

          unauthorizedTravelAlertsCreated += 1;
          unauthorizedTravelAlertVehicleIds.add(vid);
          try {
            console.log(`[scheduler] Before Telegram send telemetry_id=${savedTelemetry.id} vehicle=${vid} event=NO_APPROVED_TRAVEL_ORDER`);
            const telegram = await sendTelegram(message);
            if (telegram?.ok) {
              if (savedTelemetry.id) {
                await updateTelemetryTelegramMessage(savedTelemetry.id, message);
              }
              console.log(`[scheduler] Telegram send succeeded telemetry_id=${savedTelemetry.id} vehicle=${vid} event=NO_APPROVED_TRAVEL_ORDER`);
            } else {
              console.error(`[scheduler] Telegram send failed telemetry_id=${savedTelemetry.id} vehicle=${vid} event=NO_APPROVED_TRAVEL_ORDER: ${telegram?.error ?? 'telegram_not_ok'}`);
            }
          } catch (telegramError) {
            console.error(`[scheduler] Failed to send Telegram alert for ${vid}:`, errorMessage(telegramError));
          }
        } catch (err) {
          console.error(`[scheduler] Failed to check/save unauthorized travel for ${String(vehicle.id)}:`, errorMessage(err));
        }
      }
    }

    // ── DB-backed Telemetry From Current Fleet Snapshot ────────
    //
    // Vercel/serverless invocations do not reliably keep tracker.js's
    // in-memory previous-state Map warm. Persist LOCATION_UPDATE and
    // IDLING here from database state so external cron invocations still
    // save telemetry even when each request lands on a fresh function.
    if (vehicles && vehicles.length > 0) {
      for (const vehicle of vehicles) {
        const vehicleId = String(vehicle.id ?? '');
        if (!vehicleId) continue;

        try {
          const speed = Number(vehicle.speed ?? 0);
          const ignition = vehicle.ignition === true;
          const isMoving = ignition && speed > 0;
          const isIdling = ignition && speed <= 0;
          const latestTelemetry = await getLatestTelemetry(vehicleId);
          const latestActiveTripId = latestTelemetry?.eventType === EVENT_TYPE.IGNITION_OFF
            ? null
            : latestTelemetry?.activeTripId ?? null;
          const activeIdlingSession = await getActiveIdlingSessionForVehicle(vehicleId);
          const activeTripId = latestActiveTripId ?? activeIdlingSession?.activeTripId ?? randomUUID();
          const plateNumber = String(vehicle.name ?? '').split(' ')[0] || String(vehicleId);
          const locationName = String(vehicle.location ?? '').trim() || null;
          const coordinates = vehicle.coordinates as { latitude?: unknown; longitude?: unknown } | null | undefined;
          const latitude = coordinates?.latitude == null ? null : Number(coordinates.latitude);
          const longitude = coordinates?.longitude == null ? null : Number(coordinates.longitude);
          const fuelLiters = vehicle.fuel == null ? null : Number(vehicle.fuel);
          const driverName = typeof vehicle.driver === 'string' ? vehicle.driver : null;
          const toNumber = typeof vehicle.to_number === 'string' ? vehicle.to_number : null;
          const recordedAt = new Date().toISOString();

          if (!ignition) {
            await closeIdlingDedupDb(vehicleId, latestActiveTripId);
            continue;
          }

          if (isMoving) {
            let idlingTripToCloseAfterMoving: string | null = null;
            if (activeIdlingSession?.activeTripId && Number(activeIdlingSession.lastAlertedDurationMinutes ?? 0) >= 10) {
              const motionTripId = activeIdlingSession.activeTripId;
              const message = `🟢 MOTION STARTED - ${getVehicleEmoji(plateNumber)} ${plateNumber}\n\n👤 Driver: ${driverName || 'Unassigned'}\n📍 ${locationName || 'Unknown location'}\n🕘 ${new Date(recordedAt).toLocaleString('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })} PHT`;
              const savedTelemetry = await insertTelemetry({
                vehicleId,
                plateNumber,
                eventType: EVENT_TYPE.MOTION_STARTED,
                latitude,
                longitude,
                speedKmh: speed,
                fuelLiters,
                ignition,
                locationName,
                driverId: null,
                toNumber,
                recordedAt,
                activeTripId: motionTripId,
                telegramMessage: null,
              });

              if (savedTelemetry.inserted) {
                telemetrySaved += 1;
                console.log(`[scheduler] DB-backed MOTION_STARTED saved telemetry_id=${savedTelemetry.id} vehicle=${vehicleId} trip=${motionTripId}`);
                const telegram = await sendTelegram(message);
                if (telegram?.ok && savedTelemetry.id) {
                  await updateTelemetryTelegramMessage(savedTelemetry.id, message);
                }
              } else {
                telemetrySkipped += 1;
              }
              await closeIdlingDedupDb(vehicleId, motionTripId);
            } else if (activeIdlingSession?.activeTripId) {
              idlingTripToCloseAfterMoving = activeIdlingSession.activeTripId;
            } else {
              console.log(`[scheduler] DB-backed MOTION_STARTED skipped reason=no_active_idling_session vehicle=${vehicleId}`);
            }

            const previousLocationName = latestTelemetry?.locationName || null;
            const locationNameChanged = Boolean(
              locationName &&
              locationName.trim() &&
              previousLocationName !== locationName,
            );
            const hasCurrentCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
            const hasPreviousCoordinates = Number.isFinite(latestTelemetry?.latitude) && Number.isFinite(latestTelemetry?.longitude);
            const distanceMeters = hasCurrentCoordinates && hasPreviousCoordinates
              ? haversineDistanceMeters(latitude as number, longitude as number, latestTelemetry?.latitude as number, latestTelemetry?.longitude as number)
              : null;
            const locationChanged = (distanceMeters !== null && distanceMeters >= 20) || locationNameChanged;

            if (!locationChanged) {
              telemetrySkipped += 1;
              console.log(`[scheduler] SKIPPING DB-backed LOCATION_UPDATE for ${vehicleId} reason=location_not_changed distance=${distanceMeters === null ? 'unknown' : distanceMeters.toFixed(1)}m`);
              if (idlingTripToCloseAfterMoving) {
                await closeIdlingDedupDb(vehicleId, idlingTripToCloseAfterMoving);
              }
              continue;
            }

            const message = `🗺 LOCATION UPDATE - ${getVehicleEmoji(plateNumber)} ${plateNumber}\n\n📍 ${locationName}\n⚡ Speed: ${speed} km/h\n⛽ Fuel: ${fuelLiters ?? 'Unknown'} L\n👤 Driver: ${driverName || 'Unassigned'}\n🕘 ${new Date(recordedAt).toLocaleString('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })} PHT`;
            const savedTelemetry = await insertTelemetry({
              vehicleId,
              plateNumber,
              eventType: EVENT_TYPE.LOCATION_UPDATE,
              latitude,
              longitude,
              speedKmh: speed,
              fuelLiters,
              ignition,
              locationName,
              driverId: null,
              toNumber,
              recordedAt,
              activeTripId,
              telegramMessage: null,
            });

            if (savedTelemetry.inserted) {
              telemetrySaved += 1;
              console.log(`[scheduler] DB-backed LOCATION_UPDATE saved telemetry_id=${savedTelemetry.id} vehicle=${vehicleId}`);
              const telegram = await sendTelegram(message);
              if (telegram?.ok && savedTelemetry.id) {
                await updateTelemetryTelegramMessage(savedTelemetry.id, message);
              }
            } else {
              telemetrySkipped += 1;
            }
            if (idlingTripToCloseAfterMoving) {
              await closeIdlingDedupDb(vehicleId, idlingTripToCloseAfterMoving);
            }
            continue;
          }

          if (isIdling) {
            const fallbackStartedAt = new Date().toISOString();
            const idlingStartedAt = await ensureIdlingSessionDb(vehicleId, activeTripId, fallbackStartedAt);
            const apiIdleMinutes = Number(vehicle.idle_minutes ?? NaN);
            const elapsedMinutes = Number.isFinite(apiIdleMinutes)
              ? apiIdleMinutes
              : Math.max(0, (Date.now() - new Date(idlingStartedAt).getTime()) / 60000);
            const thresholdMinutes = idlingThresholdForMinutes(elapsedMinutes);

            if (thresholdMinutes === null) {
              telemetrySkipped += 1;
              console.log(`[idling-alert] IDLING Waiting elapsed=${elapsedMinutes.toFixed(1)}min vehicle=${vehicleId} trip=${activeTripId}`);
              continue;
            }

            const shouldPersist = await shouldPersistIdlingAlertDb(vehicleId, activeTripId, thresholdMinutes);
            if (!shouldPersist) {
              telemetrySkipped += 1;
              console.log(`[idling-alert] Skipping DB-backed IDLING threshold=${thresholdMinutes}min vehicle=${vehicleId} trip=${activeTripId} reason=already_alerted`);
              continue;
            }

            const message = `⏱ IDLING TOO LONG - ${getVehicleEmoji(plateNumber)} ${plateNumber}\n\n⏱ Idling for ${Math.round(elapsedMinutes * 10) / 10} minutes\n⛽ Fuel: ${fuelLiters ?? 'Unknown'} L\n👤 Driver: ${driverName || 'Unassigned'}\n📍 ${locationName || 'Unknown location'}\n🕘 ${new Date(recordedAt).toLocaleString('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })} PHT`;
            const savedTelemetry = await insertTelemetry({
              vehicleId,
              plateNumber,
              eventType: EVENT_TYPE.IDLING,
              latitude,
              longitude,
              speedKmh: speed,
              fuelLiters,
              ignition,
              locationName,
              driverId: null,
              toNumber,
              recordedAt,
              activeTripId,
              telegramMessage: null,
            });

            if (!savedTelemetry.inserted) {
              telemetrySkipped += 1;
              console.log(`[idling-alert] DB-backed IDLING insert skipped vehicle=${vehicleId} trip=${activeTripId}`);
              continue;
            }

            telemetrySaved += 1;
            await markIdlingAlertDb(vehicleId, activeTripId, idlingStartedAt, thresholdMinutes);
            console.log(`[idling-alert] DB-backed IDLING saved telemetry_id=${savedTelemetry.id} vehicle=${vehicleId} trip=${activeTripId} threshold=${thresholdMinutes}min`);
            const telegram = await sendTelegram(message);
            if (telegram?.ok && savedTelemetry.id) {
              await updateTelemetryTelegramMessage(savedTelemetry.id, message);
            }
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
          const finalEventType = canonicalEventType(eventType);
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
            activeTripId = activeTripId ?? await getLatestActiveTripId(vehicleId) ?? randomUUID();
          } else {
            activeTripId = activeTripId ?? await getLatestActiveTripId(vehicleId);
            if (!activeTripId) {
              console.log(`[scheduler] SKIPPING ${finalEventType} for ${vehicleId} - no active trip found`);
              telemetrySkipped += 1;
              continue;
            }
          }

          if (finalEventType === EVENT_TYPE.IGNITION_ON && activeTripId) {
            const latestTripEventType = await getLatestCanonicalTripEventType(vehicleId, activeTripId);
            if (latestTripEventType === EVENT_TYPE.IGNITION_ON) {
              telemetrySkipped += 1;
              console.log(`[scheduler] SKIPPING IGNITION_ON for ${vehicleId} - latest trip event is already IGNITION_ON`);
              continue;
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

            // Location deduplication: save when the name changes or coordinates move at least 20m.
            const lastTelemetry = await getLatestTelemetry(vehicleId);
            const previousLocationName = lastTelemetry?.locationName || null;
            const currentLocationName = locationName;
            const locationNameChanged = currentLocationName !== null &&
              currentLocationName !== undefined &&
              currentLocationName.trim() !== '' &&
              previousLocationName !== currentLocationName;
            const hasCurrentCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
            const hasPreviousCoordinates = Number.isFinite(lastTelemetry?.latitude) && Number.isFinite(lastTelemetry?.longitude);
            const distanceMeters = hasCurrentCoordinates && hasPreviousCoordinates
              ? haversineDistanceMeters(latitude, longitude, lastTelemetry?.latitude ?? null, lastTelemetry?.longitude ?? null)
              : null;
            const locationChanged = locationNameChanged || (distanceMeters !== null && distanceMeters >= 20);

            console.log("[LOCATION CHECK]", {
              vehicle: plateNumber,
              previousLocation: previousLocationName,
              currentLocation: currentLocationName,
              locationNameChanged,
              distanceMeters,
              locationChanged,
              speed: spd,
              ignition: effectiveIgnition,
              willInsert: locationChanged
            });

            if (!locationChanged) {
              telemetrySkipped += 1;
              console.log(`[scheduler] SKIPPING LOCATION_UPDATE for ${vehicleId} reason=location_not_changed`);
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

          const savedTelemetry = await insertTelemetry({
            vehicleId,
            plateNumber,
            eventType: finalEventType,
            latitude,
            longitude,
            speedKmh: spd,
            fuelLiters,
            ignition: effectiveIgnition,
            locationName,
            driverId: null,
            toNumber,
            recordedAt,
            activeTripId,
            telegramMessage: null
          });

          if (!savedTelemetry.inserted) {
            telemetrySkipped += 1;
            console.log(`[idling-alert] DB insert failed (conflict) vehicle=${vehicleId} event=${finalEventType} trip=${activeTripId ?? 'null'}`);
            continue;
          }

          telemetrySaved += 1;
          console.log(`[idling-alert] DB insert succeeded id=${savedTelemetry.id} vehicle=${vehicleId} event=${finalEventType} tripId=${activeTripId ?? 'null'}`);

          if (finalEventType === EVENT_TYPE.IDLING && activeTripId) {
            const thresholdMinutes = alert.idlingThresholdReached;
            if (thresholdMinutes !== undefined && thresholdMinutes !== null) {
              // Use the actual idling start time from tracker state (preserves original timer)
              const idlingStartedAt = alert.idlingStartedAt || new Date(Date.now() - thresholdMinutes * 60 * 1000).toISOString();
              await markIdlingAlertDb(vehicleId, activeTripId, idlingStartedAt, thresholdMinutes);
              console.log(`[idling-alert] Updated dedup state threshold=${thresholdMinutes}min vehicle=${vehicleId} trip=${activeTripId}`);
            }
          }

          if (finalEventType === EVENT_TYPE.MOTION_STARTED || finalEventType === EVENT_TYPE.IGNITION_OFF) {
            await closeIdlingDedupDb(vehicleId, activeTripId);
            console.log(`[idling-alert] Closed active idling state vehicle=${vehicleId} trip=${activeTripId ?? 'null'} event=${finalEventType}`);
          }

          // Send Telegram AFTER DB insert succeeds.
          const shouldSendTelegram = finalEventType === EVENT_TYPE.IGNITION_OFF ||
            finalEventType === EVENT_TYPE.IDLING ||
            finalEventType === EVENT_TYPE.NO_APPROVED_TRAVEL_ORDER ||
            finalEventType === EVENT_TYPE.MOTION_STARTED ||
            finalEventType === EVENT_TYPE.IGNITION_ON ||
            finalEventType === EVENT_TYPE.LOCATION_UPDATE ||
            finalEventType === EVENT_TYPE.SPEEDING ||
            finalEventType === EVENT_TYPE.LOW_FUEL;
          const reasonIfSkipped = shouldSendTelegram ? '' : `Event type ${finalEventType} not in priority send list`;

          console.log("[TELEGRAM SEND CHECK]", {
            plateNumber,
            eventType: finalEventType,
            shouldSendTelegram,
            reasonIfSkipped
          });

          console.log("[NEW TELEGRAM]", {
            plate: plateNumber,
            event: finalEventType,
            hasMessage: !!alert.message,
            messagePreview: alert.message?.substring(0, 60),
            sentToTelegram: shouldSendTelegram
          });

          if (shouldSendTelegram) {
            try {
              console.log(`[idling-alert] before Telegram send telemetry_id=${savedTelemetry.id} vehicle=${vehicleId} event=${finalEventType}`);
              const telegram = await sendTelegram(alert.message);
              if (telegram?.ok) {
                if (savedTelemetry.id) {
                  await updateTelemetryTelegramMessage(savedTelemetry.id, alert.message);
                }
                console.log(`[idling-alert] Telegram send succeeded telemetry_id=${savedTelemetry.id} vehicle=${vehicleId} event=${finalEventType}`);
              } else {
                console.error(`[idling-alert] Telegram send failed telemetry_id=${savedTelemetry.id} vehicle=${vehicleId} event=${finalEventType}: ${telegram?.error ?? 'telegram_not_ok'}`);
              }
            } catch (telegramError) {
              console.error(`[idling-alert] Failed to send Telegram for saved telemetry_id=${savedTelemetry.id} vehicle=${vehicleId} event=${finalEventType}:`, errorMessage(telegramError));
            }
          } else {
            console.log(`[scheduler] SKIPPING Telegram for ${finalEventType} vehicle=${vehicleId} reason=${reasonIfSkipped}`);
          }
        } catch (err) {
          console.error(`[scheduler] Failed to save telemetry for ${alert.vehicleId}:`, errorMessage(err));
        }
      }
    } else {
      console.log('[scheduler] No emitted alerts to persist');
    }

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
      `telemetry_saved=${telemetrySaved}`,
      `telemetry_skipped=${telemetrySkipped}`,
      `unauthorized_travel_alerts=${unauthorizedTravelAlertsCreated}`,
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





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
import { syncFleetAndAlert, getIgnition, sendTelegram } from '@car-tracker/tracker';
import { findVehicleByPlate, persistGpsTripLogs } from './gpsLogService.js';
import { insertTelemetry, getLatestTelemetry, telemetryTripEventExists } from './gpsTelemetryService.js';
import { createNoTravelOrderAlert } from './gpsAlertService.js';
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

/**
 * Export runCycle so it can be called directly by the Vercel Cron
 * endpoint (/api/cron/sync-tracker) without duplicating logic.
 */
export { runCycle };

// ── Internal ───────────────────────────────────────────────────

function distanceMeters(
  aLat: number | null,
  aLng: number | null,
  bLat: number | null,
  bLng: number | null,
): number | null {
  if (aLat == null || aLng == null || bLat == null || bLng == null) return null;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusM = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusM * Math.asin(Math.sqrt(h));
}

// ── Cross-cycle idling milestone deduplication (DB-backed) ────
// Tracks which idling milestones have been persisted per vehicle
// across scheduler runs. Persisted milestones are stored in a
// dedicated database table (gps_idling_dedup) so they survive
// restarts and are shared across cycles.
// Composite key: vehicle_id + active_trip_id + threshold_minutes
async function isIdlingMilestonePersistedDb(vehicleId: string, activeTripId: string, thresholdMinutes: number): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT 1 FROM gps_idling_dedup
     WHERE vehicle_id = $1
       AND active_trip_id = $2
       AND threshold_minutes = $3
     LIMIT 1`,
    [vehicleId, activeTripId, thresholdMinutes],
  );
  return result.rows.length > 0;
}

async function markIdlingMilestonePersistedDb(vehicleId: string, activeTripId: string, thresholdMinutes: number): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO gps_idling_dedup (vehicle_id, active_trip_id, threshold_minutes)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [vehicleId, activeTripId, thresholdMinutes],
  );
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
    });

    console.log(`[scheduler] Sync result: ${result.vehicles} vehicles, ${result.data.length} statuses, ${result.tripLogs.length} trip logs, ${result.emittedAlerts?.length || 0} emitted alerts`);
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
    // Save the actual emitted alerts (from tracker.js) directly into
    // gps_telemetry. This ensures the database event_type always matches
    // the alert that was sent to Telegram, rather than a re-classified guess.
    //
    // The emittedAlerts array from syncFleetAndAlert() contains the canonical
    // eventType for each alert that was actually dispatched to Telegram.
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
      idleAlertCount?: number;
      idlingThresholdReached?: number | null;
    }> | undefined;

    // ── Unauthorized Travel Alert Detection ────────────────────
    // After telemetry is saved, check for vehicles traveling without
    // an approved travel order and create alerts if needed.
    // Uses direct DB lookup to ensure accuracy (not Cartrack's to_number).
    let unauthorizedTravelAlertsCreated = 0;
    const vehicles = result.data as unknown as Array<Record<string, unknown>> | undefined;
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

          // Deduplication: check if we already created an alert for this vehicle recently
          const recentAlertResult = await pool.query<{ id: string }>(
            `SELECT id FROM gps_alerts
             WHERE vehicle_id = $1
               AND alert_type = 'NO_APPROVED_TRAVEL_ORDER'
               AND created_at > NOW() - INTERVAL '1 hour'
             LIMIT 1`,
            [vid],
          );

          if (recentAlertResult.rows.length > 0) {
            // Alert already exists within the last hour — skip
            continue;
          }

          // Get latest telemetry for location data
          const latestTelemetry = await getLatestTelemetry(vid);
          const latitude = latestTelemetry?.latitude ?? null;
          const longitude = latestTelemetry?.longitude ?? null;
          const locationName = latestTelemetry?.locationName || null;

          await createNoTravelOrderAlert(vid, latitude, longitude, locationName);
          unauthorizedTravelAlertsCreated += 1;

          // Send Telegram notification
          try {
            const plate = await (await import('./gpsAlertService.js')).getVehiclePlate(vid);
            const locationText = locationName || 'Unknown location';
            const driverName = driverOverrides.get(vid) || 'Unassigned';
            const message = `🚨 NO APPROVED TRAVEL ORDER - Vehicle ${plate ?? 'Unknown'}\n👤 Driver: ${driverName}\n📍 Location: ${locationText}\n🕘 ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })} PHT`;
            await sendTelegram(message);
          } catch (telegramError) {
            console.error(`[scheduler] Failed to send Telegram alert for ${vid}:`, (telegramError as Error).message);
          }
        } catch (err) {
          console.error(`[scheduler] Failed to check unauthorized travel for ${String(vehicle.id)}:`, (err as Error).message);
        }
      }
    }

    // ── Persist Emitted Alerts as GPS Telemetry ────────────────
    // This is the core fix: instead of re-classifying events independently,
    // we save the actual alert types that were sent to Telegram.
    // The eventType comes directly from tracker.js's canonical mapping.
    if (emittedAlerts && emittedAlerts.length > 0) {
      console.log(`[scheduler] Processing ${emittedAlerts.length} emitted alerts for telemetry persistence`);

      
      for (const alert of emittedAlerts) {
        try {
          const vehicleId = alert.vehicleId;
          if (!vehicleId) {
            telemetrySkipped += 1;
            continue;
          }

          const eventType = alert.eventType;
          if (!eventType) {
            telemetrySkipped += 1;
            continue;
          }

          const spd = Number(alert.speed || 0);
          const ign = alert.ignition;
          const effectiveIgnition = spd > 0 ? true : ign;
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

          // ── active_trip_id management ──────────────────────────
          // Get the latest telemetry to determine the current active trip
          const last = await getLatestTelemetry(vehicleId);
          let activeTripId = last?.activeTripId ?? null;

          // ── Event-specific active_trip_id logic ────────────────
          // CRITICAL: Only IGNITION ON ALERT is allowed to create a new
          // active_trip_id. All other events (IDLING, MOVING, LOCATION
          // UPDATE, SPEEDING, LOW FUEL, IGNITION OFF) MUST reuse an
          // existing active_trip_id from the database. If no active trip
          // exists, the event is skipped to preserve trip integrity.
          if (eventType === 'IGNITION ON ALERT') {
            // Start a new trip
            activeTripId = randomUUID();
          } else if (eventType === 'IGNITION OFF ALERT') {
            // Keep the existing trip ID (it will be the last record for this trip)
            // Only save if there's no active idling alert for this vehicle
            const hasActiveIdling = emittedAlerts.some(
              (ea) => ea.vehicleId === vehicleId && ea.eventType === 'IDLING ALERT',
            );
            if (hasActiveIdling) {
              console.log(`[scheduler] Skipping IGNITION OFF for ${vehicleId} — active idling alert exists for this cycle`);
              telemetrySkipped += 1;
              continue;
            }
            // Verify an active trip exists before saving IGNITION OFF
            if (!activeTripId) {
              console.log(`[scheduler] Skipping IGNITION OFF for ${vehicleId} — no active trip found`);
              telemetrySkipped += 1;
              continue;
            }
          } else if (eventType === 'IDLING ALERT') {
            // IDLING ALERT requires an existing active trip
            if (!activeTripId) {
              console.log(`[scheduler] Skipping IDLING ALERT for ${vehicleId} — no active trip found`);
              telemetrySkipped += 1;
              continue;
            }

            // Deduplication: check if this idling milestone was already persisted
            // Uses DB-backed dedup key: vehicle_id + active_trip_id + threshold_minutes
            const thresholdMinutes = alert.idlingThresholdReached;
            if (thresholdMinutes !== undefined && thresholdMinutes !== null) {
              const alreadyPersisted = await isIdlingMilestonePersistedDb(vehicleId, activeTripId, thresholdMinutes);
              if (alreadyPersisted) {
                console.log(`[scheduler] Skipping duplicate idling milestone ${thresholdMinutes}min for ${vehicleId} trip ${activeTripId}`);
                telemetrySkipped += 1;
                continue;
              }
            }
          } else {
            // MOVING, LOCATION UPDATE, SPEEDING, LOW FUEL — all require existing trip
            if (!activeTripId) {
              console.log(`[scheduler] Skipping ${eventType} for ${vehicleId} — no active trip found`);
              telemetrySkipped += 1;
              continue;
            }
          }

          // Deduplication for explicit trip boundary events
          if (eventType === 'IGNITION ON ALERT') {
            const alreadySavedOn = await telemetryTripEventExists(vehicleId, activeTripId, 'IGNITION ON ALERT');
            if (alreadySavedOn) {
              telemetrySkipped += 1;
              continue;
            }
          }
          if (eventType === 'IGNITION OFF ALERT') {
            const alreadySavedOff = await telemetryTripEventExists(vehicleId, activeTripId, 'IGNITION OFF ALERT');
            if (alreadySavedOff) {
              telemetrySkipped += 1;
              continue;
            }
          }

          const inserted = await insertTelemetry({
            vehicleId,
            plateNumber,
            eventType,
            latitude,
            longitude,
            speedKmh: spd,
            fuelLiters,
            ignition: effectiveIgnition,
            locationName,
            driverName,
            toNumber,
            recordedAt,
            activeTripId,
          });
          if (inserted) {
            telemetrySaved += 1;

            // After successful telemetry insert, mark idling milestone as persisted
            // (dedup record is written AFTER the telemetry record to avoid FK issues)
            if (eventType === 'IDLING ALERT') {
              const thresholdMinutes = alert.idlingThresholdReached;
              if (thresholdMinutes !== undefined && thresholdMinutes !== null && activeTripId) {
                await markIdlingMilestonePersistedDb(vehicleId, activeTripId, thresholdMinutes);
              }
            }
          } else {
            telemetrySkipped += 1;
          }
        } catch (err) {
          console.error(`[scheduler] Failed to save telemetry for ${alert.vehicleId}:`, (err as Error).message);
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
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
import { syncFleetAndAlert, sendTelegram } from '@car-tracker/tracker';
import { findVehicleByPlate } from './gpsLogService.js';
import { insertTelemetry, getLatestTelemetry } from './gpsTelemetryService.js';
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
  IGNITION_ON_ALERT: 'IGNITION ON ALERT',
  IGNITION_OFF_ALERT: 'IGNITION OFF ALERT',
  LOCATION_UPDATE_ALERT: 'LOCATION UPDATE ALERT',
  LOCATION_UPDATE: 'LOCATION UPDATE',
  IDLING_ALERT: 'IDLING ALERT',
  IDLING_TOO_LONG_ALERT: 'IDLING TOO LONG ALERT',
  MOVING_ALERT: 'MOVING ALERT',
  SPEEDING_ALERT: 'SPEEDING ALERT',
  LOW_FUEL_ALERT: 'LOW FUEL ALERT',
} as const;

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
    // FIXED ORDER OF OPERATIONS:
    // 1. Save RAW location telemetry for every vehicle (no alert required)
    // 2. Save emitted alerts from tracker.js (with Telegram messages)
    // 3. Send Telegram only after DB insert succeeds
    //
    // This ensures location updates are always saved to gps_telemetry
    // regardless of whether an alert was emitted.
    let telemetrySaved = 0;
    let telemetrySkipped = 0;
    let locationSnapshotsSaved = 0;

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

    const vehicles = result.data as unknown as Array<Record<string, unknown>> | undefined;

    // ── STEP 1: Save RAW location telemetry for every vehicle ──
    // This runs BEFORE alert processing, ensuring location data
    // is always persisted even when no alert conditions are met.
    //
    // RULES:
    // 1. Only save when ignition=true and coordinates are valid
    // 2. Never save raw location for ignition=false vehicles
    // 3. No Telegram sent for raw location snapshots
    if (vehicles && vehicles.length > 0) {
      // Pre-resolve all vehicle plate numbers from the database
      // to avoid N+1 queries. The vehicle status objects have `id` (UUID)
      // and `name` (display name like "KAR6412 (TO-xxx)").
      const vehicleIds = vehicles.map((v) => String(v.id ?? '')).filter(Boolean);
      const plateMap = new Map<string, string>();
      if (vehicleIds.length > 0) {
        try {
          const plateResult = await pool.query<{ id: string; plate_number: string }>(
            `SELECT id, plate_number FROM vehicles WHERE id = ANY($1::uuid[])`,
            [vehicleIds],
          );
          for (const row of plateResult.rows) {
            plateMap.set(row.id, row.plate_number);
          }
        } catch (err) {
          console.error('[scheduler] Failed to pre-resolve plate numbers:', errorMessage(err));
        }
      }

      for (const vehicle of vehicles) {
        try {
          const vid = String(vehicle.id ?? '');
          const speed = Number(vehicle.speed || 0);
          const ignition = vehicle.ignition === true || vehicle.ignition === 'true' || vehicle.ignition === true;
          const coordinates = (vehicle.coordinates as { latitude?: number; longitude?: number } | undefined) ?? {};
          const latitude = coordinates.latitude != null ? Number(coordinates.latitude) : null;
          const longitude = coordinates.longitude != null ? Number(coordinates.longitude) : null;
          const fuel = vehicle.fuel_liters != null ? Number(vehicle.fuel_liters) : null;
          const locationName = vehicle.location ? String(vehicle.location) : null;
          // Resolve plate number: prefer DB lookup, fall back to extracting from name field
          const plateNumber = plateMap.get(vid) || (vehicle.name ? String(vehicle.name).split(' ')[0] : vid);

          // Only save location snapshot if ignition is ON and coordinates are valid
          if (latitude != null && longitude != null) {
            if (!ignition) {
              console.log(`[location-update] skipped ignition_off vehicle=${vid} plate=${plateNumber}`);
              continue;
            }

            // ── Simple dedup: only save if location actually changed ──
            // Compare rounded coordinates (5 decimal places ≈ 1.1m precision)
            // with the latest LOCATION UPDATE. If same, skip.
            let shouldSkip = false;
            try {
              const latestLocResult = await pool.query<{ latitude: number | null; longitude: number | null }>(
                `SELECT latitude, longitude
                 FROM gps_telemetry
                 WHERE vehicle_id = $1
                   AND event_type = 'LOCATION UPDATE'
                 ORDER BY recorded_at DESC
                 LIMIT 1`,
                [vid],
              );
              if (latestLocResult.rows.length > 0) {
                const latest = latestLocResult.rows[0];
                const latestLat = latest.latitude != null ? Number(latest.latitude) : null;
                const latestLng = latest.longitude != null ? Number(latest.longitude) : null;

                // Round both to 5 decimal places for comparison
                const currentLatR5 = latitude != null ? Math.round(latitude * 100000) / 100000 : null;
                const currentLngR5 = longitude != null ? Math.round(longitude * 100000) / 100000 : null;
                const latestLatR5 = latestLat != null ? Math.round(latestLat * 100000) / 100000 : null;
                const latestLngR5 = latestLng != null ? Math.round(latestLng * 100000) / 100000 : null;

                if (currentLatR5 !== null && currentLngR5 !== null &&
                    latestLatR5 !== null && latestLngR5 !== null &&
                    currentLatR5 === latestLatR5 && currentLngR5 === latestLngR5) {
                  shouldSkip = true;
                  console.log(`[location-update] skipped_duplicate vehicle=${vid} lat=${currentLatR5} lng=${currentLngR5}`);
                }
              }
            } catch (err) {
              console.error(`[location-update] Failed to check latest location for ${vid}:`, errorMessage(err));
            }

            if (shouldSkip) {
              locationSnapshotsSaved += 1; // Still count as "saved" in terms of coverage
              continue;
            }

            // Get the latest active_trip_id to reuse
            const activeTripId = await getLatestActiveTripId(vid);

            const savedTelemetry = await insertTelemetry({
              vehicleId: vid,
              plateNumber, // Always the actual plate number, never the UUID
              eventType: EVENT_TYPE.LOCATION_UPDATE,
              latitude,
              longitude,
              speedKmh: speed,
              fuelLiters: fuel,
              ignition: true,
              locationName: locationName || null,
              driverId: null,
              toNumber: null,
              recordedAt: new Date().toISOString(),
              activeTripId,
              telegramMessage: null, // No Telegram for raw location snapshots
            });

            if (savedTelemetry.inserted) {
              locationSnapshotsSaved += 1;
              console.log(`[location-update] saved vehicle=${vid} speed=${speed}`);
            } else {
              console.log(`[location-update] skipped duplicate vehicle=${vid} plate=${plateNumber}`);
            }
          }
        } catch (err) {
          console.error(`[scheduler] Failed to save location snapshot for ${String(vehicle.id)}:`, errorMessage(err));
        }
      }
      console.log(`[scheduler] Location snapshots saved: ${locationSnapshotsSaved}`);
    }

    // ── Unauthorized Travel Alert Detection ────────────────────
    // After telemetry is saved, check for vehicles traveling without
    // an approved travel order and create alerts if needed.
    // Uses direct DB lookup to ensure accuracy (not Cartrack's to_number).
    let unauthorizedTravelAlertsCreated = 0;
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
            `SELECT id FROM gps_telemetry
             WHERE vehicle_id = $1
               AND event_type = 'NO_APPROVED_TRAVEL_ORDER'
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

          const plate = await (await import('./gpsAlertService.js')).getVehiclePlate(vid);
          const locationText = locationName || 'Unknown location';
          const driverName = driverOverrides.get(vid) || 'Unassigned';
          const message = `🚨 NO APPROVED TRAVEL ORDER - Vehicle ${plate ?? 'Unknown'}\n👤 Driver: ${driverName}\n📍 Location: ${locationText}\n🕘 ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })} PHT`;
          const savedTelemetry = await insertTelemetry({
            vehicleId: vid,
            plateNumber: plate ?? 'Unknown',
            eventType: 'NO_APPROVED_TRAVEL_ORDER',
            latitude,
            longitude,
            speedKmh: speed,
            fuelLiters: latestTelemetry?.fuelLiters ?? null,
            ignition: latestTelemetry?.ignition ?? speed > 0,
            locationName,
            driverId: null,
            toNumber: null,
            recordedAt: new Date().toISOString(),
            activeTripId: latestTelemetry?.activeTripId ?? null,
            telegramMessage: message,
          });

          if (!savedTelemetry.inserted) {
            console.error(`[scheduler] Telegram skipped because gps_telemetry was not inserted NO_APPROVED_TRAVEL_ORDER vehicle=${vid}`);
            continue;
          }

          unauthorizedTravelAlertsCreated += 1;
          try {
            console.log(`[scheduler] Before Telegram send telemetry_id=${savedTelemetry.id} vehicle=${vid} event=NO_APPROVED_TRAVEL_ORDER`);
            const telegram = await sendTelegram(message);
            if (telegram?.ok) {
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

    // ── STEP 2: Persist Emitted Alerts as GPS Telemetry ────────
    // This saves the actual alert types that were sent to Telegram.
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

          // ── LOCATION UPDATE ALERT dedup ────────────────────────
          // LOCATION UPDATE ALERT is emitted by tracker.js for normal movement.
          // Since STEP 1 already saved a raw LOCATION UPDATE for this vehicle/cycle,
          // we skip the LOCATION UPDATE ALERT to avoid duplicate rows.
          // Only real alert types (IGNITION, IDLING, MOVING, SPEEDING, LOW FUEL)
          // should be persisted as separate alert rows.
          if (eventType === EVENT_TYPE.LOCATION_UPDATE_ALERT) {
            console.log(`[scheduler] SKIPPING ${eventType} for ${vehicleId} — raw LOCATION UPDATE already saved in STEP 1`);
            telemetrySkipped += 1;
            continue;
          }

          // ── active_trip_id management ──────────────────────────
          // CRITICAL RULES:
          // 1. IGNITION ON ALERT → creates new active_trip_id ONLY if no active trip exists
          // 2. IGNITION OFF ALERT → reuses latest active_trip_id, ends the trip
          // 3. IDLING ALERT, IDLING TOO LONG ALERT → reuses latest active_trip_id, creates new if none exists
          // 4. MOVING ALERT → reuses latest active_trip_id, creates new if none exists
          // 5. SPEEDING ALERT, LOW FUEL ALERT → MUST reuse latest active_trip_id
          let activeTripId: string | null = null;

          if (eventType === EVENT_TYPE.IGNITION_ON_ALERT) {
            // Check if there's already an active trip in the DB
            const existingTripId = await getLatestActiveTripId(vehicleId);
            if (existingTripId) {
              // Reuse existing trip ID (vehicle is already in a trip)
              activeTripId = existingTripId;
              console.log(`[scheduler] IGNITION ON ALERT reused existing trip vehicle=${vehicleId} tripId=${activeTripId}`);
            } else {
              // No active trip exists — create a new one
              activeTripId = randomUUID();
              console.log(`[scheduler] IGNITION ON ALERT created new trip vehicle=${vehicleId} tripId=${activeTripId}`);
            }
          } else if (eventType === EVENT_TYPE.IGNITION_OFF_ALERT) {
            // Reuse latest active_trip_id for IGNITION OFF
            activeTripId = await getLatestActiveTripId(vehicleId);
            console.log(`[scheduler] IGNITION OFF ALERT vehicle=${vehicleId} tripId=${activeTripId ?? 'null'}`);
          } else if (eventType === EVENT_TYPE.IDLING_ALERT || eventType === EVENT_TYPE.IDLING_TOO_LONG_ALERT) {
            // IDLING ALERT: reuse latest active_trip_id, or create new if none exists
            // This ensures idling alerts are always saved even without an active trip
            activeTripId = await getLatestActiveTripId(vehicleId);
            if (!activeTripId) {
              activeTripId = randomUUID();
              console.log(`[scheduler] ${eventType} created new trip vehicle=${vehicleId} tripId=${activeTripId}`);
            } else {
              console.log(`[scheduler] ${eventType} reused existing trip vehicle=${vehicleId} tripId=${activeTripId}`);
            }
          } else if (eventType === EVENT_TYPE.MOVING_ALERT) {
            // MOVING ALERT: reuse latest active_trip_id, or create new if none exists
            // This ensures moving alerts are always saved even without an active trip
            activeTripId = await getLatestActiveTripId(vehicleId);
            if (!activeTripId) {
              activeTripId = randomUUID();
              console.log(`[scheduler] ${eventType} created new trip vehicle=${vehicleId} tripId=${activeTripId}`);
            } else {
              console.log(`[scheduler] ${eventType} reused existing trip vehicle=${vehicleId} tripId=${activeTripId}`);
            }
          } else {
            // All other alert types: LOCATION UPDATE, SPEEDING, LOW FUEL
            activeTripId = await getLatestActiveTripId(vehicleId);
            if (!activeTripId) {
              console.log(`[scheduler] SKIPPING ${eventType} for ${vehicleId} — no active trip found`);
              telemetrySkipped += 1;
              continue;
            }
          }

          // ── Deduplication for explicit trip boundary events ──
          if (eventType === EVENT_TYPE.IGNITION_ON_ALERT) {
            if (!activeTripId) {
              console.log(`[scheduler] SKIPPING IGNITION ON for ${vehicleId} — no active trip id`);
              telemetrySkipped += 1;
              continue;
            }
            const alreadySavedOn = await telemetryTripEventExists(vehicleId, activeTripId, EVENT_TYPE.IGNITION_ON_ALERT);
            if (alreadySavedOn) {
              console.log(`[scheduler] SKIPPING ${eventType} for ${vehicleId} — already saved for trip ${activeTripId}`);
              telemetrySkipped += 1;
              continue;
            }
          }
          if (eventType === EVENT_TYPE.IGNITION_OFF_ALERT) {
            // Check if there's an active idling alert in this same batch
            const hasActiveIdling = emittedAlerts.some(
              (ea) => ea.vehicleId === vehicleId && (ea.eventType === EVENT_TYPE.IDLING_ALERT || ea.eventType === EVENT_TYPE.IDLING_TOO_LONG_ALERT),
            );
            if (hasActiveIdling) {
              console.log(`[scheduler] SKIPPING IGNITION OFF for ${vehicleId} — active idling alert exists for this cycle`);
              telemetrySkipped += 1;
              continue;
            }
            if (!activeTripId) {
              console.log(`[scheduler] SKIPPING IGNITION OFF for ${vehicleId} — no active trip found`);
              telemetrySkipped += 1;
              continue;
            }
            const alreadySavedOff = await telemetryTripEventExists(vehicleId, activeTripId, EVENT_TYPE.IGNITION_OFF_ALERT);
            if (alreadySavedOff) {
              console.log(`[scheduler] SKIPPING ${eventType} for ${vehicleId} — already saved for trip ${activeTripId}`);
              telemetrySkipped += 1;
              continue;
            }
          }

          // ── IDLING ALERT deduplication ────────────────────
          // IMPORTANT: Dedup only blocks Telegram repeats, NOT the DB insert.
          // If Telegram was already sent for this milestone, we still save the
          // DB row but skip the duplicate Telegram.
          let shouldSkipTelegram = false;
          if ((eventType === EVENT_TYPE.IDLING_ALERT || eventType === EVENT_TYPE.IDLING_TOO_LONG_ALERT) && activeTripId) {
            const thresholdMinutes = alert.idlingThresholdReached;
            if (thresholdMinutes !== undefined && thresholdMinutes !== null) {
              const alreadyPersisted = await isIdlingMilestonePersistedDb(vehicleId, activeTripId, thresholdMinutes);
              if (alreadyPersisted) {
                // Milestone already persisted — still save the DB row but skip Telegram
                shouldSkipTelegram = true;
                console.log(`[idling-alert] Milestone ${thresholdMinutes}min already persisted for vehicle=${vehicleId} trip=${activeTripId} — will save DB but skip Telegram`);
              }
            }
          }

          console.log(`[idling-alert] before DB insert eventType=${eventType} vehicle=${vehicleId} plate=${plateNumber} idleMinutes=${alert.idlingThresholdReached ?? 'N/A'}`);

          const savedTelemetry = await insertTelemetry({
            vehicleId,
            plateNumber,
            eventType,
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
            telegramMessage: alert.message, // Telegram message only for alert rows
          });

          if (!savedTelemetry.inserted) {
            telemetrySkipped += 1;
            console.log(`[idling-alert] DB insert failed (conflict) vehicle=${vehicleId} event=${eventType} trip=${activeTripId ?? 'null'}`);
            continue;
          }

          telemetrySaved += 1;
          console.log(`[idling-alert] DB insert succeeded id=${savedTelemetry.id} vehicle=${vehicleId} event=${eventType} tripId=${activeTripId ?? 'null'}`);

          // ── Mark idling milestone as persisted ──────────
          if ((eventType === EVENT_TYPE.IDLING_ALERT || eventType === EVENT_TYPE.IDLING_TOO_LONG_ALERT) && activeTripId) {
            const thresholdMinutes = alert.idlingThresholdReached;
            if (thresholdMinutes !== undefined && thresholdMinutes !== null) {
              await markIdlingMilestonePersistedDb(vehicleId, activeTripId, thresholdMinutes);
              console.log(`[idling-alert] Marked milestone ${thresholdMinutes}min as persisted vehicle=${vehicleId} trip=${activeTripId}`);
            }
          }

          // ── STEP 3: Send Telegram AFTER DB insert succeeds ──
          // Skip Telegram if this milestone was already sent (dedup)
          if (shouldSkipTelegram) {
            console.log(`[idling-alert] Skipping Telegram (dedup) vehicle=${vehicleId} event=${eventType} telemetry_id=${savedTelemetry.id}`);
            continue;
          }

          try {
            console.log(`[idling-alert] before Telegram send telemetry_id=${savedTelemetry.id} vehicle=${vehicleId} event=${eventType}`);
            const telegram = await sendTelegram(alert.message);
            if (telegram?.ok) {
              console.log(`[idling-alert] Telegram send succeeded telemetry_id=${savedTelemetry.id} vehicle=${vehicleId} event=${eventType}`);
            } else {
              console.error(`[idling-alert] Telegram send failed telemetry_id=${savedTelemetry.id} vehicle=${vehicleId} event=${eventType}: ${telegram?.error ?? 'telegram_not_ok'}`);
            }
          } catch (telegramError) {
            console.error(`[idling-alert] Failed to send Telegram for saved telemetry_id=${savedTelemetry.id} vehicle=${vehicleId} event=${eventType}:`, errorMessage(telegramError));
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
      `location_snapshots=${locationSnapshotsSaved}`,
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
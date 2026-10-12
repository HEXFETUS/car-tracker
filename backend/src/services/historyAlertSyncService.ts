import { randomUUID } from 'node:crypto';
import {
  IDLE_ALERT_THRESHOLDS_MINUTES,
  LOW_FUEL_LITERS,
  SPEED_LIMIT_KMH,
} from '@car-tracker/tracker';
import { getPool } from '../db/db.js';
import {
  fetchCartrackVehicleHistory,
  getCartrackFleetIdentities,
  type CartrackHistoryPoint,
} from './cartrackHistoryService.js';
import { dispatchTelegramAlert, ensureTelegramAlertCompatibility, retryPendingTelegramAlerts } from './telegramAlertDispatcher.js';
import { createNotificationForRoles } from './notificationService.js';

const INITIAL_LOOKBACK_MS = 10 * 60 * 1000;
const HISTORY_OVERLAP_MS = 2 * 60 * 1000;
const MAX_HISTORY_DAYS_PER_RUN = 2;
const NOTIFICATION_ROLES = ['SUPERADMIN', 'ADMIN', 'DISPATCHER', 'HR', 'VIEWER'];

let historyAlertSchemaPromise: Promise<void> | null = null;

/**
 * History-backed alerts were introduced after the original schema bootstrap.
 * Keep this idempotent runtime guard so existing and newly provisioned
 * databases can safely run the recovery pass.
 */
async function ensureHistoryAlertSchema(): Promise<void> {
  if (!historyAlertSchemaPromise) {
    historyAlertSchemaPromise = getPool().query(`
      ALTER TABLE gps_telemetry
        ADD COLUMN IF NOT EXISTS source_event_key TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS gps_telemetry_source_event_key_uidx
        ON gps_telemetry (source_event_key)
        WHERE source_event_key IS NOT NULL;

      CREATE TABLE IF NOT EXISTS gps_history_alert_cursors (
        vehicle_id UUID PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
        last_event_at TIMESTAMPTZ,
        last_ignition BOOLEAN,
        last_speed_kmh NUMERIC,
        last_fuel_liters NUMERIC,
        last_location_name TEXT,
        idle_started_at TIMESTAMPTZ,
        last_idling_threshold_minutes INTEGER NOT NULL DEFAULT 0,
        active_trip_id UUID,
        last_error TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS gps_history_alert_delivery_retry_idx
        ON gps_telemetry (telegram_status, recorded_at)
        WHERE source_event_key IS NOT NULL
          AND telegram_status IS DISTINCT FROM 'sent';
    `).then(() => undefined).catch((error) => {
      historyAlertSchemaPromise = null;
      throw error;
    });
  }
  await historyAlertSchemaPromise;
}

interface CursorState {
  lastEventAt: string | null;
  ignition: boolean | null;
  speedKmh: number;
  fuelLiters: number | null;
  locationName: string | null;
  idleStartedAt: string | null;
  lastIdlingThresholdMinutes: number;
  activeTripId: string | null;
}

export interface HistoryAlert {
  eventType: 'IGNITION_ON' | 'IGNITION_OFF' | 'LOCATION_UPDATE' | 'SPEEDING' | 'LOW_FUEL' | 'IDLING_TOO_LONG' | 'MOTION_STARTED';
  idlingThresholdMinutes?: number | null;
}

interface NormalizedPoint {
  recordedAt: string;
  timestampMs: number;
  ignition: boolean;
  speedKmh: number;
  fuelLiters: number | null;
  locationName: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface HistoryAlertSyncSummary {
  vehiclesExamined: number;
  historyPointsExamined: number;
  alertsSaved: number;
  alertsSkipped: number;
  telegramSent: number;
  telegramFailed: number;
  vehiclesFailed: number;
}

function firstPresent(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function numeric(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'on', 'yes', 'y'].includes(normalized);
}

function normalizeLocation(value: unknown): string | null {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ').replace(/,+$/g, '').trim();
  return normalized || null;
}

function normalizePoint(point: CartrackHistoryPoint): NormalizedPoint | null {
  const rawTimestamp = firstPresent(
    point.event_time, point.event_ts, point.timestamp, point.clock,
    point.start_timestamp, point.start_time,
  );
  const timestampMs = typeof rawTimestamp === 'number'
    ? (rawTimestamp < 1e12 ? rawTimestamp * 1000 : rawTimestamp)
    : new Date(String(rawTimestamp ?? '')).getTime();
  if (!Number.isFinite(timestampMs)) return null;

  const speedKmh = numeric(firstPresent(point.speed, point.speed_kph, point.road_speed)) ?? 0;
  const latitude = numeric(point.latitude);
  const longitude = numeric(point.longitude);
  return {
    recordedAt: new Date(timestampMs).toISOString(),
    timestampMs,
    ignition: boolean(firstPresent(point.ignition, point.Ignition)),
    speedKmh,
    fuelLiters: numeric(firstPresent(point.fuel_level, point.fuelLevel, point.fuel, point.fuel_liters)),
    locationName: normalizeLocation(firstPresent(
      point.location_name, point.location, point.address, point.street,
      point.start_location, point.end_location,
    )),
    latitude: latitude != null && Math.abs(latitude) <= 90 ? latitude : null,
    longitude: longitude != null && Math.abs(longitude) <= 180 ? longitude : null,
  };
}

function sameLocation(left: string | null, right: string | null): boolean {
  return String(left ?? '').trim().toLowerCase() === String(right ?? '').trim().toLowerCase();
}

export function deriveHistoryAlerts(
  previous: CursorState,
  point: NormalizedPoint,
): { alerts: HistoryAlert[]; next: CursorState } {
  const alerts: HistoryAlert[] = [];
  const hadPrevious = previous.ignition !== null;
  const moving = point.ignition && point.speedKmh > 0;
  const wasMoving = previous.ignition === true && previous.speedKmh > 0;
  const motionStarted = hadPrevious
    && moving
    && !wasMoving
    && previous.lastIdlingThresholdMinutes > 0;

  let activeTripId = previous.activeTripId;
  if (hadPrevious && previous.ignition === false && point.ignition) {
    activeTripId = randomUUID();
    alerts.push({ eventType: 'IGNITION_ON' });
  } else if (hadPrevious && previous.ignition === true && !point.ignition) {
    alerts.push({ eventType: 'IGNITION_OFF' });
  } else if (!hadPrevious && point.ignition) {
    activeTripId = randomUUID();
  }

  // The first moving point after an alerted idle session belongs exclusively
  // to MOTION_STARTED. The cursor still advances to this location, so a normal
  // LOCATION_UPDATE resumes only after a later point changes location again.
  if (
    hadPrevious
    && moving
    && !motionStarted
    && !sameLocation(previous.locationName, point.locationName)
    && point.locationName
  ) {
    alerts.push({ eventType: 'LOCATION_UPDATE' });
  }
  if (hadPrevious && point.ignition && point.speedKmh >= SPEED_LIMIT_KMH && previous.speedKmh < SPEED_LIMIT_KMH) {
    alerts.push({ eventType: 'SPEEDING' });
  }
  const fuelBecameLow = point.fuelLiters != null
    && point.fuelLiters < LOW_FUEL_LITERS
    && (previous.fuelLiters == null
      || previous.fuelLiters >= LOW_FUEL_LITERS
      || Math.floor(previous.fuelLiters) !== Math.floor(point.fuelLiters));
  if (hadPrevious && fuelBecameLow) alerts.push({ eventType: 'LOW_FUEL' });

  let idleStartedAt = previous.idleStartedAt;
  let lastIdlingThresholdMinutes = previous.lastIdlingThresholdMinutes;
  if (point.ignition && point.speedKmh <= 0) {
    idleStartedAt ??= point.recordedAt;
    const idleMinutes = Math.floor((point.timestampMs - new Date(idleStartedAt).getTime()) / 60_000);
    for (const threshold of IDLE_ALERT_THRESHOLDS_MINUTES) {
      if (threshold > lastIdlingThresholdMinutes && idleMinutes >= threshold) {
        alerts.push({ eventType: 'IDLING_TOO_LONG', idlingThresholdMinutes: threshold });
        lastIdlingThresholdMinutes = threshold;
      }
    }
  } else {
    if (motionStarted) {
      alerts.push({ eventType: 'MOTION_STARTED' });
    }
    idleStartedAt = null;
    lastIdlingThresholdMinutes = 0;
  }

  if (!point.ignition) activeTripId = null;
  return {
    alerts,
    next: {
      lastEventAt: point.recordedAt,
      ignition: point.ignition,
      speedKmh: point.speedKmh,
      fuelLiters: point.fuelLiters,
      locationName: point.locationName,
      idleStartedAt,
      lastIdlingThresholdMinutes,
      activeTripId,
    },
  };
}

function alertMessage(plate: string, point: NormalizedPoint, alert: HistoryAlert): string {
  const title = alert.eventType.replaceAll('_', ' ');
  const details = [
    `GPS ALERT - ${title}`,
    `Vehicle: ${plate}`,
    point.locationName ? `Location: ${point.locationName}` : null,
    `Speed: ${point.speedKmh.toFixed(1)} km/h`,
    point.fuelLiters != null ? `Fuel: ${point.fuelLiters.toFixed(1)} L` : null,
    alert.idlingThresholdMinutes ? `Idling: ${alert.idlingThresholdMinutes} minutes` : null,
    `Event time: ${point.recordedAt}`,
  ].filter(Boolean);
  return details.join('\n');
}

function manilaDate(timestampMs: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestampMs));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function datesToFetch(fromMs: number, toMs: number): string[] {
  const dates: string[] = [];
  let cursor = fromMs;
  while (cursor <= toMs && dates.length < MAX_HISTORY_DAYS_PER_RUN) {
    const date = manilaDate(cursor);
    if (!dates.includes(date)) dates.push(date);
    cursor += 24 * 60 * 60 * 1000;
  }
  const finalDate = manilaDate(toMs);
  if (dates.length < MAX_HISTORY_DAYS_PER_RUN && !dates.includes(finalDate)) dates.push(finalDate);
  return dates;
}

async function loadCursor(vehicleId: string): Promise<CursorState> {
  const result = await getPool().query<{
    last_event_at: string | null; last_ignition: boolean | null; last_speed_kmh: number | null;
    last_fuel_liters: number | null; last_location_name: string | null; idle_started_at: string | null;
    last_idling_threshold_minutes: number; active_trip_id: string | null;
  }>(
    `SELECT last_event_at, last_ignition, last_speed_kmh, last_fuel_liters, last_location_name,
            idle_started_at, last_idling_threshold_minutes, active_trip_id
       FROM gps_history_alert_cursors WHERE vehicle_id = $1`,
    [vehicleId],
  );
  const row = result.rows[0];
  return {
    lastEventAt: row?.last_event_at ?? null,
    ignition: row?.last_ignition ?? null,
    speedKmh: Number(row?.last_speed_kmh ?? 0),
    fuelLiters: row?.last_fuel_liters == null ? null : Number(row.last_fuel_liters),
    locationName: row?.last_location_name ?? null,
    idleStartedAt: row?.idle_started_at ?? null,
    lastIdlingThresholdMinutes: Number(row?.last_idling_threshold_minutes ?? 0),
    activeTripId: row?.active_trip_id ?? null,
  };
}

async function saveCursor(vehicleId: string, cursor: CursorState, error: string | null = null): Promise<void> {
  await getPool().query(
    `INSERT INTO gps_history_alert_cursors
       (vehicle_id, last_event_at, last_ignition, last_speed_kmh, last_fuel_liters,
        last_location_name, idle_started_at, last_idling_threshold_minutes, active_trip_id, last_error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (vehicle_id) DO UPDATE SET
       last_event_at = EXCLUDED.last_event_at,
       last_ignition = EXCLUDED.last_ignition,
       last_speed_kmh = EXCLUDED.last_speed_kmh,
       last_fuel_liters = EXCLUDED.last_fuel_liters,
       last_location_name = EXCLUDED.last_location_name,
       idle_started_at = EXCLUDED.idle_started_at,
       last_idling_threshold_minutes = EXCLUDED.last_idling_threshold_minutes,
       active_trip_id = EXCLUDED.active_trip_id,
       last_error = EXCLUDED.last_error,
       updated_at = now()`,
    [
      vehicleId, cursor.lastEventAt, cursor.ignition, cursor.speedKmh, cursor.fuelLiters,
      cursor.locationName, cursor.idleStartedAt, cursor.lastIdlingThresholdMinutes,
      cursor.activeTripId, error,
    ],
  );
}

export async function syncHistoryBackedAlerts(options: {
  batchOffset?: number; batchLimit?: number; deadlineAtMs?: number;
} = {}): Promise<HistoryAlertSyncSummary> {
  const summary: HistoryAlertSyncSummary = {
    vehiclesExamined: 0, historyPointsExamined: 0, alertsSaved: 0,
    alertsSkipped: 0, telegramSent: 0, telegramFailed: 0, vehiclesFailed: 0,
  };
  await ensureTelegramAlertCompatibility();
  await ensureHistoryAlertSchema();
  const retries = await retryPendingTelegramAlerts({ deadlineAtMs: options.deadlineAtMs });
  summary.telegramSent += retries.sent;
  summary.telegramFailed += retries.failed;

  const identities = await getCartrackFleetIdentities();
  const identityByPlate = new Map(identities.map((item) => [item.plateNumber.toUpperCase(), item]));
  const offset = Math.max(0, Math.floor(options.batchOffset ?? 0));
  const limit = Math.max(1, Math.floor(options.batchLimit ?? (identities.length || 1)));
  const vehicles = await getPool().query<{ id: string; plate_number: string }>(
    `SELECT id, plate_number FROM vehicles
      WHERE plate_number IS NOT NULL
      ORDER BY upper(plate_number), id
      OFFSET $1 LIMIT $2`,
    [offset, limit],
  );

  for (const vehicle of vehicles.rows) {
    if (options.deadlineAtMs && Date.now() >= options.deadlineAtMs) break;
    summary.vehiclesExamined += 1;
    const identity = identityByPlate.get(vehicle.plate_number.trim().toUpperCase());
    if (!identity) {
      summary.vehiclesFailed += 1;
      continue;
    }
    let cursor = await loadCursor(vehicle.id);
    const originalCursorMs = cursor.lastEventAt
      ? new Date(cursor.lastEventAt).getTime()
      : Date.now() - INITIAL_LOOKBACK_MS;
    const fetchFromMs = originalCursorMs - HISTORY_OVERLAP_MS;
    try {
      // Check deadline before making expensive external API calls
      if (options.deadlineAtMs && Date.now() >= options.deadlineAtMs) break;
      const historyArrays = await Promise.all(datesToFetch(fetchFromMs, Date.now()).map((date) =>
        fetchCartrackVehicleHistory(identity.unitId, date, identity.plateNumber, {
          allowCurrentStatusFallback: false,
          requireBreadcrumbs: true,
        }),
      ));
      const points = historyArrays.flat()
        .map(normalizePoint)
        .filter((point): point is NormalizedPoint => point !== null)
        .sort((left, right) => left.timestampMs - right.timestampMs);

      const seenPoints = new Set<string>();
      for (const point of points) {
        const pointKey = `${point.recordedAt}|${point.latitude}|${point.longitude}|${point.speedKmh}`;
        if (seenPoints.has(pointKey) || point.timestampMs <= originalCursorMs) continue;
        seenPoints.add(pointKey);
        summary.historyPointsExamined += 1;
        const derived = deriveHistoryAlerts(cursor, point);
        for (const alert of derived.alerts) {
          const message = alertMessage(vehicle.plate_number, point, alert);
          const alertTripId = alert.eventType === 'IGNITION_OFF'
            ? cursor.activeTripId
            : derived.next.activeTripId;
          const delivered = await dispatchTelegramAlert({
            vehicleId: vehicle.id,
            plateNumber: vehicle.plate_number,
            eventType: alert.eventType,
            latitude: point.latitude,
            longitude: point.longitude,
            speedKmh: point.speedKmh,
            fuelLiters: point.fuelLiters,
            ignition: point.ignition,
            locationName: point.locationName,
            recordedAt: point.recordedAt,
            activeTripId: alertTripId,
            idlingThresholdMinutes: alert.idlingThresholdMinutes ?? null,
            idlingStartedAt: alert.eventType === 'IDLING_TOO_LONG' ? derived.next.idleStartedAt : null,
            telegramMessage: message,
            telegramStatus: null,
          }, { deadlineAtMs: options.deadlineAtMs });
          const saved = { inserted: delivered.saved, id: delivered.telemetryId };
          if (!saved.id) throw new Error('Historical alert could not acquire a durable telemetry record');
          if (delivered.outcome === 'accepted') summary.telegramSent += 1;
          else if (delivered.error) summary.telegramFailed += 1;
          if (saved.inserted && saved.id) {
            summary.alertsSaved += 1;
            if (alert.eventType === 'IDLING_TOO_LONG') {
              try {
                await createNotificationForRoles(NOTIFICATION_ROLES, {
                  type: 'gps_alert',
                  title: 'Idling Alert',
                  message: `Vehicle ${vehicle.plate_number} has been idling for ${alert.idlingThresholdMinutes} minutes.`,
                  targetUrl: '/gps-logs',
                  targetTab: 'alerts',
                  entityId: saved.id,
                });
              } catch (notificationError) {
                console.error(
                  `[history-alerts] Failed to create idling notification vehicle=${vehicle.id}:`,
                  notificationError instanceof Error ? notificationError.message : String(notificationError),
                );
              }
            }
          } else {
            summary.alertsSkipped += 1;
          }
        }
        cursor = derived.next;
        await saveCursor(vehicle.id, cursor);
      }
    } catch (error) {
      summary.vehiclesFailed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await saveCursor(vehicle.id, cursor, message.slice(0, 2000)).catch(() => {});
    }
  }
  return summary;
}

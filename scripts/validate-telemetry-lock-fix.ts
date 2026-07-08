import assert from 'node:assert/strict';
import type pg from 'pg';
import { setPoolForTest } from '../backend/src/db/db.js';
import {
  loadVehicleState,
  saveVehicleStateWithRetry,
  processIgnitionReading,
  hasRecentIgnitionEvent,
  type VehicleState,
} from '../backend/src/services/gpsVehicleStateService.js';
import { insertTelemetry } from '../backend/src/services/gpsTelemetryService.js';
import {
  handleIdlingAlertInTransaction,
  idlingMilestoneForMinutes,
  setSendTelegramForTest,
} from '../backend/src/services/scheduler.js';

type TelemetryRow = {
  id: string;
  vehicle_id: string;
  plate_number: string;
  event_type: string;
  speed_kmh: number;
  ignition: boolean;
  location_name: string | null;
  recorded_at: string;
  active_trip_id: string | null;
  idling_threshold_minutes: number | null;
};

type DedupRow = {
  vehicle_id: string;
  active_trip_id: string;
  last_alerted_duration_minutes: number;
};

const vehicleIds: Record<string, string> = {
  KAR6558: '11111111-6558-4558-8558-111111116558',
  KAR6444: '11111111-6444-4444-8444-111111116444',
};

const telemetryRows: TelemetryRow[] = [];
const dedupRows: DedupRow[] = [];
const vehicleStates = new Map<string, VehicleState & { version: number }>();
const sentTelegrams: string[] = [];
let idSequence = 1;

function normalizeEventType(eventType: string): string {
  if (eventType === 'LOCATION UPDATE' || eventType === 'LOCATION UPDATE ALERT') return 'LOCATION_UPDATE';
  if (eventType === 'IGNITION ON' || eventType === 'IGNITION ON ALERT') return 'IGNITION_ON';
  if (eventType === 'IGNITION OFF' || eventType === 'IGNITION OFF ALERT') return 'IGNITION_OFF';
  if (eventType === 'MOVING ALERT') return 'MOTION_STARTED';
  if (eventType === 'IDLING' || eventType === 'IDLING ALERT' || eventType === 'IDLING TOO LONG ALERT') return 'IDLING_TOO_LONG';
  return eventType;
}

function sameMinute(a: string, b: string): boolean {
  return Math.floor(new Date(a).getTime() / 60000) === Math.floor(new Date(b).getTime() / 60000);
}

function vehicleStateRow(state: VehicleState) {
  return {
    vehicle_id: state.vehicleId,
    ignition_state: state.ignitionState,
    last_confirmed_ignition: state.lastConfirmedIgnition,
    last_confirmed_ignition_at: state.lastConfirmedIgnitionAt,
    pending_ignition: state.pendingIgnition,
    pending_since: state.pendingSince,
    pending_poll_count: state.pendingPollCount,
    active_trip_id: state.activeTripId,
    last_packet_time: state.lastPacketTime,
    last_speed: state.lastSpeed,
    last_latitude: state.lastLatitude,
    last_longitude: state.lastLongitude,
    last_location_name: state.lastLocationName,
    last_event_type: state.lastEventType,
    updated_at: state.updatedAt,
    version: state.version,
  };
}

function makePool() {
  const handler = (sql: string, params?: unknown[]) => {
    if (sql.includes('CREATE TABLE')) return { rows: [], rowCount: 0 };
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };

    if (sql.includes('SELECT * FROM gps_vehicle_state')) {
      const vehicleId = String(params?.[0]);
      const state = vehicleStates.get(vehicleId);
      return { rows: state ? [vehicleStateRow(state)] : [] };
    }

    if (sql.includes('UPDATE gps_vehicle_state SET')) {
      const p = params as unknown[];
      const vehicleId = String(p[0]);
      const expectedVersion = Number(p[14]);
      const existing = vehicleStates.get(vehicleId);
      if (!existing || existing.version !== expectedVersion) return { rows: [], rowCount: 0 };
      vehicleStates.set(vehicleId, {
        vehicleId,
        ignitionState: p[1] as VehicleState['ignitionState'],
        lastConfirmedIgnition: Boolean(p[2]),
        lastConfirmedIgnitionAt: p[3] as string | null,
        pendingIgnition: p[4] as boolean | null,
        pendingSince: p[5] as string | null,
        pendingPollCount: Number(p[6]),
        activeTripId: p[7] as string | null,
        lastPacketTime: p[8] as string | null,
        lastSpeed: Number(p[9]),
        lastLatitude: p[10] as number | null,
        lastLongitude: p[11] as number | null,
        lastLocationName: p[12] as string | null,
        lastEventType: p[13] as string | null,
        updatedAt: new Date().toISOString(),
        version: existing.version + 1,
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('INSERT INTO gps_vehicle_state')) {
      const p = params as unknown[];
      const vehicleId = String(p[0]);
      if (vehicleStates.has(vehicleId)) return { rows: [], rowCount: 0 };
      vehicleStates.set(vehicleId, {
        vehicleId,
        ignitionState: p[1] as VehicleState['ignitionState'],
        lastConfirmedIgnition: Boolean(p[2]),
        lastConfirmedIgnitionAt: p[3] as string | null,
        pendingIgnition: p[4] as boolean | null,
        pendingSince: p[5] as string | null,
        pendingPollCount: Number(p[6]),
        activeTripId: p[7] as string | null,
        lastPacketTime: p[8] as string | null,
        lastSpeed: Number(p[9]),
        lastLatitude: p[10] as number | null,
        lastLongitude: p[11] as number | null,
        lastLocationName: p[12] as string | null,
        lastEventType: p[13] as string | null,
        updatedAt: new Date().toISOString(),
        version: 1,
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('SELECT 1 FROM gps_telemetry') && sql.includes('recorded_at >= $4::timestamptz')) {
      const [vehicleId, eventType, ignition, recordedAt, windowSeconds] = params as [string, string, boolean, string, number];
      const packetMs = new Date(recordedAt).getTime();
      const found = telemetryRows.some((row) =>
        row.vehicle_id === vehicleId &&
        row.event_type === eventType &&
        row.ignition === ignition &&
        new Date(row.recorded_at).getTime() >= packetMs - windowSeconds * 1000 &&
        new Date(row.recorded_at).getTime() <= packetMs + 5000);
      return { rows: found ? [{ '?column?': 1 }] : [] };
    }

    if (sql.includes('SELECT g.travel_order_id')) return { rows: [] };

    if (sql.includes('SELECT id, location_name')) {
      const [vehicleId, activeTripId, eventType] = params as [string, string | null, string];
      const latest = telemetryRows
        .filter((row) => row.vehicle_id === vehicleId && row.active_trip_id === activeTripId && row.event_type === eventType)
        .at(-1);
      return { rows: latest ? [{ id: latest.id, location_name: latest.location_name }] : [] };
    }

    if (sql.includes('SELECT id FROM gps_telemetry') && sql.includes('recorded_at >= $6::timestamptz')) {
      const [vehicleId, typeA, typeB, typeC, ignition, recordedAt, windowSeconds] =
        params as [string, string, string, string, boolean, string, number];
      const packetMs = new Date(recordedAt).getTime();
      const found = telemetryRows.find((row) =>
        row.vehicle_id === vehicleId &&
        [typeA, typeB, typeC].includes(row.event_type) &&
        row.ignition === ignition &&
        new Date(row.recorded_at).getTime() >= packetMs - windowSeconds * 1000);
      return { rows: found ? [{ id: found.id }] : [] };
    }

    if (sql.includes('SELECT id') && sql.includes('date_trunc') && sql.includes('gps_telemetry')) {
      const [vehicleId, eventType, recordedAt, locationName] = params as [string, string, string, string];
      const found = telemetryRows.find((row) =>
        row.vehicle_id === vehicleId &&
        normalizeEventType(row.event_type) === eventType &&
        sameMinute(row.recorded_at, recordedAt) &&
        String(row.location_name ?? '').trim().toLowerCase() === String(locationName ?? '').trim().toLowerCase());
      return { rows: found ? [{ id: found.id, latitude: null, longitude: null }] : [] };
    }

    if (sql.includes('SELECT last_alerted_duration_minutes') && sql.includes('FOR UPDATE')) {
      const [vehicleId, activeTripId] = params as [string, string];
      const found = dedupRows.find((row) => row.vehicle_id === vehicleId && row.active_trip_id === activeTripId);
      return { rows: found ? [{ last_alerted_duration_minutes: found.last_alerted_duration_minutes }] : [] };
    }

    if (sql.includes('event_type = \'IDLING_TOO_LONG\'') && sql.includes('idling_threshold_minutes = $3')) {
      const [vehicleId, activeTripId, threshold] = params as [string, string, number];
      const found = telemetryRows.find((row) =>
        row.vehicle_id === vehicleId &&
        row.active_trip_id === activeTripId &&
        row.event_type === 'IDLING_TOO_LONG' &&
        row.idling_threshold_minutes === threshold);
      return { rows: found ? [{ id: found.id }] : [] };
    }

    if (sql.includes('INSERT INTO gps_idling_dedup')) {
      const [vehicleId, activeTripId, threshold] = params as [string, string, number];
      const found = dedupRows.find((row) => row.vehicle_id === vehicleId && row.active_trip_id === activeTripId);
      if (found) found.last_alerted_duration_minutes = threshold;
      else dedupRows.push({ vehicle_id: vehicleId, active_trip_id: activeTripId, last_alerted_duration_minutes: threshold });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('INSERT INTO gps_telemetry')) {
      const p = params as unknown[];
      const id = `sim-${idSequence++}`;
      const eventType = sql.includes('IDLING_TOO_LONG') ? 'IDLING_TOO_LONG' : String(p[2]);
      const row: TelemetryRow = sql.includes('IDLING_TOO_LONG')
        ? {
            id,
            vehicle_id: String(p[0]),
            plate_number: String(p[1]),
            event_type: eventType,
            speed_kmh: Number(p[4]),
            ignition: Boolean(p[6]),
            location_name: p[7] as string | null,
            recorded_at: String(p[8]),
            active_trip_id: p[9] as string | null,
            idling_threshold_minutes: Number(p[10]),
          }
        : {
            id,
            vehicle_id: String(p[0]),
            plate_number: String(p[1]),
            event_type: eventType,
            speed_kmh: Number(p[5]),
            ignition: Boolean(p[7]),
            location_name: p[8] as string | null,
            recorded_at: String(p[11]),
            active_trip_id: p[12] as string | null,
            idling_threshold_minutes: p[13] as number | null,
          };
      telemetryRows.push(row);
      return { rows: [{ id }], rowCount: 1 };
    }

    if (sql.includes('UPDATE gps_telemetry')) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };

  return {
    query: async (sql: string, params?: unknown[]) => handler(sql, params),
    connect: async () => ({
      query: async (sql: string, params?: unknown[]) => handler(sql, params),
      release: () => undefined,
    }),
  } as unknown as pg.Pool;
}

async function processPacket(plateNumber: 'KAR6558' | 'KAR6444', recordedAt: string, ignition: boolean, speedKmh: number, locationName: string) {
  const vehicleId = vehicleIds[plateNumber];
  const state = await loadVehicleState(vehicleId);
  const previousSpeed = state.lastSpeed;
  const { newState, result } = processIgnitionReading(state, ignition, recordedAt);
  newState.lastSpeed = speedKmh;
  newState.lastLatitude = 8.48;
  newState.lastLongitude = 124.65;
  newState.lastLocationName = locationName;

  if (result.transition === 'confirmed_on') {
    const isDuplicate = await hasRecentIgnitionEvent(vehicleId, 'IGNITION_ON', true, recordedAt);
    if (!isDuplicate) {
      await insertTelemetry({
        vehicleId, plateNumber, eventType: 'IGNITION_ON', latitude: 8.48, longitude: 124.65,
        speedKmh, fuelLiters: null, ignition: true, locationName, driverId: null, toNumber: null,
        recordedAt, activeTripId: result.tripId ?? null, telegramMessage: 'IGNITION_ON',
      });
    }
  }

  if (result.transition === 'confirmed_off' && result.tripId) {
    const isDuplicate = await hasRecentIgnitionEvent(vehicleId, 'IGNITION_OFF', false, recordedAt);
    if (!isDuplicate) {
      await insertTelemetry({
        vehicleId, plateNumber, eventType: 'IGNITION_OFF', latitude: 8.48, longitude: 124.65,
        speedKmh, fuelLiters: null, ignition: false, locationName, driverId: null, toNumber: null,
        recordedAt, activeTripId: result.tripId, telegramMessage: 'IGNITION_OFF',
      });
    }
  }

  const saveResult = await saveVehicleStateWithRetry(newState, ignition, recordedAt);
  assert.equal(saveResult.saved, true);
  const savedState = saveResult.latestState;
  const activeTripId = savedState.activeTripId;

  if (!ignition || !activeTripId) return;

  if (speedKmh > 0) {
    const eventType = previousSpeed <= 0 && telemetryRows.some((row) =>
      row.vehicle_id === vehicleId && row.active_trip_id === activeTripId && row.event_type === 'IDLING_TOO_LONG')
      ? 'MOTION_STARTED'
      : 'LOCATION_UPDATE';
    await insertTelemetry({
      vehicleId, plateNumber, eventType, latitude: 8.48, longitude: 124.65,
      speedKmh, fuelLiters: null, ignition: true, locationName, driverId: null, toNumber: null,
      recordedAt, activeTripId, telegramMessage: eventType,
    });
    return;
  }

  const tripStart = telemetryRows.find((row) =>
    row.vehicle_id === vehicleId && row.active_trip_id === activeTripId && row.event_type === 'IGNITION_ON')?.recorded_at;
  const idleMinutes = tripStart ? (new Date(recordedAt).getTime() - new Date(tripStart).getTime()) / 60000 : 0;
  const threshold = idlingMilestoneForMinutes(idleMinutes);
  if (threshold !== null) {
    await handleIdlingAlertInTransaction({
      vehicleId, plateNumber, activeTripId, latitude: 8.48, longitude: 124.65,
      speedKmh, fuelLiters: null, ignition: true, locationName,
      recordedAt, idlingStartedAt: tripStart ?? recordedAt, thresholdMinutes: threshold,
      telegramMessage: `IDLING_TOO_LONG ${threshold}`,
    });
  }
}

const originalLog = console.log;
const capturedLogs: string[] = [];
console.log = (...args: unknown[]) => {
  capturedLogs.push(args.map(String).join(' '));
};

setPoolForTest(makePool());
setSendTelegramForTest(async (message) => {
  sentTelegrams.push(message);
  return { ok: true };
});

for (const plate of ['KAR6558', 'KAR6444'] as const) {
  await processPacket(plate, '2026-07-06T08:42:00.000Z', true, 0, 'Depot');
  await processPacket(plate, '2026-07-06T08:42:30.000Z', true, 0, 'Depot');
  await processPacket(plate, '2026-07-06T08:43:00.000Z', true, 24, 'Trade Street');
  await processPacket(plate, '2026-07-06T09:00:00.000Z', true, 0, 'Zone 1');
  await processPacket(plate, '2026-07-06T09:01:00.000Z', true, 0, 'Zone 1');
  await processPacket(plate, '2026-07-06T09:05:00.000Z', true, 18, 'Pueblo de Oro');
  await processPacket(plate, '2026-07-06T09:12:00.000Z', false, 0, 'Pueblo de Oro');
  await processPacket(plate, '2026-07-06T09:12:30.000Z', false, 0, 'Pueblo de Oro');
}

console.log = originalLog;
setSendTelegramForTest(null);
setPoolForTest(null);

assert.equal(capturedLogs.some((line) => line.includes('locked by another process')), false);

for (const plate of ['KAR6558', 'KAR6444'] as const) {
  const rows = telemetryRows.filter((row) => row.plate_number === plate);
  assert.equal(rows.filter((row) => row.event_type === 'IGNITION_ON').length, 1, `${plate} duplicate IGNITION_ON`);
  assert.equal(rows.filter((row) => row.event_type === 'IGNITION_OFF').length, 1, `${plate} duplicate IGNITION_OFF`);
  assert.ok(rows.some((row) => row.event_type === 'LOCATION_UPDATE'), `${plate} missing LOCATION_UPDATE`);
  assert.ok(rows.some((row) => row.event_type === 'MOTION_STARTED'), `${plate} missing MOTION_STARTED`);
  assert.ok(rows.some((row) => row.event_type === 'IDLING_TOO_LONG' && row.idling_threshold_minutes === 10), `${plate} missing 10-minute idling alert`);
}

console.table(telemetryRows.map((row) => ({
  plate: row.plate_number,
  event: row.event_type,
  threshold: row.idling_threshold_minutes ?? '',
  recorded_at: row.recorded_at,
})));
console.log(`Validation passed: ${telemetryRows.length} telemetry rows, ${sentTelegrams.length} telegram attempts, no advisory-lock skip logs.`);

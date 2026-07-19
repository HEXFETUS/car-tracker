import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type pg from 'pg';
import { formatSpeedingAlert, IDLE_ALERT_THRESHOLDS_MINUTES, SPEED_LIMIT_KMH } from '@car-tracker/tracker';
import { setPoolForTest } from '../db/db.js';
import { insertTelemetry } from './gpsTelemetryService.js';
import {
  closeIdlingDedupDb,
  hasHigherPriorityTelemetryEventForSnapshot,
  idlingMilestoneForMinutes,
  markIdlingAlertDb,
  persistIdlingAlertIfNewThreshold,
  handleIdlingAlertInTransaction,
  setSendTelegramForTest,
  shouldPersistIdlingAlertDb,
  shouldPersistMotionStartedFromPreviousState,
} from './scheduler.js';
import {
  processIgnitionReading,
  type VehicleState,
} from './gpsVehicleStateService.js';
import {
  scoreTravelOrderTripCandidate,
  syncUnlinkedGpsTripLogsToTravelOrders,
  type CandidateTripRow,
  type TravelOrderSyncRow,
} from './travelOrderSyncService.js';

type QueryCall = { sql: string; params?: unknown[] };

function makePool(handler: (sql: string, params?: unknown[]) => { rows?: unknown[]; rowCount?: number }) {
  const calls: QueryCall[] = [];
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      const result = handler(sql, params);
      return {
        rows: result.rows ?? [],
        rowCount: result.rowCount ?? result.rows?.length ?? 0,
      };
    },
    connect: async () => ({
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        const result = handler(sql, params);
        return {
          rows: result.rows ?? [],
          rowCount: result.rowCount ?? result.rows?.length ?? 0,
        };
      },
      release: () => undefined,
    }),
  };
  return { pool: pool as unknown as pg.Pool, calls };
}

const baseTelemetry = {
  vehicleId: '11111111-1111-1111-1111-111111111111',
  plateNumber: 'KAR6412',
  eventType: 'IGNITION_ON',
  latitude: 14.5,
  longitude: 121,
  speedKmh: 0,
  fuelLiters: null,
  ignition: true,
  locationName: 'Depot',
  driverId: null,
  toNumber: null,
  recordedAt: '2026-07-06T04:00:00.000Z',
  activeTripId: '22222222-2222-2222-2222-222222222222',
  telegramMessage: null,
};

function baseVehicleState(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicleId: '11111111-1111-1111-1111-111111111111',
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
    updatedAt: '2026-07-06T04:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

function trackerMilestoneForMinutes(minutes: number): number | null {
  return idlingMilestoneForMinutes(minutes);
}

afterEach(() => {
  setSendTelegramForTest(null);
  setPoolForTest(null);
});

describe('vehicle ignition state machine', () => {
  it('confirms ignition on after consecutive pending-on polls', () => {
    const pending = baseVehicleState({
      ignitionState: 'PENDING_ON',
      lastConfirmedIgnition: false,
      pendingIgnition: true,
      pendingSince: '2026-07-06T04:42:00.000Z',
      pendingPollCount: 1,
    });

    const { newState, result } = processIgnitionReading(pending, true, '2026-07-06T04:42:30.000Z');

    assert.equal(result.transition, 'confirmed_on');
    assert.equal(newState.ignitionState, 'ON');
    assert.equal(newState.lastConfirmedIgnition, true);
    assert.ok(newState.activeTripId);
  });

  it('confirms ignition off after consecutive pending-off polls', () => {
    const pending = baseVehicleState({
      ignitionState: 'PENDING_OFF',
      lastConfirmedIgnition: true,
      pendingIgnition: false,
      pendingSince: '2026-07-06T05:12:00.000Z',
      pendingPollCount: 1,
      activeTripId: '22222222-2222-2222-2222-222222222222',
    });

    const { newState, result } = processIgnitionReading(pending, false, '2026-07-06T05:12:30.000Z');

    assert.equal(result.transition, 'confirmed_off');
    assert.equal(result.tripId, '22222222-2222-2222-2222-222222222222');
    assert.equal(newState.ignitionState, 'OFF');
    assert.equal(newState.lastConfirmedIgnition, false);
    assert.equal(newState.activeTripId, null);
  });
});

describe('IGNITION_ON telemetry dedupe', () => {
  it('saves the first ignition on for a new active trip', async () => {
    const { pool, calls } = makePool((sql, params) => {
      if (sql.includes('SELECT id, latitude, longitude')) {
        assert.equal(params?.[1], baseTelemetry.activeTripId);
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO gps_telemetry')) {
        return { rows: [{ id: 'new-ignition-id' }] };
      }
      return { rows: [] };
    });
    setPoolForTest(pool);

    const result = await insertTelemetry(baseTelemetry);

    assert.deepEqual(result, { inserted: true, updated: false, id: 'new-ignition-id' });
    assert.ok(calls.some((call) => call.sql.includes('INSERT INTO gps_telemetry')));
  });

  it('does not save duplicate ignition on for the same active trip', async () => {
    const { pool, calls } = makePool((sql) => {
      if (sql.includes('SELECT id FROM gps_telemetry') && sql.includes('recorded_at >= $6::timestamptz')) {
        return { rows: [{ id: 'existing-ignition-id' }] };
      }
      if (sql.includes('INSERT INTO gps_telemetry')) {
        throw new Error('duplicate IGNITION_ON should not insert');
      }
      return { rows: [] };
    });
    setPoolForTest(pool);

    const result = await insertTelemetry(baseTelemetry);

    assert.deepEqual(result, { inserted: false, updated: false, id: 'existing-ignition-id' });
    assert.equal(calls.filter((call) => call.sql.includes('INSERT INTO gps_telemetry')).length, 0);
  });
});

describe('idling alert milestones', () => {
  it('saves at 10 minutes once, then waits until 25 and 55 minutes', () => {
    assert.equal(trackerMilestoneForMinutes(9.99), null);
    assert.equal(trackerMilestoneForMinutes(10), 10);
    assert.equal(trackerMilestoneForMinutes(12), 10);
    assert.equal(trackerMilestoneForMinutes(14), 10);
    assert.equal(trackerMilestoneForMinutes(16), 10);
    assert.equal(trackerMilestoneForMinutes(20), 10);
    assert.equal(trackerMilestoneForMinutes(25), 25);
    assert.equal(trackerMilestoneForMinutes(54.99), 25);
    assert.equal(trackerMilestoneForMinutes(55), 55);
  });

  it('continues every +30 minutes after 55', () => {
    assert.equal(trackerMilestoneForMinutes(84.99), 55);
    assert.equal(trackerMilestoneForMinutes(85), 85);
    assert.equal(trackerMilestoneForMinutes(114.99), 85);
    assert.equal(trackerMilestoneForMinutes(115), 115);
    assert.equal(trackerMilestoneForMinutes(145), 145);
  });

  it('does not save 12, 14, 16, or 20 minute repeats after 10 was saved', async () => {
    const { pool } = makePool((sql) => {
      if (sql.includes('SELECT idling_started_at, last_alerted_duration_minutes')) {
        return {
          rows: [{
            idling_started_at: '2026-07-06T04:00:00.000Z',
            last_alerted_duration_minutes: 10,
          }],
        };
      }
      return { rows: [] };
    });
    setPoolForTest(pool);

    for (const minutes of [12, 14, 16, 20]) {
      const threshold = trackerMilestoneForMinutes(minutes);
      assert.equal(threshold, 10);
      assert.equal(
        await shouldPersistIdlingAlertDb(baseTelemetry.vehicleId, baseTelemetry.activeTripId, threshold),
        false,
      );
    }
  });
});

describe('idling dedup UPSERT (fix for threshold spam)', () => {
  it('should persist at 10 when lastAlertedDurationMinutes is null', async () => {
    const { pool } = makePool((sql) => {
      if (sql.includes('SELECT idling_started_at, last_alerted_duration_minutes')) {
        return { rows: [] }; // no existing active row
      }
      return { rows: [] };
    });
    setPoolForTest(pool);

    const shouldPersist = await shouldPersistIdlingAlertDb(
      baseTelemetry.vehicleId,
      baseTelemetry.activeTripId,
      10,
    );
    assert.equal(shouldPersist, true);
  });

  it('skips 12, 13, 14, 24 when lastAlertedDurationMinutes is 10', async () => {
    const { pool } = makePool((sql) => {
      if (sql.includes('SELECT idling_started_at, last_alerted_duration_minutes')) {
        return {
          rows: [{
            idling_started_at: '2026-07-06T04:00:00.000Z',
            last_alerted_duration_minutes: 10,
          }],
        };
      }
      return { rows: [] };
    });
    setPoolForTest(pool);

    for (const minutes of [12, 13, 14, 24]) {
      const threshold = trackerMilestoneForMinutes(minutes);
      assert.equal(threshold, 10);
      assert.equal(
        await shouldPersistIdlingAlertDb(baseTelemetry.vehicleId, baseTelemetry.activeTripId, threshold),
        false,
        `should skip threshold=${threshold} at minute=${minutes}`,
      );
    }
  });

  it('persists at 25 when lastAlertedDurationMinutes is 10', async () => {
    const { pool } = makePool((sql) => {
      if (sql.includes('SELECT idling_started_at, last_alerted_duration_minutes')) {
        return {
          rows: [{
            idling_started_at: '2026-07-06T04:00:00.000Z',
            last_alerted_duration_minutes: 10,
          }],
        };
      }
      return { rows: [] };
    });
    setPoolForTest(pool);

    const shouldPersist = await shouldPersistIdlingAlertDb(
      baseTelemetry.vehicleId,
      baseTelemetry.activeTripId,
      25,
    );
    assert.equal(shouldPersist, true);
  });

  it('skips 26, 30 when lastAlertedDurationMinutes is 25', async () => {
    const { pool } = makePool((sql) => {
      if (sql.includes('SELECT idling_started_at, last_alerted_duration_minutes')) {
        return {
          rows: [{
            idling_started_at: '2026-07-06T04:00:00.000Z',
            last_alerted_duration_minutes: 25,
          }],
        };
      }
      return { rows: [] };
    });
    setPoolForTest(pool);

    for (const minutes of [26, 30]) {
      const threshold = trackerMilestoneForMinutes(minutes);
      assert.equal(threshold, 25);
      assert.equal(
        await shouldPersistIdlingAlertDb(baseTelemetry.vehicleId, baseTelemetry.activeTripId, threshold),
        false,
        `should skip threshold=${threshold} at minute=${minutes}`,
      );
    }
  });

  it('persists at 55 when lastAlertedDurationMinutes is 25', async () => {
    const { pool } = makePool((sql) => {
      if (sql.includes('SELECT idling_started_at, last_alerted_duration_minutes')) {
        return {
          rows: [{
            idling_started_at: '2026-07-06T04:00:00.000Z',
            last_alerted_duration_minutes: 25,
          }],
        };
      }
      return { rows: [] };
    });
    setPoolForTest(pool);

    const shouldPersist = await shouldPersistIdlingAlertDb(
      baseTelemetry.vehicleId,
      baseTelemetry.activeTripId,
      55,
    );
    assert.equal(shouldPersist, true);
  });

  it('only saves at 10, 25, 55 in sequence — no alerts at 12,13,14,24,26,30', () => {
    const simulatedIdleMinutes = [10, 12, 13, 24, 25, 26, 30, 55];
    const expectedThresholds = [10, 10, 10, 10, 25, 25, 25, 55];
    const alerted: number[] = [];

    for (let i = 0; i < simulatedIdleMinutes.length; i++) {
      const minutes = simulatedIdleMinutes[i];
      const threshold = trackerMilestoneForMinutes(minutes);
      assert.equal(threshold, expectedThresholds[i], `minute=${minutes} should map to threshold=${expectedThresholds[i]}`);

      // Simulate the dedup check: persist if threshold > last alerted
      const lastAlerted = alerted.length > 0 ? alerted[alerted.length - 1] : 0;
      if (threshold > lastAlerted) {
        alerted.push(threshold);
      }
    }

    // Only 10, 25, 55 should have been alerted
    assert.deepEqual(alerted, [10, 25, 55]);
  });

  it('markIdlingAlertDb UPSERT inserts new row when none exists', async () => {
    let insertCalled = false;
    const { pool } = makePool((sql, params) => {
      if (sql.includes('INSERT INTO gps_idling_dedup')) {
        insertCalled = true;
        assert.ok(params);
        assert.equal(params?.[0], baseTelemetry.vehicleId);
        assert.equal(params?.[1], baseTelemetry.activeTripId);
        assert.equal(params?.[2], 10);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });
    setPoolForTest(pool);

    await markIdlingAlertDb(
      baseTelemetry.vehicleId,
      baseTelemetry.activeTripId,
      '2026-07-06T04:00:00.000Z',
      10,
    );

    assert.equal(insertCalled, true);
  });

  it('persistIdlingAlertIfNewThreshold returns false when already alerted at 10', async () => {
    const { pool } = makePool((sql, params) => {
      if (sql.includes('SELECT last_alerted_duration_minutes') && sql.includes('FOR UPDATE')) {
        return { rows: [{ last_alerted_duration_minutes: 10 }] };
      }
      if (sql.includes('BEGIN')) return { rows: [] };
      if (sql.includes('COMMIT')) return { rows: [] };
      return { rows: [] };
    });
    setPoolForTest(pool);

    const result = await persistIdlingAlertIfNewThreshold(
      baseTelemetry.vehicleId,
      baseTelemetry.activeTripId,
      10,
    );
    assert.equal(result, false);
  });

  it('persistIdlingAlertIfNewThreshold returns true for new threshold 25 when 10 was alerted', async () => {
    let upsertCalled = false;
    const { pool } = makePool((sql, params) => {
      if (sql.includes('SELECT last_alerted_duration_minutes') && sql.includes('FOR UPDATE')) {
        return { rows: [{ last_alerted_duration_minutes: 10 }] };
      }
      if (sql.includes('INSERT INTO gps_idling_dedup')) {
        upsertCalled = true;
        assert.equal(params?.[2], 25);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('BEGIN')) return { rows: [] };
      if (sql.includes('COMMIT')) return { rows: [] };
      return { rows: [] };
    });
    setPoolForTest(pool);

    const result = await persistIdlingAlertIfNewThreshold(
      baseTelemetry.vehicleId,
      baseTelemetry.activeTripId,
      25,
    );
    assert.equal(result, true);
    assert.equal(upsertCalled, true);
  });

  it('complete event sequence: LOCATION_UPDATE, IDLING_10, MOTION_STARTED, LOCATION_UPDATE, IGNITION_OFF — no duplicates', async () => {
    const inserted: string[] = [];
    const { pool } = makePool((sql, params) => {
      if (sql.includes('INSERT INTO gps_telemetry')) {
        inserted.push(String(params?.[2]));
        return { rows: [{ id: `id-${inserted.length}` }] };
      }
      if (sql.includes('SELECT id, location_name')) return { rows: [] };
      if (sql.includes('SELECT id') && sql.includes('date_trunc')) return { rows: [] };
      return { rows: [] };
    });
    setPoolForTest(pool);

    // Simulate sequence
    const sequence = [
      { eventType: 'LOCATION_UPDATE', speedKmh: 44, locationName: 'CM Recto Avenue', ignition: true, recordedAt: '2026-07-06T03:50:00.000Z' },
      { eventType: 'IDLING_TOO_LONG', speedKmh: 0, locationName: 'CM Recto Avenue', ignition: true, recordedAt: '2026-07-06T04:01:00.000Z' },
      { eventType: 'MOTION_STARTED', speedKmh: 32, locationName: 'CM Recto Avenue', ignition: true, recordedAt: '2026-07-06T04:20:00.000Z' },
      { eventType: 'LOCATION_UPDATE', speedKmh: 35, locationName: 'Osmena Street', ignition: true, recordedAt: '2026-07-06T04:22:00.000Z' },
      { eventType: 'IGNITION_OFF', speedKmh: 0, locationName: 'Osmena Street', ignition: false, recordedAt: '2026-07-06T04:30:00.000Z' },
    ];

    for (const step of sequence) {
      const result = await insertTelemetry({
        ...baseTelemetry,
        ...step,
      });
      assert.equal(result.inserted, true, `Should insert ${step.eventType}`);
    }

    assert.deepEqual(inserted, [
      'LOCATION_UPDATE',
      'IDLING_TOO_LONG',
      'MOTION_STARTED',
      'LOCATION_UPDATE',
      'IGNITION_OFF',
    ]);
  });

  it('MOTION_STARTED suppresses same-cycle LOCATION_UPDATE in hasHigherPriorityTelemetryEventForSnapshot', () => {
    const alerts = [
      { vehicleId: baseTelemetry.vehicleId, eventType: 'MOTION_STARTED' },
      { vehicleId: baseTelemetry.vehicleId, eventType: 'LOCATION_UPDATE' },
    ];

    assert.equal(
      hasHigherPriorityTelemetryEventForSnapshot(alerts, baseTelemetry.vehicleId, 'LOCATION_UPDATE'),
      true,
    );
  });
});

describe('idling session close', () => {
  it('closes active idling session for movement or ignition off handlers', async () => {
    const { pool, calls } = makePool(() => ({ rows: [], rowCount: 1 }));
    setPoolForTest(pool);

    await closeIdlingDedupDb(baseTelemetry.vehicleId, baseTelemetry.activeTripId);

    const closeCall = calls.find((call) => call.sql.includes('SET is_active = false'));
    assert.ok(closeCall);
    assert.deepEqual(closeCall.params, [baseTelemetry.vehicleId, baseTelemetry.activeTripId]);
  });
});

describe('MOTION_STARTED transition persistence', () => {
  it('idle to speed greater than 0 saves MOTION_STARTED once, then LOCATION_UPDATE', () => {
    const idleState = {
      speedKmh: 0,
      eventType: 'IDLING_TOO_LONG',
    };
    const movingState = {
      speedKmh: 29,
      eventType: 'MOTION_STARTED',
    };

    assert.equal(
      shouldPersistMotionStartedFromPreviousState(idleState, { activeTripId: baseTelemetry.activeTripId }, 29, true),
      true,
    );
    assert.equal(
      shouldPersistMotionStartedFromPreviousState(movingState, null, 31, true),
      false,
    );
  });

  it('MOTION_STARTED followed by speed greater than 0 saves LOCATION_UPDATE', () => {
    assert.equal(
      shouldPersistMotionStartedFromPreviousState(
        { speedKmh: 35, eventType: 'MOTION_STARTED' },
        null,
        16,
        true,
      ),
      false,
    );
  });

  it('moving LOCATION_UPDATE followed by speed greater than 0 saves LOCATION_UPDATE', () => {
    assert.equal(
      shouldPersistMotionStartedFromPreviousState(
        { speedKmh: 16, eventType: 'LOCATION_UPDATE' },
        null,
        38,
        true,
      ),
      false,
    );
  });

  it('does not allow duplicate MOTION_STARTED within the same active trip while moving', () => {
    const sameTripLatestRows = [
      { speedKmh: 35, eventType: 'MOTION_STARTED' },
      { speedKmh: 16, eventType: 'LOCATION_UPDATE' },
      { speedKmh: 38, eventType: 'LOCATION_UPDATE' },
    ];

    for (const latestRow of sameTripLatestRows) {
      assert.equal(
        shouldPersistMotionStartedFromPreviousState(latestRow, { activeTripId: baseTelemetry.activeTripId }, 42, true),
        false,
      );
    }
  });

  it('stopped previous speed to speed greater than 0 uses the existing active_trip_id', async () => {
    let insertedParams: unknown[] | undefined;
    const { pool } = makePool((sql, params) => {
      if (sql.includes('SELECT id') && sql.includes('date_trunc')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO gps_telemetry')) {
        insertedParams = params;
        return { rows: [{ id: 'motion-started-id' }] };
      }
      return { rows: [] };
    });
    setPoolForTest(pool);

    const result = await insertTelemetry({
      ...baseTelemetry,
      eventType: 'MOTION_STARTED',
      speedKmh: 29,
      recordedAt: '2026-07-06T04:01:00.000Z',
    });

    assert.deepEqual(result, { inserted: true, updated: false, id: 'motion-started-id' });
    assert.equal(insertedParams?.[2], 'MOTION_STARTED');
    assert.equal(insertedParams?.[12], baseTelemetry.activeTripId);
  });

  it('tracker-emitted MOTION_STARTED stays MOTION_STARTED, not LOCATION_UPDATE', async () => {
    let insertedEventType: unknown;
    const { pool } = makePool((sql, params) => {
      if (sql.includes('SELECT id') && sql.includes('date_trunc')) {
        assert.equal(params?.[1], 'MOTION_STARTED');
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO gps_telemetry')) {
        insertedEventType = params?.[2];
        return { rows: [{ id: 'emitted-motion-id' }] };
      }
      return { rows: [] };
    });
    setPoolForTest(pool);

    await insertTelemetry({
      ...baseTelemetry,
      eventType: 'MOTION_STARTED',
      speedKmh: 29,
      recordedAt: '2026-07-06T04:02:00.000Z',
    });

    assert.equal(insertedEventType, 'MOTION_STARTED');
  });
});

describe('DB-backed telemetry event sequence', () => {
  it('saves moving, idling, motion started, then moving location update in order', async () => {
    const insertedEventTypes: string[] = [];
    const { pool } = makePool((sql, params) => {
      if (sql.includes('SELECT id') && sql.includes('date_trunc')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO gps_telemetry')) {
        insertedEventTypes.push(String(params?.[2]));
        return { rows: [{ id: `telemetry-${insertedEventTypes.length}` }] };
      }
      return { rows: [] };
    });
    setPoolForTest(pool);

    const sequence = [
      { eventType: 'LOCATION_UPDATE', speedKmh: 44, locationName: 'CM Recto Avenue', recordedAt: '2026-07-06T03:50:00.000Z' },
      { eventType: 'IDLING_TOO_LONG', speedKmh: 0, locationName: 'CM Recto Avenue', recordedAt: '2026-07-06T04:01:00.000Z' },
      { eventType: 'MOTION_STARTED', speedKmh: 32, locationName: 'CM Recto Avenue', recordedAt: '2026-07-06T04:20:00.000Z' },
      { eventType: 'LOCATION_UPDATE', speedKmh: 35, locationName: 'Osmena Street', recordedAt: '2026-07-06T04:22:00.000Z' },
    ];

    for (const step of sequence) {
      const result = await insertTelemetry({
        ...baseTelemetry,
        ...step,
        ignition: true,
      });
      assert.equal(result.inserted, true);
    }

    assert.deepEqual(insertedEventTypes, [
      'LOCATION_UPDATE',
      'IDLING_TOO_LONG',
      'MOTION_STARTED',
      'LOCATION_UPDATE',
    ]);
  });
});

describe('speeding telemetry rules', () => {
  async function insertSpeedSnapshot(speedKmh: number) {
    let insertedEventType: string | undefined;
    const { pool, calls } = makePool((sql, params) => {
      if (sql.includes('SELECT id, location_name')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT id') && sql.includes('date_trunc')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO gps_telemetry')) {
        insertedEventType = String(params?.[2]);
        return { rows: [{ id: `${insertedEventType?.toLowerCase()}-${speedKmh}` }] };
      }
      return { rows: [] };
    });
    setPoolForTest(pool);

    const eventType = speedKmh >= SPEED_LIMIT_KMH ? 'SPEEDING' : 'LOCATION_UPDATE';
    const result = await insertTelemetry({
      ...baseTelemetry,
      eventType,
      speedKmh,
      locationName: `Road ${speedKmh}`,
      recordedAt: `2026-07-06T04:${String(speedKmh - 80).padStart(2, '0')}:00.000Z`,
    });

    return { result, insertedEventType, calls };
  }

  it('speed 89 saves LOCATION_UPDATE only', async () => {
    const { result, insertedEventType, calls } = await insertSpeedSnapshot(89);

    assert.equal(SPEED_LIMIT_KMH, 90);
    assert.equal(result.inserted, true);
    assert.equal(insertedEventType, 'LOCATION_UPDATE');
    assert.equal(calls.filter((call) => call.sql.includes('INSERT INTO gps_telemetry')).length, 1);
  });

  it('speed 90 saves SPEEDING only', async () => {
    const { result, insertedEventType, calls } = await insertSpeedSnapshot(90);

    assert.equal(result.inserted, true);
    assert.equal(insertedEventType, 'SPEEDING');
    assert.equal(calls.filter((call) => call.sql.includes('INSERT INTO gps_telemetry')).length, 1);
  });

  it('speed 92 saves SPEEDING only', async () => {
    const { result, insertedEventType, calls } = await insertSpeedSnapshot(92);

    assert.equal(result.inserted, true);
    assert.equal(insertedEventType, 'SPEEDING');
    assert.equal(calls.filter((call) => call.sql.includes('INSERT INTO gps_telemetry')).length, 1);
  });

  it('does not allow LOCATION_UPDATE for the same snapshot when SPEEDING is emitted', () => {
    const alerts = [
      { vehicleId: baseTelemetry.vehicleId, eventType: 'SPEEDING' },
      { vehicleId: baseTelemetry.vehicleId, eventType: 'LOCATION_UPDATE' },
    ];

    assert.equal(
      hasHigherPriorityTelemetryEventForSnapshot(alerts, baseTelemetry.vehicleId, 'LOCATION_UPDATE'),
      true,
    );
    assert.equal(
      hasHigherPriorityTelemetryEventForSnapshot(alerts, baseTelemetry.vehicleId, 'SPEEDING'),
      false,
    );
  });

  it('formats speeding Telegram message with speed, limit, and excess', () => {
    const message = formatSpeedingAlert('KAR6412', 92, 'CM Recto Avenue', '2026-07-06T04:00:00.000Z');

    assert.match(message, /Speed: 92 km\/h/);
    assert.match(message, /Limit: 90 km\/h/);
    assert.match(message, /Excess: \+2 km\/h over limit/);
  });
});

describe('active trip travel order scoring', () => {
  const travelOrder: TravelOrderSyncRow = {
    id: 'to-1',
    vehicle_id: baseTelemetry.vehicleId,
    driver_id: 'driver-1',
    status: 'APPROVED',
    scheduled_departure: '2026-07-06 08:00:00',
    scheduled_arrival: '2026-07-06 10:00:00',
    lat_long_destination: '8.4811,124.6459',
    to_number: 'TO-2026-0001',
  };

  function candidate(id: string, departure: string): CandidateTripRow {
    return {
      id,
      vehicle_id: baseTelemetry.vehicleId,
      driver_id: 'driver-1',
      active_trip_id: `${id}-trip`,
      departure_time_gps: departure,
      arrival_time_gps: null,
      coordinates_destination: null,
      travel_order_id: null,
      to_status_auto: null,
      trip_status_gps: 'EN ROUTE',
      latest_latitude: null,
      latest_longitude: null,
      latest_recorded_at: null,
    };
  }

  it('scores the closest IGNITION_ON highest inside the departure window', () => {
    const early = scoreTravelOrderTripCandidate(travelOrder, candidate('early', '2026-07-06 07:54:00'));
    const close = scoreTravelOrderTripCandidate(travelOrder, candidate('close', '2026-07-06 08:03:00'));
    const late = scoreTravelOrderTripCandidate(travelOrder, candidate('late', '2026-07-06 10:42:00'));

    assert.ok(early);
    assert.ok(close);
    assert.equal(late, null);
    assert.ok(close.score > early.score);
  });

  it('does not reject missing driver but rewards matching driver', () => {
    const withoutDriver = scoreTravelOrderTripCandidate(travelOrder, { ...candidate('no-driver', '2026-07-06 08:03:00'), driver_id: null });
    const withDriver = scoreTravelOrderTripCandidate(travelOrder, candidate('with-driver', '2026-07-06 08:03:00'));

    assert.ok(withoutDriver);
    assert.ok(withDriver);
    assert.ok(withDriver.score > withoutDriver.score);
  });

  it('respects manual trip assignments', () => {
    const manual = scoreTravelOrderTripCandidate(travelOrder, {
      ...candidate('manual', '2026-07-06 08:03:00'),
      travel_order_id: 'different-to',
      to_status_auto: 'manual',
    });

    assert.equal(manual, null);
  });

  it('manual sync links an existing unlinked gps_trip_logs row and backfills telemetry', async () => {
    const gpsTripLogId = 'gps-trip-1';
    const travelOrderId = 'to-1';
    const activeTripId = '8794ea2d-f520-475b-8527-e502c3bbfa27';
    const updateCalls: QueryCall[] = [];
    const { pool, calls } = makePool((sql, params) => {
      if (sql.includes('FROM gps_trip_logs') && sql.includes('travel_order_id IS NULL') && sql.includes('LIMIT $1')) {
        return { rows: [{ id: gpsTripLogId }] };
      }
      if (sql.includes('WHERE g.id = $1')) {
        return {
          rows: [{
            id: gpsTripLogId,
            vehicle_id: baseTelemetry.vehicleId,
            driver_id: 'driver-1',
            active_trip_id: activeTripId,
            departure_time_gps: '2026-07-06 08:03:00',
            arrival_time_gps: '2026-07-06 08:37:00',
            coordinates_destination: null,
            travel_order_id: null,
            to_status_auto: 'NO_APPROVED_TO',
            trip_status_gps: 'COMPLETED',
            latest_latitude: null,
            latest_longitude: null,
            latest_recorded_at: null,
          }],
        };
      }
      if (sql.includes('FROM travel_orders') && sql.includes("status IN ('APPROVED', 'ACTIVE')")) {
        return { rows: [travelOrder] };
      }
      if (sql.includes('SELECT id') && sql.includes('WHERE travel_order_id = $1')) {
        return { rows: [] };
      }
      if (sql.includes('UPDATE gps_trip_logs')) {
        updateCalls.push({ sql, params });
        return { rows: [{ id: gpsTripLogId, active_trip_id: activeTripId }], rowCount: 1 };
      }
      if (sql.includes('UPDATE gps_telemetry')) {
        updateCalls.push({ sql, params });
        return { rows: [], rowCount: 2 };
      }
      return { rows: [] };
    });
    setPoolForTest(pool);

    const result = await syncUnlinkedGpsTripLogsToTravelOrders();

    assert.equal(result.checked, 1);
    assert.equal(result.linked, 1);
    assert.equal(result.results[0].travelOrderId, travelOrderId);
    assert.equal(result.results[0].activeTripId, activeTripId);
    assert.equal(result.results[0].telemetryBackfilled, 2);
    assert.ok(updateCalls.some((call) => call.sql.includes('SET travel_order_id = $1')));
    assert.ok(calls.some((call) => call.sql.includes('COMMIT')));
  });

  it('matches Manila scheduled_departure against UTC ignition and ignores missing telemetry driver', async () => {
    const gpsTripLogId = 'gps-trip-manila-utc';
    const travelOrderId = 'a953cf00-9181-4e16-b481-08183cb84470';
    const activeTripId = '8794ea2d-f520-475b-8527-e502c3bbfa27';
    const vehicleId = 'b2c6c81c-aeb2-4b58-b0c3-6c527b91dfda';
    const driverId = '2764d3a6-e2c6-4379-80c1-4f872598224b';
    const updateCalls: QueryCall[] = [];
    const { pool } = makePool((sql, params) => {
      if (sql.includes('FROM gps_trip_logs') && sql.includes('travel_order_id IS NULL') && sql.includes('LIMIT $1')) {
        return { rows: [{ id: gpsTripLogId }] };
      }
      if (sql.includes('WHERE g.id = $1')) {
        return {
          rows: [{
            id: gpsTripLogId,
            vehicle_id: vehicleId,
            driver_id: driverId,
            active_trip_id: activeTripId,
            departure_time_gps: '2026-07-06 05:10:21.23+00',
            arrival_time_gps: '2026-07-06 05:37:23+00',
            coordinates_destination: null,
            travel_order_id: null,
            to_status_auto: 'NO_APPROVED_TO',
            trip_status_gps: 'COMPLETED',
            latest_latitude: null,
            latest_longitude: null,
            latest_recorded_at: '2026-07-06 05:10:21.23+00',
          }],
        };
      }
      if (sql.includes('FROM travel_orders') && sql.includes("status IN ('APPROVED', 'ACTIVE')")) {
        return {
          rows: [{
            id: travelOrderId,
            vehicle_id: vehicleId,
            driver_id: driverId,
            status: 'APPROVED',
            scheduled_departure: '2026-07-06 14:00:00',
            scheduled_arrival: null,
            lat_long_destination: null,
            to_number: 'TO-2026-0001',
          }],
        };
      }
      if (sql.includes('SELECT id') && sql.includes('WHERE travel_order_id = $1')) {
        return { rows: [] };
      }
      if (sql.includes('UPDATE gps_trip_logs')) {
        updateCalls.push({ sql, params });
        return { rows: [{ id: gpsTripLogId, active_trip_id: activeTripId }], rowCount: 1 };
      }
      if (sql.includes('UPDATE gps_telemetry')) {
        updateCalls.push({ sql, params });
        return { rows: [], rowCount: 3 };
      }
      return { rows: [] };
    });
    setPoolForTest(pool);

    const result = await syncUnlinkedGpsTripLogsToTravelOrders();

    assert.equal(result.checked, 1);
    assert.equal(result.linked, 1);
    assert.equal(result.results[0].travelOrderId, travelOrderId);
    assert.equal(result.results[0].activeTripId, activeTripId);
    assert.equal(result.results[0].telemetryBackfilled, 3);

    const tripUpdate = updateCalls.find((call) => call.sql.includes('UPDATE gps_trip_logs'));
    assert.ok(tripUpdate);
    assert.equal(tripUpdate.params?.[0], travelOrderId);
    assert.equal(tripUpdate.params?.[1], driverId);
    assert.equal(tripUpdate.params?.[2], activeTripId);

    const telemetryUpdate = updateCalls.find((call) => call.sql.includes('UPDATE gps_telemetry'));
    assert.ok(telemetryUpdate);
    assert.equal(telemetryUpdate.params?.[0], travelOrderId);
    assert.equal(telemetryUpdate.params?.[1], driverId);
    assert.equal(telemetryUpdate.params?.[2], activeTripId);
      assert.equal(telemetryUpdate.params?.[3], vehicleId);
  });
});

describe('idling dedup race — handleIdlingAlertInTransaction', () => {
  // Simulates a DB-backed mock that records the ORDER of operations inside
  // the transaction and enforces the dedup row BEFORE telemetry insert.
  // The mock persists gps_idling_dedup and gps_telemetry in memory so two
  // sequential "concurrent" executions at 11 minutes behave like the
  // SELECT ... FOR UPDATE + committed UPSERT would in Postgres.
  function makeIdlingMockPool() {
    const dedupRows: Array<{ vehicle_id: string; active_trip_id: string; last_alerted_duration_minutes: number }> = [];
    const telemetryRows: Array<{ vehicle_id: string; active_trip_id: string; event_type: string; idling_threshold_minutes: number; travel_order_id: string | null; driver_id: string | null }> = [];
    const sentTelegrams: string[] = [];
    const order: string[] = [];
    let dedupLock: Promise<void> = Promise.resolve();

    const handler = (sql: string, params?: unknown[]) => {
      if (sql.includes('BEGIN')) { order.push('BEGIN'); return { rows: [] }; }
      if (sql.includes('COMMIT')) { order.push('COMMIT'); return { rows: [] }; }
      if (sql.includes('ROLLBACK')) { order.push('ROLLBACK'); return { rows: [] }; }

      // SELECT ... FOR UPDATE on gps_idling_dedup
      if (sql.includes('last_alerted_duration_minutes') && sql.includes('gps_idling_dedup') && sql.includes('FOR UPDATE')) {
        const [vehicleId, activeTripId] = params as [string, string];
        const row = dedupRows.find(
          (r) => r.vehicle_id === vehicleId && r.active_trip_id === activeTripId,
        );
        order.push('LOCK_DEDUP');
        return { rows: row ? [{ last_alerted_duration_minutes: row.last_alerted_duration_minutes }] : [] };
      }

      // duplicate guard: telemetry row for trip + threshold
      if (sql.includes('gps_telemetry') && sql.includes('idling_threshold_minutes = $3')) {
        const [vehicleId, activeTripId, threshold] = params as [string, string, number];
        const found = telemetryRows.find(
          (r) => r.vehicle_id === vehicleId && r.active_trip_id === activeTripId &&
            r.event_type === 'IDLING_TOO_LONG' && r.idling_threshold_minutes === threshold,
        );
        return { rows: found ? [{ id: 'existing' }] : [] };
      }

      // UPSERT gps_idling_dedup
      if (sql.includes('INSERT INTO gps_idling_dedup')) {
        const [vehicleId, activeTripId, threshold] = params as [string, string, number];
        const existing = dedupRows.find(
          (r) => r.vehicle_id === vehicleId && r.active_trip_id === activeTripId,
        );
        if (existing) {
          existing.last_alerted_duration_minutes = threshold;
        } else {
          dedupRows.push({ vehicle_id: vehicleId, active_trip_id: activeTripId, last_alerted_duration_minutes: threshold });
        }
        order.push('UPSERT_DEDUP');
        return { rows: [], rowCount: 1 };
      }

      // INSERT gps_telemetry (idling)
      if (sql.includes('INSERT INTO gps_telemetry')) {
        const p = params as unknown[];
        const vehicleId = String(p[0]);
        const activeTripId = String(p[11]);
        const threshold = Number(p[12]);
        telemetryRows.push({
          vehicle_id: vehicleId,
          active_trip_id: activeTripId,
          event_type: 'IDLING_TOO_LONG',
          idling_threshold_minutes: threshold,
          driver_id: p[8] == null ? null : String(p[8]),
          travel_order_id: p[9] == null ? null : String(p[9]),
        });
        order.push('INSERT_TELEMETRY');
        return { rows: [{ id: `tel-${telemetryRows.length}` }] };
      }

      if (sql.includes('UPDATE gps_telemetry')) return { rows: [], rowCount: 1 };

      // ensureIdlingDedupSchema DDL — ignore
      return { rows: [] };
    };

    const calls: QueryCall[] = [];
    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        const result = handler(sql, params);
        return { rows: result.rows ?? [], rowCount: result.rowCount ?? result.rows?.length ?? 0 };
      },
      connect: async () => {
        let clientReleaseDedupLock: (() => void) | null = null;
        return {
        query: async (sql: string, params?: unknown[]) => {
          if (sql.includes('last_alerted_duration_minutes') && sql.includes('gps_idling_dedup') && sql.includes('FOR UPDATE')) {
            let releaseCurrentLock: () => void = () => undefined;
            const currentLock = new Promise<void>((resolve) => {
              releaseCurrentLock = resolve;
            });
            const previousLock = dedupLock;
            dedupLock = dedupLock.then(() => currentLock);
            await previousLock;
            clientReleaseDedupLock = releaseCurrentLock;
          }
          calls.push({ sql, params });
          const result = handler(sql, params);
          if ((sql.includes('COMMIT') || sql.includes('ROLLBACK')) && clientReleaseDedupLock) {
            clientReleaseDedupLock();
            clientReleaseDedupLock = null;
          }
          return { rows: result.rows ?? [], rowCount: result.rowCount ?? result.rows?.length ?? 0 };
        },
        release: () => {
          if (clientReleaseDedupLock) {
            clientReleaseDedupLock();
            clientReleaseDedupLock = null;
          }
        },
      };
      },
    };

    return {
      pool: pool as unknown as pg.Pool,
      calls,
      order,
      dedupRows,
      telemetryRows,
      sentTelegrams,
      // Directly intercept sendTelegram by monkeypatching is not possible here;
      // we instead record via the handler that sets telegram message. The
      // function calls the real sendTelegram; in this unit test we stub it
      // through the tracker module below.
    };
  }

  // Replace sendTelegram with a recorder for the duration of these tests.
  let sentMessages: string[] = [];

  beforeEach(() => {
    sentMessages = [];
    setSendTelegramForTest(async (message: string) => {
      sentMessages.push(message);
      return { ok: true };
    });
  });

  it('two concurrent executions at 11min → only one telemetry row + one telegram', async () => {
    const { pool, order, telemetryRows, dedupRows } = makeIdlingMockPool();
    setPoolForTest(pool);

    const baseParams = {
      vehicleId: 'vid-1',
      plateNumber: 'KAR6412',
      activeTripId: 'trip-1',
      latitude: 14.5,
      longitude: 121,
      speedKmh: 0,
      fuelLiters: null,
      ignition: true,
      locationName: 'Depot',
      recordedAt: '2026-07-06T04:11:00.000Z',
      idlingStartedAt: '2026-07-06T04:00:00.000Z',
      thresholdMinutes: 10, // 11min elapsed → idlingMilestoneForMinutes(11) = 10
      telegramMessage: '⏱ Idling for 10 minutes',
      travelOrderId: 'to-1',
      driverId: 'driver-1',
    };

    // Simulate two scheduler executions overlapping at 11 minutes.
    const [r1, r2] = await Promise.all([
      handleIdlingAlertInTransaction(baseParams),
      handleIdlingAlertInTransaction(baseParams),
    ]);

    // Exactly one telemetry row, one telegram message.
    assert.equal(telemetryRows.length, 1, 'must insert exactly one IDLING_TOO_LONG telemetry row');
    assert.equal(telemetryRows[0].travel_order_id, 'to-1');
    assert.equal(telemetryRows[0].driver_id, 'driver-1');
    assert.equal(sentMessages.length, 1, 'must send exactly one Telegram message');

    // Exactly one dedup row, with last_alerted_duration_minutes = 10.
    assert.equal(dedupRows.length, 1);
    assert.equal(dedupRows[0].last_alerted_duration_minutes, 10);

    // The dedup UPSERT happened before any telemetry insert in at least one
    // execution (ordering guarantees no telemetry before dedup).
    assert.ok(order.indexOf('UPSERT_DEDUP') < order.indexOf('INSERT_TELEMETRY') || order.indexOf('INSERT_TELEMETRY') === -1,
      'dedup UPSERT must occur before telemetry INSERT');

    const savedCount = [r1, r2].filter((r) => !r.skipped && r.telemetryId).length;
    const skippedCount = [r1, r2].filter((r) => r.skipped).length;
    assert.equal(savedCount, 1, 'exactly one execution saves telemetry');
    assert.equal(skippedCount, 1, 'the other execution is skipped by the race guard');
  });

  it('threshold is used for the message, not raw elapsed minutes', async () => {
    const { pool } = makeIdlingMockPool();
    setPoolForTest(pool);

    await handleIdlingAlertInTransaction({
      vehicleId: 'vid-2',
      plateNumber: 'KAR6412',
      activeTripId: 'trip-2',
      latitude: 14.5,
      longitude: 121,
      speedKmh: 0,
      fuelLiters: null,
      ignition: true,
      locationName: 'Depot',
      recordedAt: '2026-07-06T04:26:00.000Z',
      idlingStartedAt: '2026-07-06T04:00:00.000Z',
      thresholdMinutes: 25, // elapsed 26min → threshold 25
      telegramMessage: '⏱ Idling for 25 minutes',
      travelOrderId: 'to-2',
      driverId: 'driver-2',
    });

    assert.ok(sentMessages[0].includes('Idling for 25 minutes'), 'message must use threshold (25), not 26');
  });
});

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type pg from 'pg';
import { IDLE_ALERT_THRESHOLDS_MINUTES } from '@car-tracker/tracker';
import { setPoolForTest } from '../db/db.js';
import { insertTelemetry } from './gpsTelemetryService.js';
import { closeIdlingDedupDb, shouldPersistIdlingAlertDb } from './scheduler.js';

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

function trackerMilestoneForMinutes(minutes: number): number | null {
  const reached = IDLE_ALERT_THRESHOLDS_MINUTES.filter((threshold) => minutes >= threshold);
  return reached.length ? reached[reached.length - 1] : null;
}

afterEach(() => {
  setPoolForTest(null);
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
      if (sql.includes('SELECT id, latitude, longitude')) {
        return { rows: [{ id: 'existing-ignition-id', latitude: null, longitude: null }] };
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

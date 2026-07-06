import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type pg from 'pg';
import { IDLE_ALERT_THRESHOLDS_MINUTES } from '@car-tracker/tracker';
import { setPoolForTest } from '../db/db.js';
import { insertTelemetry } from './gpsTelemetryService.js';
import { closeIdlingDedupDb, shouldPersistIdlingAlertDb, shouldPersistMotionStartedFromPreviousState } from './scheduler.js';
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
    assert.equal(insertedParams?.[13], baseTelemetry.activeTripId);
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

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { setPoolForTest } from '../db/db.js';
import { buildNoToLifecycleTrips, syncNoToLogsFromTelemetry } from './noToLifecycleService.js';

const vehicleId = '10000000-0000-4000-8000-000000000001';
const sharedActiveTripId = '20000000-0000-4000-8000-000000000001';

function telemetry(overrides: Record<string, unknown> = {}) {
  return {
    id: '30000000-0000-4000-8000-000000000001',
    vehicle_id: vehicleId,
    plate_number: 'TEST-001',
    event_type: 'LOCATION_UPDATE',
    latitude: 8.45,
    longitude: 124.62,
    speed_kmh: 20,
    location_name: 'Fleet base',
    recorded_at: '2026-07-18T00:00:00.000Z',
    active_trip_id: sharedActiveTripId,
    driver_id: null,
    ...overrides,
  };
}

afterEach(() => setPoolForTest(null));

describe('No TO lifecycle journey boundaries', () => {
  it('keeps two origin-to-return journeys distinct when the tracker reuses one active trip id', () => {
    const trips = buildNoToLifecycleTrips([
      telemetry({ event_type: 'IGNITION_ON' }),
      telemetry({ latitude: 8.46, recorded_at: '2026-07-18T00:05:00.000Z', location_name: 'First destination' }),
      telemetry({ latitude: 8.4501, recorded_at: '2026-07-18T00:10:00.000Z', speed_kmh: 0, event_type: 'IGNITION_OFF' }),
      telemetry({ event_type: 'IGNITION_ON', recorded_at: '2026-07-18T01:00:00.000Z' }),
      telemetry({ latitude: 8.44, recorded_at: '2026-07-18T01:05:00.000Z', location_name: 'Second destination' }),
      telemetry({ latitude: 8.4501, recorded_at: '2026-07-18T01:10:00.000Z', speed_kmh: 0, event_type: 'IGNITION_OFF' }),
    ], '8.45,124.62', 10 * 60 * 1000);

    assert.equal(trips.length, 2);
    assert.equal(trips[0].startedAt, '2026-07-18T00:00:00.000Z');
    assert.equal(trips[1].startedAt, '2026-07-18T01:00:00.000Z');
    assert.equal(trips[0].arrivalAt, '2026-07-18T00:05:00.000Z');
    assert.equal(trips[1].arrivalAt, '2026-07-18T01:05:00.000Z');
  });

  it('keeps a continuous journey spanning tracker sessions as one record', () => {
    const continuationId = '20000000-0000-4000-8000-000000000002';
    const trips = buildNoToLifecycleTrips([
      telemetry({ event_type: 'IGNITION_ON' }),
      telemetry({ latitude: 8.46, recorded_at: '2026-07-18T00:05:00.000Z' }),
      telemetry({
        active_trip_id: continuationId,
        latitude: 8.4601,
        recorded_at: '2026-07-18T00:10:00.000Z',
      }),
      telemetry({
        active_trip_id: continuationId,
        latitude: 8.4501,
        recorded_at: '2026-07-18T00:15:00.000Z',
        speed_kmh: 0,
        event_type: 'IGNITION_OFF',
      }),
    ], '8.45,124.62', 10 * 60 * 1000);

    assert.equal(trips.length, 1);
    assert.deepEqual([...trips[0].activeTripIds], [sharedActiveTripId, continuationId]);
  });

  it('filters Travel Order telemetry by its bounded time window, not by the whole active trip id', async () => {
    let telemetrySql = '';
    const pool = {
      async connect() {
        return {
          async query() { return { rows: [{ pg_advisory_lock: true }], rowCount: 1 }; },
          release() {},
        };
      },
      async query(sql: string) {
        if (sql.includes('FROM gps_telemetry telemetry') && sql.includes('ORDER BY telemetry.vehicle_id')) {
          telemetrySql = sql;
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    setPoolForTest(pool as never);

    await syncNoToLogsFromTelemetry();

    assert.match(telemetrySql, /telemetry\.travel_order_id IS NOT NULL/);
    assert.match(telemetrySql, /telemetry\.recorded_at >= linked_session\.start_time/);
    assert.match(telemetrySql, /telemetry\.recorded_at <= linked_session\.end_time/);
    assert.doesNotMatch(telemetrySql, /SELECT DISTINCT active_trip_id/);
  });

  it('splits unlinked journeys around a bounded Travel Order interval', () => {
    const trips = buildNoToLifecycleTrips([
      telemetry({ event_type: 'IGNITION_ON' }),
      telemetry({ latitude: 8.46, recorded_at: '2026-07-18T00:05:00.000Z' }),
      telemetry({ recorded_at: '2026-07-18T00:10:00.000Z', is_to_linked: true }),
      telemetry({ event_type: 'IGNITION_ON', recorded_at: '2026-07-18T01:00:00.000Z' }),
      telemetry({ latitude: 8.44, recorded_at: '2026-07-18T01:05:00.000Z' }),
      telemetry({ latitude: 8.4501, recorded_at: '2026-07-18T01:10:00.000Z', speed_kmh: 0, event_type: 'IGNITION_OFF' }),
    ], '8.45,124.62', 10 * 60 * 1000);

    assert.equal(trips.length, 2);
    assert.equal(trips[0].points.some((point) => point.is_to_linked), false);
    assert.equal(trips[1].startedAt, '2026-07-18T01:00:00.000Z');
  });

  it('completes a journey that starts away and ends at the configured fleet base', () => {
    const trips = buildNoToLifecycleTrips([
      telemetry({
        event_type: 'IGNITION_ON',
        latitude: 8.474215,
        longitude: 124.630676,
        location_name: 'Away start',
      }),
      telemetry({
        latitude: 8.381879,
        longitude: 124.272789,
        recorded_at: '2026-07-18T01:00:00.000Z',
        location_name: 'Farthest point',
      }),
      telemetry({
        event_type: 'IGNITION_OFF',
        latitude: 8.454678,
        longitude: 124.623177,
        speed_kmh: 0,
        recorded_at: '2026-07-18T02:00:00.000Z',
        location_name: 'Fleet base',
      }),
    ], '8.453993,124.6229589', 10 * 60 * 1000);

    assert.equal(trips.length, 1);
    assert.equal(trips[0].status, 'COMPLETED');
    assert.equal(trips[0].endCoordinates, '8.454678,124.623177');
  });

  it('anchors a journey to the last fleet-base point before MOTION_STARTED', () => {
    const trips = buildNoToLifecycleTrips([
      telemetry({
        event_type: 'IDLING_TOO_LONG',
        latitude: 8.454448,
        longitude: 124.623131,
        speed_kmh: 0,
        recorded_at: '2026-07-18T01:55:31.000Z',
        location_name: 'Trade Street',
      }),
      telemetry({
        event_type: 'MOTION_STARTED',
        latitude: 8.46853,
        longitude: 124.627228,
        speed_kmh: 49,
        recorded_at: '2026-07-18T02:05:52.000Z',
      }),
      telemetry({
        latitude: 8.381879,
        longitude: 124.272789,
        recorded_at: '2026-07-18T05:35:41.000Z',
      }),
      telemetry({
        event_type: 'IGNITION_OFF',
        latitude: 8.454678,
        longitude: 124.623177,
        speed_kmh: 0,
        recorded_at: '2026-07-18T07:34:53.000Z',
      }),
    ], '8.453993,124.6229589', 10 * 60 * 1000);

    assert.equal(trips.length, 1);
    assert.equal(trips[0].startedAt, '2026-07-18T01:55:31.000Z');
    assert.equal(trips[0].originCoord, '8.454448,124.623131');
    assert.equal(trips[0].points[0].event_type, 'IDLING_TOO_LONG');
    assert.equal(trips[0].status, 'COMPLETED');
  });

  it('excludes telemetry that never leaves the fleet-base radius', () => {
    const trips = buildNoToLifecycleTrips([
      telemetry({ event_type: 'IGNITION_ON', latitude: 8.454618, longitude: 124.623077 }),
      telemetry({ recorded_at: '2026-07-18T00:01:00.000Z', latitude: 8.454579, longitude: 124.623245 }),
      telemetry({ event_type: 'IGNITION_OFF', speed_kmh: 0, recorded_at: '2026-07-18T00:02:00.000Z', latitude: 8.454575, longitude: 124.62326 }),
    ], '8.453993,124.6229589', 10 * 60 * 1000);

    assert.equal(trips.length, 0);
  });
});

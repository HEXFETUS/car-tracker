import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { setPoolForTest } from '../db/db.js';
import {
  buildLifecycleTrips,
  syncBusinessTripLogsFromTelemetry,
  syncCompleteTravelOrderSessions,
  syncTravelDateGpsLogs,
} from './businessTripLifecycleService.js';

const vehicleId = '10000000-0000-4000-8000-000000000001';
const travelOrderId = '20000000-0000-4000-8000-000000000001';

const order = {
  id: travelOrderId,
  vehicle_id: vehicleId,
  driver_id: '30000000-0000-4000-8000-000000000001',
  status: 'APPROVED',
  scheduled_departure: '2026-07-17T03:00:00.000Z',
  scheduled_arrival: '2026-07-17T05:00:00.000Z',
  lat_long_origin: '8.453993,124.6229589',
  lat_long_destination: '8.500000,124.700000',
  origin_location: 'Fleet base',
  destination_target: 'Planned destination',
  to_number: 'TO-TEST-0001',
  travel_date: '2026-07-17',
};

function telemetry(overrides: Record<string, unknown> = {}) {
  return {
    id: '40000000-0000-4000-8000-000000000001',
    vehicle_id: vehicleId,
    plate_number: 'TEST-001',
    event_type: 'LOCATION_UPDATE',
    latitude: 8.47,
    longitude: 124.65,
    speed_kmh: 30,
    location_name: 'Away from base',
    recorded_at: '2026-07-17T03:10:00.000Z',
    active_trip_id: '50000000-0000-4000-8000-000000000001',
    driver_id: order.driver_id,
    travel_order_id: travelOrderId,
    ...overrides,
  };
}

afterEach(() => setPoolForTest(null));

describe('business trip lifecycle travel-order telemetry matching', () => {
  it('starts a directly linked trip from MOTION_STARTED outside the base radius', () => {
    const trips = buildLifecycleTrips([
      telemetry({ event_type: 'MOTION_STARTED', latitude: 8.4585, longitude: 124.625145 }),
    ], [order]);

    assert.equal(trips.length, 1);
    assert.equal(trips[0].travelOrder.id, travelOrderId);
    assert.equal(trips[0].authoritativeTravelOrderLink, true);
    assert.equal(trips[0].originCoord, '8.4585,124.625145');
    assert.equal(trips[0].originName, 'Away from base');
  });

  it('starts a directly linked moving location update away from base', () => {
    const trips = buildLifecycleTrips([telemetry()], [order]);

    assert.equal(trips.length, 1);
    assert.equal(trips[0].travelOrder.id, travelOrderId);
  });

  it('uses the travel-order date when a valid session continues after midnight', () => {
    const trips = buildLifecycleTrips([
      telemetry({ recorded_at: '2026-07-17T15:55:00.000Z' }),
      telemetry({ recorded_at: '2026-07-18T00:10:00.000Z' }),
    ], [order]);

    assert.equal(trips[0].travelDate, '2026-07-17');
  });

  it('limits date-based creation to due, assigned, eligible travel orders', async () => {
    let insertSql = '';
    const pool = {
      async query(sql: string) {
        if (sql.includes('WITH eligible_orders')) insertSql = sql;
        return { rows: [], rowCount: 0 };
      },
    };
    setPoolForTest(pool as never);

    const result = await syncTravelDateGpsLogs();

    assert.deepEqual(result, { created: 0, updated: 0 });
    assert.match(insertSql, /status IN \('APPROVED', 'ACTIVE', 'COMPLETED'\)/);
    assert.match(insertSql, /Asia\/Manila/);
    assert.match(insertSql, /vehicle_id IS NOT NULL/);
    assert.match(insertSql, /driver_id IS NOT NULL/);
    assert.match(insertSql, /NOT EXISTS/);
  });

  it('backfills only uniquely linked, same-day sessions that start near the planned origin', async () => {
    let repairSql = '';
    const pool = {
      async query(sql: string) {
        repairSql = sql;
        return { rows: [{ sessions: 1, points: 6 }], rowCount: 1 };
      },
    };
    setPoolForTest(pool as never);

    const result = await syncCompleteTravelOrderSessions();

    assert.deepEqual(result, { sessions: 1, points: 6 });
    assert.match(repairSql, /unlinked_points > 0/);
    assert.match(repairSql, /linked_order_count = 1/);
    assert.match(repairSql, /COALESCE\(target_log\.to_status_auto, ''\) <> 'manual'/);
    assert.match(repairSql, /Asia\/Manila/);
    assert.match(repairSql, /haversine_distance\(target_order\.lat_long_origin, stats\.start_coordinates\) <= 300/);
    assert.match(repairSql, /NOT EXISTS\s*\(\s*SELECT 1\s*FROM travel_orders competing/i);
    assert.match(repairSql, /telemetry\.travel_order_id IS NULL/);
    assert.match(repairSql, /LEAST\(COALESCE\(session\.start_time, validated\.session_start\), validated\.session_start\)/);
    assert.match(repairSql, /GREATEST\(COALESCE\(session\.end_time, validated\.session_end\), validated\.session_end\)/);
  });

  it('keeps a directly linked trip when it returns before reaching the destination', () => {
    const trips = buildLifecycleTrips([
      telemetry(),
      telemetry({
        id: '40000000-0000-4000-8000-000000000002',
        recorded_at: '2026-07-17T04:00:00.000Z',
        latitude: 8.453993,
        longitude: 124.6229589,
        location_name: 'Fleet base',
      }),
    ], [order]);

    assert.equal(trips.length, 1);
    assert.equal(trips[0].matchedToTravelOrder, true);
    assert.equal(trips[0].status, 'COMPLETED');
    assert.match(trips[0].anomalyReason ?? '', /without reaching the planned destination/i);
  });

  it('preserves heuristic matching for unlinked telemetry at base', () => {
    const trips = buildLifecycleTrips([
      telemetry({
        travel_order_id: null,
        latitude: 8.453993,
        longitude: 124.6229589,
      }),
    ], [order]);

    assert.equal(trips.length, 1);
    assert.equal(trips[0].travelOrder.id, travelOrderId);
    assert.equal(trips[0].authoritativeTravelOrderLink, false);
  });

  it('does not trust cancelled or wrong-vehicle direct links', () => {
    const cancelledTrips = buildLifecycleTrips([telemetry()], [{ ...order, status: 'CANCELLED' }]);
    const wrongVehicleTrips = buildLifecycleTrips([telemetry()], [{ ...order, vehicle_id: '10000000-0000-4000-8000-000000000099' }]);

    assert.equal(cancelledTrips.length, 0);
    assert.equal(wrongVehicleTrips.length, 0);
  });

  it('switches an inferred trip when a new session belongs to the next travel day', () => {
    const nextOrder = {
      ...order,
      id: '20000000-0000-4000-8000-000000000002',
      driver_id: '30000000-0000-4000-8000-000000000002',
      to_number: 'TO-TEST-0002',
      scheduled_departure: '2026-07-18T01:00:00.000Z',
      scheduled_arrival: '2026-07-18T06:00:00.000Z',
      travel_date: '2026-07-18',
    };
    const trips = buildLifecycleTrips([
      telemetry({
        travel_order_id: null,
        latitude: 8.453993,
        longitude: 124.6229589,
      }),
      telemetry({
        id: '40000000-0000-4000-8000-000000000002',
        event_type: 'IGNITION_ON',
        recorded_at: '2026-07-18T00:30:00.000Z',
        active_trip_id: '50000000-0000-4000-8000-000000000002',
        travel_order_id: null,
        latitude: 8.453993,
        longitude: 124.6229589,
      }),
      telemetry({
        id: '40000000-0000-4000-8000-000000000003',
        recorded_at: '2026-07-18T00:31:00.000Z',
        active_trip_id: '50000000-0000-4000-8000-000000000002',
        travel_order_id: null,
        latitude: 8.453993,
        longitude: 124.6229589,
      }),
    ], [order, nextOrder]);

    assert.deepEqual(trips.map((trip) => trip.travelOrder.id), [order.id, nextOrder.id]);
    assert.equal(trips[1].travelDate, '2026-07-18');
  });

  it('preserves a directly linked trip when its session crosses midnight', () => {
    const trips = buildLifecycleTrips([
      telemetry({ recorded_at: '2026-07-17T15:55:00.000Z' }),
      telemetry({
        id: '40000000-0000-4000-8000-000000000002',
        recorded_at: '2026-07-17T16:05:00.000Z',
      }),
    ], [order]);

    assert.equal(trips.length, 1);
    assert.equal(trips[0].authoritativeTravelOrderLink, true);
    assert.deepEqual([...trips[0].activeTripIds], ['50000000-0000-4000-8000-000000000001']);
    assert.equal(trips[0].points.length, 2);
  });

  it('does not extend a travel-order trip with a new linked session on the following day', () => {
    const trips = buildLifecycleTrips([
      telemetry({ event_type: 'MOTION_STARTED' }),
      telemetry({
        id: '40000000-0000-4000-8000-000000000002',
        recorded_at: '2026-07-18T00:41:00.000Z',
        active_trip_id: '50000000-0000-4000-8000-000000000002',
        event_type: 'MOTION_STARTED',
      }),
    ], [order]);

    assert.equal(trips.length, 1);
    assert.deepEqual([...trips[0].activeTripIds], ['50000000-0000-4000-8000-000000000001']);
    assert.equal(trips[0].points.length, 1);
  });

  it('keeps additional directly linked sessions on the same Manila travel date', () => {
    const trips = buildLifecycleTrips([
      telemetry({ event_type: 'MOTION_STARTED' }),
      telemetry({
        id: '40000000-0000-4000-8000-000000000002',
        recorded_at: '2026-07-17T08:47:00.000Z',
        active_trip_id: '50000000-0000-4000-8000-000000000002',
        event_type: 'MOTION_STARTED',
      }),
    ], [order]);

    assert.equal(trips.length, 1);
    assert.deepEqual([...trips[0].activeTripIds].sort(), [
      '50000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002',
    ]);
  });

  it('finalizes a switched trip at its real last point and detects a non-moving base return', () => {
    const nextOrder = {
      ...order,
      id: '20000000-0000-4000-8000-000000000002',
      to_number: 'TO-TEST-0002',
      scheduled_departure: '2026-07-18T03:00:00.000Z',
      scheduled_arrival: '2026-07-18T05:00:00.000Z',
      travel_date: '2026-07-18',
    };
    const trips = buildLifecycleTrips([
      telemetry({ event_type: 'MOTION_STARTED' }),
      telemetry({
        id: '40000000-0000-4000-8000-000000000002',
        recorded_at: '2026-07-17T03:30:00.000Z',
        latitude: 8.5,
        longitude: 124.7,
        location_name: 'Planned destination',
      }),
      telemetry({
        id: '40000000-0000-4000-8000-000000000003',
        event_type: 'IGNITION_OFF',
        recorded_at: '2026-07-17T04:30:00.000Z',
        latitude: 8.454537,
        longitude: 124.623337,
        location_name: 'Beacon Avenue',
      }),
      telemetry({
        id: '40000000-0000-4000-8000-000000000004',
        event_type: 'MOTION_STARTED',
        recorded_at: '2026-07-18T03:10:00.000Z',
        travel_order_id: nextOrder.id,
        active_trip_id: '50000000-0000-4000-8000-000000000002',
      }),
    ], [order, nextOrder]);

    assert.equal(trips[0].destinationName, 'Beacon Avenue');
    assert.equal(trips[0].destinationCoord, '8.454537,124.623337');
    assert.equal(trips[0].returnedToBaseAt, '2026-07-17T04:30:00.000Z');
    assert.ok((trips[0].matchedOriginDistanceM ?? Infinity) < 100);
  });

  it('is idempotent and attaches multiple active sessions to one travel-order log', async () => {
    const rows = [
      telemetry({ event_type: 'MOTION_STARTED' }),
      telemetry({
        id: '40000000-0000-4000-8000-000000000002',
        event_type: 'IGNITION_OFF',
        recorded_at: '2026-07-17T03:30:00.000Z',
      }),
      telemetry({
        id: '40000000-0000-4000-8000-000000000003',
        event_type: 'MOTION_STARTED',
        recorded_at: '2026-07-17T03:45:00.000Z',
        active_trip_id: '50000000-0000-4000-8000-000000000002',
      }),
    ];
    let logExists = false;
    let insertCount = 0;
    const attachedSessions = new Set<string>();
    const executedSql: string[] = [];
    const pool = {
      async query(sql: string, params: unknown[] = []) {
        executedSql.push(sql);
        if (sql.includes('WITH eligible_orders')) {
          if (logExists) return { rows: [], rowCount: 0 };
          insertCount += 1;
          logExists = true;
          return { rows: [{ id: '60000000-0000-4000-8000-000000000001' }], rowCount: 1 };
        }
        if (sql.includes('UPDATE gps_trip_logs g')) return { rows: [], rowCount: 0 };
        if (sql.includes('FROM gps_telemetry') && sql.includes('ORDER BY vehicle_id')) return { rows };
        if (sql.includes('FROM travel_orders') && sql.includes("status IN ('APPROVED'")) return { rows: [order] };
        if (sql.includes('FROM gps_trip_logs') && sql.includes('WHERE travel_order_id = $1')) {
          return { rows: logExists ? [{ id: '60000000-0000-4000-8000-000000000001' }] : [] };
        }
        if (sql.includes('SELECT COUNT(*) AS cnt')) return { rows: [{ cnt: String(insertCount) }] };
        if (sql.includes('INSERT INTO gps_trip_logs')) {
          insertCount += 1;
          logExists = true;
          return { rows: [{ id: '60000000-0000-4000-8000-000000000001' }] };
        }
        if (sql.includes('INSERT INTO gps_trip_log_active_trips')) {
          attachedSessions.add(String(params[1]));
          return { rows: [] };
        }
        if (sql.includes('UPDATE gps_trip_logs')) {
          assert.equal(params.length, 30);
          assert.equal(params[29], order.travel_date);
          return { rows: [] };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    setPoolForTest(pool as never);

    const first = await syncBusinessTripLogsFromTelemetry();
    const second = await syncBusinessTripLogsFromTelemetry();

    assert.equal(first.created, 1);
    assert.equal(second.updated, 1);
    assert.equal(insertCount, 1);
    assert.deepEqual([...attachedSessions].sort(), [
      '50000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002',
    ]);
    assert.equal(executedSql.some((sql) => /UPDATE gps_telemetry\s+SET travel_order_id/.test(sql)), false);
  });
});

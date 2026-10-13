import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { setPoolForTest } from '../db/db.js';
import { buildNoToLifecycleTrips, upsertNoToTripLifecycle } from './noToLifecycleService.js';
import { renumberNoToRecordNos } from './noToRecordNumberService.js';

const url = process.env.NO_TO_TEST_DATABASE_URL;
test('No-TO transactions against an isolated local PostgreSQL database', { skip: !url }, async () => {
  const target = new URL(url!);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.pathname, '/no_to_test', 'never run against the application database');
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  let fixtureCreated = false;
  setPoolForTest(pool);
  try {
    await pool.query(`
      CREATE TABLE gps_no_to_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        no_to_record_no text UNIQUE NOT NULL, vehicle_id uuid, driver_id uuid,
        trip_date date NOT NULL, origin_address text, origin_coordinates text,
        destination_address text, destination_coordinates text,
        departure_time timestamp, arrival_time timestamp, distance_km numeric,
        engine_hours numeric, max_speed_kph numeric, status text,
        anomaly_flag boolean, anomaly_reason text, business_trip_status text,
        arrived_location_name text, arrived_coordinates text, destination_reached_at timestamp,
        returned_to_base_at timestamp, paused_at timestamp, pause_location text,
        resumed_at timestamp, end_address text, end_coordinates text, end_time timestamp,
        farthest_distance_m numeric, candidate_destination_address text,
        candidate_destination_coordinates text, active_trip_id uuid, parent_trip_id uuid,
        converted_gps_trip_log_id uuid, travel_order_id uuid,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE gps_no_to_log_active_trips (
        gps_no_to_log_id uuid REFERENCES gps_no_to_logs(id), active_trip_id uuid,
        start_time timestamptz, end_time timestamptz,
        PRIMARY KEY (gps_no_to_log_id, active_trip_id)
      );
      CREATE TABLE gps_telemetry (
        vehicle_id uuid, active_trip_id uuid, driver_id uuid, recorded_at timestamptz
      );
    `);
    fixtureCreated = true;
    const vehicle = '10000000-0000-4000-8000-000000000001';
    const session = '20000000-0000-4000-8000-000000000001';
    function journey(hour: number) {
      const start = Date.UTC(2026, 6, 18, hour);
      const point = (minutes: number, overrides = {}) => ({
        id: null, vehicle_id: vehicle, plate_number: 'TEST', event_type: 'IGNITION_ON',
        latitude: 8.45, longitude: 124.62, speed_kmh: 0, location_name: 'Base',
        recorded_at: new Date(start + minutes * 60000).toISOString(),
        active_trip_id: session, driver_id: null, ...overrides,
      });
      return buildNoToLifecycleTrips([point(0),
        point(5, { latitude: 8.46, speed_kmh: 20, event_type: 'LOCATION_UPDATE' }),
        point(10, { event_type: 'IGNITION_OFF' })], '8.45,124.62', 600000)[0];
    }
    const results = await Promise.all([
      upsertNoToTripLifecycle(journey(0)), upsertNoToTripLifecycle(journey(0)),
      upsertNoToTripLifecycle(journey(1)), renumberNoToRecordNos(),
    ]);
    assert.equal(results.filter(result => result === 'created').length, 2);
    assert.equal(results.filter(result => result === 'updated').length, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM gps_no_to_logs')).rows[0].count, 2);

    // Reject session writes for the third journey after its parent row was inserted.
    await pool.query(`ALTER TABLE gps_no_to_log_active_trips ADD CONSTRAINT fixture_failure
      CHECK (start_time < '2026-07-18T02:00:00Z'::timestamptz)`);
    await assert.rejects(upsertNoToTripLifecycle(journey(2)), /fixture_failure/);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM gps_no_to_logs')).rows[0].count, 2);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM gps_no_to_log_active_trips')).rows[0].count, 2);
    await pool.query('ALTER TABLE gps_no_to_log_active_trips DROP CONSTRAINT fixture_failure');

    // Make the two existing numbers a reversed permutation under the real unique key.
    await pool.query("UPDATE gps_no_to_logs SET no_to_record_no = 'fixture-' || id");
    await pool.query(`WITH ranked AS (SELECT id, row_number() OVER (ORDER BY departure_time DESC) AS rn
      FROM gps_no_to_logs) UPDATE gps_no_to_logs g
      SET no_to_record_no = 'NO-TO-2026-' || lpad(r.rn::text, 4, '0')
      FROM ranked r WHERE r.id = g.id`);
    assert.equal(await renumberNoToRecordNos(), 2);
    const numbers = await pool.query('SELECT no_to_record_no FROM gps_no_to_logs ORDER BY departure_time');
    assert.deepEqual(numbers.rows.map(row => row.no_to_record_no), ['NO-TO-2026-0001', 'NO-TO-2026-0002']);

    // Force a failure only during final assignment, after temporary values succeeded.
    await pool.query("UPDATE gps_no_to_logs SET no_to_record_no = replace(no_to_record_no, '0001', '0009')");
    await pool.query(`ALTER TABLE gps_no_to_logs ADD CONSTRAINT fixture_final_failure
      CHECK (no_to_record_no <> 'NO-TO-2026-0001')`);
    await assert.rejects(renumberNoToRecordNos(), /fixture_final_failure/);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM gps_no_to_logs WHERE no_to_record_no LIKE '__NO_TO_%'")).rows[0].count, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM gps_no_to_logs WHERE no_to_record_no = 'NO-TO-2026-0009'")).rows[0].count, 1);
    await pool.query('ALTER TABLE gps_no_to_logs DROP CONSTRAINT fixture_final_failure');
    await renumberNoToRecordNos();

    // Renumber by business year even when departure_time belongs to the preceding year.
    await pool.query("UPDATE gps_no_to_logs SET trip_date = '2027-01-01' WHERE departure_time = '2026-07-18 01:00:00'");
    assert.equal(await renumberNoToRecordNos(), 1);
    assert.equal((await pool.query("SELECT no_to_record_no FROM gps_no_to_logs WHERE trip_date = '2027-01-01'")).rows[0].no_to_record_no, 'NO-TO-2027-0001');

    await pool.query(`INSERT INTO gps_no_to_logs (no_to_record_no, trip_date, created_at)
      SELECT 'NO-TO-2028-' || (10000 + n)::text, '2028-01-01'::date,
      '2028-01-01'::timestamptz + n * interval '1 second' FROM generate_series(1, 10000) n`);
    assert.equal(await renumberNoToRecordNos(), 10000);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM gps_no_to_logs WHERE no_to_record_no = 'NO-TO-2028-10000'")).rows[0].count, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM gps_no_to_logs')).rows[0].count, 10002);
  } finally {
    setPoolForTest(null);
    try {
      if (fixtureCreated) await pool.query('DROP TABLE gps_no_to_log_active_trips, gps_no_to_logs, gps_telemetry');
    } finally {
      await pool.end();
    }
  }
});

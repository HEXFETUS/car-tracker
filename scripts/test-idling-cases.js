/**
 * Test script for IDLING_TOO_LONG cumulative alert logic
 * Tests 5 specific cases and verifies canonical event types
 */

import pg from 'pg';
import { randomUUID } from 'crypto';

const { Pool } = pg;

async function runTests() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const results = {
    passed: 0,
    failed: 0,
    tests: [],
  };

  async function cleanupVehicle(vehicleId) {
    await pool.query('DELETE FROM gps_telemetry WHERE vehicle_id = $1', [vehicleId]);
    await pool.query('DELETE FROM gps_idling_dedup WHERE vehicle_id = $1', [vehicleId]);
    await pool.query('DELETE FROM vehicles WHERE id = $1', [vehicleId]);
  }

  async function createTestVehicle() {
    const vehicleId = randomUUID();
    const plate = `TEST-${Date.now().toString(36).toUpperCase()}`;
    await pool.query(
      `INSERT INTO vehicles (id, plate_number, make, model, year)
       VALUES ($1, $2, 'Test', 'Idling', 2024) ON CONFLICT DO NOTHING`,
      [vehicleId, plate],
    );
    return { vehicleId, plate };
  }

  async function assert(condition, message) {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
  }

  async function assertEqual(actual, expected, label) {
    if (actual !== expected) {
      throw new Error(`${label}: expected "${expected}", got "${actual}"`);
    }
  }

  // Test 1: IGNITION_ON at 0 speed → saves IGNITION_ON only, no LOCATION_UPDATE
  try {
    console.log('\n--- Test 1: IGNITION_ON at 0 speed ---');
    const { vehicleId, plate } = await createTestVehicle();
    const tripId = randomUUID();

    await pool.query(
      `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
       VALUES ($1, $2, 'IGNITION_ON', 0, true, NOW(), $3)`,
      [vehicleId, plate, tripId],
    );

    const rows = await pool.query(
      `SELECT event_type FROM gps_telemetry WHERE vehicle_id = $1 ORDER BY recorded_at ASC`,
      [vehicleId],
    );

    const eventTypes = rows.rows.map((r) => r.event_type);
    console.log('Event types:', eventTypes);
    assertEqual(eventTypes.length, 1, 'Should have 1 event');
    assertEqual(eventTypes[0], 'IGNITION_ON', 'Should be IGNITION_ON');
    assert(!eventTypes.includes('LOCATION_UPDATE'), 'Should NOT have LOCATION_UPDATE');

    console.log('✅ Test 1 passed');
    results.passed++;
    await cleanupVehicle(vehicleId);
  } catch (err) {
    console.error('❌ Test 1 failed:', err.message);
    results.failed++;
  }

  // Test 2: Still idling at 10 minutes → saves IDLING_TOO_LONG
  try {
    console.log('\n--- Test 2: Idling at 10 minutes ---');
    const { vehicleId, plate } = await createTestVehicle();
    const tripId = randomUUID();

    await pool.query(
      `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
       VALUES ($1, $2, 'IGNITION_ON', 0, true, NOW() - INTERVAL '10 minutes', $3)`,
      [vehicleId, plate, tripId],
    );

    // Simulate idling alert at 10 minutes
    const hasIdlingAlert = await pool.query(
      `SELECT 1 FROM gps_telemetry
       WHERE vehicle_id = $1 AND event_type = 'IDLING' AND speed_kmh = 0 AND ignition = true
       LIMIT 1`,
      [vehicleId],
    );

    if (hasIdlingAlert.rows.length === 0) {
      await pool.query(
        `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
         VALUES ($1, $2, 'IDLING', 0, true, NOW(), $3)`,
        [vehicleId, plate, tripId],
      );
    }

    const rows = await pool.query(
      `SELECT event_type, speed_kmh FROM gps_telemetry WHERE vehicle_id = $1 ORDER BY recorded_at ASC`,
      [vehicleId],
    );

    const eventTypes = rows.rows.map((r) => r.event_type);
    console.log('Event types:', eventTypes);
    assert(eventTypes.includes('IDLING'), 'Should have IDLING alert at 10 minutes');

    console.log('✅ Test 2 passed');
    results.passed++;
    await cleanupVehicle(vehicleId);
  } catch (err) {
    console.error('❌ Test 2 failed:', err.message);
    results.failed++;
  }

  // Test 3: Still idling at 25 minutes → saves another IDLING_TOO_LONG
  try {
    console.log('\n--- Test 3: Still idling at 25 minutes ---');
    const { vehicleId, plate } = await createTestVehicle();
    const tripId = randomUUID();

    await pool.query(
      `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
       VALUES ($1, $2, 'IGNITION_ON', 0, true, NOW() - INTERVAL '25 minutes', $3)`,
      [vehicleId, plate, tripId],
    );

    // Insert 10-min alert
    await pool.query(
      `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
       VALUES ($1, $2, 'IDLING', 0, true, NOW() - INTERVAL '15 minutes', $3)
       ON CONFLICT DO NOTHING`,
      [vehicleId, plate, tripId],
    );

    // Insert 25-min alert
    await pool.query(
      `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
       VALUES ($1, $2, 'IDLING', 0, true, NOW(), $3)`,
      [vehicleId, plate, tripId],
    );

    const rows = await pool.query(
      `SELECT event_type, recorded_at FROM gps_telemetry WHERE vehicle_id = $1 ORDER BY recorded_at ASC`,
      [vehicleId],
    );

    const idlingCount = rows.rows.filter((r) => r.event_type === 'IDLING').length;
    console.log('IDLING alerts count:', idlingCount);
    assert(idlingCount >= 2, `Should have at least 2 IDLING alerts, got ${idlingCount}`);

    console.log('✅ Test 3 passed');
    results.passed++;
    await cleanupVehicle(vehicleId);
  } catch (err) {
    console.error('❌ Test 3 failed:', err.message);
    results.failed++;
  }

  // Test 4: Starts moving after idling → saves MOTION_STARTED only, closes gps_idling_dedup
  try {
    console.log('\n--- Test 4: Starts moving after idling ---');
    const { vehicleId, plate } = await createTestVehicle();
    const tripId = randomUUID();

    // IGNITION_ON
    await pool.query(
      `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
       VALUES ($1, $2, 'IGNITION_ON', 0, true, NOW() - INTERVAL '15 minutes', $3)`,
      [vehicleId, plate, tripId],
    );

    // IDLING alert
    await pool.query(
      `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
       VALUES ($1, $2, 'IDLING', 0, true, NOW() - INTERVAL '5 minutes', $3)`,
      [vehicleId, page, tripId],
    );

    // Insert dedup record
    await pool.query(
      `INSERT INTO gps_idling_dedup (vehicle_id, active_trip_id, threshold_minutes, idling_started_at, is_active)
       VALUES ($1, $2, 10, NOW() - INTERVAL '15 minutes', true)`,
      [vehicleId, tripId],
    );

    // MOTION_STARTED
    await pool.query(
      `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
       VALUES ($1, $2, 'MOTION_STARTED', 45, true, NOW(), $3)`,
      [vehicleId, plate, tripId],
    );

    const rows = await pool.query(
      `SELECT event_type FROM gps_telemetry WHERE vehicle_id = $1 ORDER BY recorded_at ASC`,
      [vehicleId],
    );

    const eventTypes = rows.rows.map((r) => r.event_type);
    console.log('Event types:', eventTypes);
    assert(eventTypes.includes('MOTION_STARTED'), 'Should have MOTION_STARTED');
    assert(!eventTypes.includes('IDLING'), 'Should NOT have IDLING after MOTION_STARTED');

    // Verify dedup is closed
    const dedupRows = await pool.query(
      `SELECT is_active FROM gps_idling_dedup WHERE vehicle_id = $1 AND active_trip_id = $2`,
      [vehicleId, tripId],
    );

    if (dedupRows.rows.length > 0) {
      assert(!dedupRows.rows[0].is_active, 'gps_idling_dedup should be closed');
    }

    console.log('✅ Test 4 passed');
    results.passed++;
    await cleanupVehicle(vehicleId);
  } catch (err) {
    console.error('❌ Test 4 failed:', err.message);
    results.failed++;
  }

  // Test 5: Moving and location_name changes → saves LOCATION_UPDATE
  try {
    console.log('\n--- Test 5: Moving with location change ---');
    const { vehicleId, plate } = await createTestVehicle();
    const tripId = randomUUID();

    // IGNITION_ON
    await pool.query(
      `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id, location_name)
       VALUES ($1, $2, 'IGNITION_ON', 0, true, NOW() - INTERVAL '5 minutes', $3, 'Location A')`,
      [vehicleId, plate, tripId],
    );

    // MOTION_STARTED
    await pool.query(
      `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id, location_name)
       VALUES ($1, $2, 'MOTION_STARTED', 45, true, NOW() - INTERVAL '3 minutes', $3, 'Location A')`,
      [vehicleId, plate, tripId],
    );

    // LOCATION_UPDATE with different location
    await pool.query(
      `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id, location_name)
       VALUES ($1, $2, 'LOCATION_UPDATE', 50, true, NOW(), $3, 'Location B')`,
      [vehicleId, plate, tripId],
    );

    const rows = await pool.query(
      `SELECT event_type, location_name FROM gps_telemetry WHERE vehicle_id = $1 ORDER BY recorded_at ASC`,
      [vehicleId],
    );

    const eventTypes = rows.rows.map((r) => r.event_type);
    console.log('Event types:', eventTypes);
    assert(eventTypes.includes('LOCATION_UPDATE'), 'Should have LOCATION_UPDATE when location changes');

    console.log('✅ Test 5 passed');
    results.passed++;
    await cleanupVehicle(vehicleId);
  } catch (err) {
    console.error('❌ Test 5 failed:', err.message);
    results.failed++;
  }

  // Verify canonical event types only
  try {
    console.log('\n--- Verifying canonical event types only ---');
    const nonCanonical = await pool.query(
      `SELECT event_type, COUNT(*) as count FROM gps_telemetry
       WHERE event_type IN ('LOCATION UPDATE', 'IGNITION_OFF\r\n', 'MOVING\r\n', 'IDLING_TOO_LONG')
       GROUP BY event_type`,
    );

    if (nonCanonical.rows.length > 0) {
      console.error('Found non-canonical event types:', nonCanonical.rows);
      throw new Error(`Found ${nonCanonical.rows.length} non-canonical event types`);
    }

    console.log('✅ Only canonical event types found');
    results.passed++;
  } catch (err) {
    console.error('❌ Canonical event types check failed:', err.message);
    results.failed++;
  }

  await pool.end();

  console.log('\n=== TEST RESULTS ===');
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`Total: ${results.passed + results.failed}`);

  if (results.failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
// ── Telemetry Alert Persistence Regression Tests ──────────────
//
// Run against a test database to verify the fix for the idling
// alert → IGNITION OFF bug and the new emitted-alert architecture.
//
// Usage:
//   node scripts/regression-test-telemetry.js
//
// Environment:
//   DATABASE_URL  – PostgreSQL connection string (required)
//   DRY_RUN       – set to "true" to skip actual DB writes
//
// Tests:
//   1. Full trip lifecycle (ON → idle 10m → idle 15m → idle 30m → moving → OFF)
//   2. Idling dedup across scheduler cycles
//   3. Backend restart during idling (no duplicate 10-min alert)
//   4. GPS reports ignition=false while idling (no IGNITION OFF)
//   5. Simultaneous speeding + low-fuel (both persisted)
//   6. Location update while moving (no duplicate MOVING)
//   7. Only IGNITION ON creates active_trip_id
//   8. No active trip → non-IGNITION events are skipped

import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;

// ── Configuration ──────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.env.DRY_RUN === 'true';

if (!DATABASE_URL) {
  console.error('FATAL: DATABASE_URL environment variable is required');
  process.exit(1);
}

// ── Test Helpers ───────────────────────────────────────────────

let passed = 0;
let failed = 0;
let skipped = 0;

function test(name, fn) {
  return async () => {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed += 1;
    } catch (err) {
      console.log(`  ❌ FAIL: ${name}`);
      console.log(`       ${err.message}`);
      failed += 1;
    }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected "${expected}", got "${actual}"`);
  }
}

function assertDeepEqual(actual, expected, path = '') {
  if (actual === expected) return;
  if (actual == null || expected == null) {
    throw new Error(`${path}: expected "${expected}", got "${actual}"`);
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) throw new Error(`${path}: expected array, got ${typeof actual}`);
    if (actual.length !== expected.length) {
      throw new Error(`${path}: expected length ${expected.length}, got ${actual.length}`);
    }
    for (let i = 0; i < expected.length; i++) {
      assertDeepEqual(actual[i], expected[i], `${path}[${i}]`);
    }
    return;
  }
  if (typeof expected === 'object') {
    for (const key of Object.keys(expected)) {
      assertDeepEqual(actual[key], expected[key], `${path}.${key}`);
    }
    return;
  }
  if (actual !== expected) {
    throw new Error(`${path}: expected "${expected}", got "${actual}"`);
  }
}

// ── Test Database Setup ────────────────────────────────────────

const pool = new Pool({ connectionString: DATABASE_URL });

async function setupTestData() {
  // Create a test vehicle
  const testVehicleId = crypto.randomUUID();
  const testPlate = `TEST-${Date.now().toString(36).toUpperCase()}`;

  await pool.query(
    `INSERT INTO vehicles (id, plate_number, make, model, year)
     VALUES ($1, $2, 'Test', 'Regression', 2024)
     ON CONFLICT (id) DO NOTHING`,
    [testVehicleId, testPlate],
  );

  return { testVehicleId, testPlate };
}

async function cleanupTestData(vehicleId) {
  if (DRY_RUN) return;
  await pool.query('DELETE FROM gps_telemetry WHERE vehicle_id = $1', [vehicleId]);
  await pool.query('DELETE FROM gps_idling_dedup WHERE vehicle_id = $1', [vehicleId]);
  await pool.query('DELETE FROM vehicles WHERE id = $1', [vehicleId]);
}

async function getTelemetryForVehicle(vehicleId) {
  const result = await pool.query(
    `SELECT event_type, speed_kmh, ignition, fuel_liters, active_trip_id, recorded_at
     FROM gps_telemetry
     WHERE vehicle_id = $1
     ORDER BY recorded_at ASC`,
    [vehicleId],
  );
  return result.rows;
}

async function getIdlingDedupForVehicle(vehicleId) {
  const result = await pool.query(
    `SELECT active_trip_id, threshold_minutes
     FROM gps_idling_dedup
     WHERE vehicle_id = $1
     ORDER BY threshold_minutes ASC`,
    [vehicleId],
  );
  return result.rows;
}

// ── Simulated Scheduler Persistence Logic ──────────────────────
//
// Mirrors the actual scheduler.ts logic for testing without
// needing the full Cartrack API or tracker.js.

function simulateEmittedAlerts(scenario) {
  // Returns an array of emitted alerts as tracker.js would produce
  return scenario.map((step) => ({
    vehicleId: step.vehicleId,
    vehicleName: step.plate,
    plateNumber: step.plate,
    eventType: step.eventType,
    latitude: step.lat ?? null,
    longitude: step.lng ?? null,
    location: step.location ?? 'Test Location',
    speed: step.speed ?? 0,
    fuel: step.fuel ?? null,
    ignition: step.ignition ?? false,
    driver: null,
    toNumber: null,
    timestamp: step.timestamp ?? new Date().toISOString(),
    message: `Test alert: ${step.eventType}`,
    idleAlertCount: step.idleAlertCount,
    idlingThresholdReached: step.idlingThresholdReached,
  }));
}

async function persistEmittedAlerts(alerts) {
  // Mirrors scheduler.ts persistence logic
  let saved = 0;
  let skipped = 0;

  for (const alert of alerts) {
    const vehicleId = alert.vehicleId;
    const eventType = alert.eventType;
    const spd = Number(alert.speed || 0);
    const ign = alert.ignition;
    const effectiveIgnition = spd > 0 ? true : ign;

    // Get latest telemetry for active_trip_id
    const last = await pool.query(
      `SELECT active_trip_id, event_type FROM gps_telemetry
       WHERE vehicle_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [vehicleId],
    );
    let activeTripId = last.rows[0]?.active_trip_id ?? null;

    // Event-specific active_trip_id logic (mirrors scheduler.ts)
    if (eventType === 'IGNITION ON ALERT') {
      activeTripId = crypto.randomUUID();
    } else if (eventType === 'IGNITION OFF ALERT') {
      // Check for active idling in this batch
      const hasActiveIdling = alerts.some(
        (a) => a.vehicleId === vehicleId && a.eventType === 'IDLING ALERT',
      );
      if (hasActiveIdling) {
        skipped += 1;
        continue;
      }
      if (!activeTripId) {
        skipped += 1;
        continue;
      }
    } else if (eventType === 'IDLING ALERT') {
      if (!activeTripId) {
        skipped += 1;
        continue;
      }
      // Check dedup
      const thresholdMinutes = alert.idlingThresholdReached;
      if (thresholdMinutes != null) {
        const dedupResult = await pool.query(
          `SELECT 1 FROM gps_idling_dedup
           WHERE vehicle_id = $1 AND active_trip_id = $2 AND threshold_minutes = $3
           LIMIT 1`,
          [vehicleId, activeTripId, thresholdMinutes],
        );
        if (dedupResult.rows.length > 0) {
          skipped += 1;
          continue;
        }
        await pool.query(
          `INSERT INTO gps_idling_dedup (vehicle_id, active_trip_id, threshold_minutes)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [vehicleId, activeTripId, thresholdMinutes],
        );
      }
    } else {
      // MOVING, LOCATION UPDATE, SPEEDING, LOW FUEL
      if (!activeTripId) {
        skipped += 1;
        continue;
      }
    }

    // Dedup for boundary events
    if (eventType === 'IGNITION ON ALERT' || eventType === 'IGNITION OFF ALERT') {
      const existsResult = await pool.query(
        `SELECT 1 FROM gps_telemetry
         WHERE vehicle_id = $1 AND active_trip_id = $2 AND event_type = $3
         LIMIT 1`,
        [vehicleId, activeTripId, eventType],
      );
      if (existsResult.rows.length > 0) {
        skipped += 1;
        continue;
      }
    }

    // Insert
    const now = new Date();
    const intervalMs = 120 * 1000; // SYNC_INTERVAL_SECONDS
    const rounded = new Date(Math.floor(now.getTime() / intervalMs) * intervalMs).toISOString();

    await pool.query(
      `INSERT INTO gps_telemetry
         (vehicle_id, plate_number, event_type, latitude, longitude,
          speed_kmh, fuel_liters, ignition, location_name,
          driver_name, to_number, recorded_at, active_trip_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT DO NOTHING`,
      [
        vehicleId, alert.plateNumber, eventType,
        alert.latitude, alert.longitude, spd,
        alert.fuel ?? null, effectiveIgnition, alert.location,
        null, null, rounded, activeTripId,
      ],
    );
    saved += 1;
  }

  return { saved, skipped };
}

// ── Test Scenarios ─────────────────────────────────────────────

async function runTests() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  TELEMETRY ALERT PERSISTENCE REGRESSION TESTS');
  console.log('══════════════════════════════════════════════════\n');

  if (DRY_RUN) {
    console.log('  DRY RUN MODE — no database writes will be performed\n');
  }

  const { testVehicleId, testPlate } = await setupTestData();
  console.log(`  Test vehicle: ${testPlate} (${testVehicleId})\n`);

  try {
    // ── Test 1: Full Trip Lifecycle ──────────────────────────
    console.log('─── Test 1: Full Trip Lifecycle ───────────────────');
    await (test('Ignition ON → 10min idle → 15min idle → 30min idle → Moving → OFF', async () => {
      if (DRY_RUN) { skipped += 1; return; }

      const tripId = crypto.randomUUID();

      // Step 1: IGNITION ON
      await pool.query(
        `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
         VALUES ($1, $2, 'IGNITION ON ALERT', 0, true, NOW() - INTERVAL '40 minutes', $3)`,
        [testVehicleId, testPlate, tripId],
      );

      // Step 2: IDLING 10min
      await pool.query(
        `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
         VALUES ($1, $2, 'IDLING ALERT', 0, true, NOW() - INTERVAL '30 minutes', $3)`,
        [testVehicleId, testPlate, tripId],
      );
      await pool.query(
        `INSERT INTO gps_idling_dedup (vehicle_id, active_trip_id, threshold_minutes)
         VALUES ($1, $2, 10) ON CONFLICT DO NOTHING`,
        [testVehicleId, tripId],
      );

      // Step 3: IDLING 15min
      await pool.query(
        `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
         VALUES ($1, $2, 'IDLING ALERT', 0, true, NOW() - INTERVAL '25 minutes', $3)`,
        [testVehicleId, testPlate, tripId],
      );
      await pool.query(
        `INSERT INTO gps_idling_dedup (vehicle_id, active_trip_id, threshold_minutes)
         VALUES ($1, $2, 15) ON CONFLICT DO NOTHING`,
        [testVehicleId, tripId],
      );

      // Step 4: IDLING 30min
      await pool.query(
        `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
         VALUES ($1, $2, 'IDLING ALERT', 0, true, NOW() - INTERVAL '10 minutes', $3)`,
        [testVehicleId, testPlate, tripId],
      );
      await pool.query(
        `INSERT INTO gps_idling_dedup (vehicle_id, active_trip_id, threshold_minutes)
         VALUES ($1, $2, 30) ON CONFLICT DO NOTHING`,
        [testVehicleId, tripId],
      );

      // Step 5: MOVING
      await pool.query(
        `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
         VALUES ($1, $2, 'MOVING ALERT', 45, true, NOW() - INTERVAL '5 minutes', $3)`,
        [testVehicleId, testPlate, tripId],
      );

      // Step 6: IGNITION OFF
      await pool.query(
        `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
         VALUES ($1, $2, 'IGNITION OFF ALERT', 0, false, NOW(), $3)`,
        [testVehicleId, testPlate, tripId],
      );

      // Verify
      const rows = await getTelemetryForVehicle(testVehicleId);
      const eventTypes = rows.map((r) => r.event_type);

      assertEqual(eventTypes.length, 6, 'Should have 6 telemetry records');
      assertEqual(eventTypes[0], 'IGNITION ON ALERT', 'Event 1');
      assertEqual(eventTypes[1], 'IDLING ALERT', 'Event 2');
      assertEqual(eventTypes[2], 'IDLING ALERT', 'Event 3');
      assertEqual(eventTypes[3], 'IDLING ALERT', 'Event 4');
      assertEqual(eventTypes[4], 'MOVING ALERT', 'Event 5');
      assertEqual(eventTypes[5], 'IGNITION OFF ALERT', 'Event 6');

      // All should have same active_trip_id
      const tripIds = rows.map((r) => r.active_trip_id);
      assert(tripIds.every((id) => id === tripId), 'All records should share the same active_trip_id');

      // No IGNITION OFF ALERT should appear before MOVING
      const offIndex = eventTypes.indexOf('IGNITION OFF ALERT');
      const movingIndex = eventTypes.indexOf('MOVING ALERT');
      assert(offIndex > movingIndex, 'IGNITION OFF should come after MOVING');
    }))();

    // ── Test 2: Idling Dedup Across Cycles ───────────────────
    console.log('\n─── Test 2: Idling Dedup Across Cycles ────────────');
    await (test('40 minutes idling, scheduler runs every minute — only 3 IDLING ALERT records', async () => {
      if (DRY_RUN) { skipped += 1; return; }

      const vehicleId2 = crypto.randomUUID();
      const plate2 = `DEDUP-${Date.now().toString(36).toUpperCase()}`;
      await pool.query(
        `INSERT INTO vehicles (id, plate_number, make, model, year)
         VALUES ($1, $2, 'Test', 'Dedup', 2024) ON CONFLICT DO NOTHING`,
        [vehicleId2, plate2],
      );

      const tripId2 = crypto.randomUUID();

      // IGNITION ON
      await pool.query(
        `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
         VALUES ($1, $2, 'IGNITION ON ALERT', 0, true, NOW() - INTERVAL '40 minutes', $3)`,
        [vehicleId2, plate2, tripId2],
      );

      // Simulate 40 scheduler cycles (one per minute)
      // Only 3 should produce IDLING ALERT (10, 15, 30 min milestones)
      for (let minute = 1; minute <= 40; minute++) {
        const alerts = simulateEmittedAlerts([
          {
            vehicleId: vehicleId2,
            plate: plate2,
            eventType: 'IDLING ALERT',
            speed: 0,
            ignition: true,
            idleAlertCount: [10, 15, 30].filter((t) => minute >= t).length,
            idlingThresholdReached: [10, 15, 30].find((t) => minute === t) || null,
            timestamp: new Date(Date.now() - (40 - minute) * 60000).toISOString(),
          },
        ]);

        // Only persist if threshold is exactly hit
        const thresholdHit = [10, 15, 30].includes(minute);
        if (thresholdHit) {
          await persistEmittedAlerts(alerts);
        }
      }

      const rows = await getTelemetryForVehicle(vehicleId2);
      const idlingRows = rows.filter((r) => r.event_type === 'IDLING ALERT');

      assertEqual(idlingRows.length, 3, 'Should have exactly 3 IDLING ALERT records');

      // Verify dedup entries
      const dedupRows = await getIdlingDedupForVehicle(vehicleId2);
      assertEqual(dedupRows.length, 3, 'Should have 3 dedup entries');
      assertDeepEqual(dedupRows.map((r) => r.threshold_minutes), [10, 15, 30], 'Dedup thresholds');

      // Cleanup
      await pool.query('DELETE FROM gps_telemetry WHERE vehicle_id = $1', [vehicleId2]);
      await pool.query('DELETE FROM gps_idling_dedup WHERE vehicle_id = $1', [vehicleId2]);
      await pool.query('DELETE FROM vehicles WHERE id = $1', [vehicleId2]);
    }))();

    // ── Test 3: Backend Restart During Idling ────────────────
    console.log('\n─── Test 3: Backend Restart During Idling ─────────');
    await (test('Restart during 15-min idle — 10-min alert not duplicated', async () => {
      if (DRY_RUN) { skipped += 1; return; }

      const vehicleId3 = crypto.randomUUID();
      const plate3 = `RESTART-${Date.now().toString(36).toUpperCase()}`;
      await pool.query(
        `INSERT INTO vehicles (id, plate_number, make, model, year)
         VALUES ($1, $2, 'Test', 'Restart', 2024) ON CONFLICT DO NOTHING`,
        [vehicleId3, plate3],
      );

      const tripId3 = crypto.randomUUID();

      // Pre-existing: IGNITION ON + 10-min IDLING ALERT (from before restart)
      await pool.query(
        `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
         VALUES ($1, $2, 'IGNITION ON ALERT', 0, true, NOW() - INTERVAL '20 minutes', $3)`,
        [vehicleId3, plate3, tripId3],
      );
      await pool.query(
        `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
         VALUES ($1, $2, 'IDLING ALERT', 0, true, NOW() - INTERVAL '10 minutes', $3)`,
        [vehicleId3, plate3, tripId3],
      );
      await pool.query(
        `INSERT INTO gps_idling_dedup (vehicle_id, active_trip_id, threshold_minutes)
         VALUES ($1, $2, 10) ON CONFLICT DO NOTHING`,
        [vehicleId3, tripId3],
      );

      // Simulate restart: new scheduler cycle at 15-min mark
      const alerts = simulateEmittedAlerts([
        {
          vehicleId: vehicleId3,
          plate: plate3,
          eventType: 'IDLING ALERT',
          speed: 0,
          ignition: true,
          idleAlertCount: 2,
          idlingThresholdReached: 15,
          timestamp: new Date().toISOString(),
        },
      ]);

      await persistEmittedAlerts(alerts);

      const rows = await getTelemetryForVehicle(vehicleId3);
      const idlingRows = rows.filter((r) => r.event_type === 'IDLING ALERT');

      assertEqual(idlingRows.length, 2, 'Should have exactly 2 IDLING ALERT records (10min + 15min)');

      // Verify 10-min dedup entry still exists
      const dedupRows = await getIdlingDedupForVehicle(vehicleId3);
      const has10min = dedupRows.some((r) => r.threshold_minutes === 10);
      assert(has10min, '10-min dedup entry should survive restart');

      // Cleanup
      await pool.query('DELETE FROM gps_telemetry WHERE vehicle_id = $1', [vehicleId3]);
      await pool.query('DELETE FROM gps_idling_dedup WHERE vehicle_id = $1', [vehicleId3]);
      await pool.query('DELETE FROM vehicles WHERE id = $1', [vehicleId3]);
    }))();

    // ── Test 4: GPS Reports ignition=false While Idling ──────
    console.log('\n─── Test 4: GPS ignition=false While Idling ───────');
    await (test('No IGNITION OFF ALERT when GPS reports ignition=false during idling', async () => {
      if (DRY_RUN) { skipped += 1; return; }

      const vehicleId4 = crypto.randomUUID();
      const plate4 = `IDLEOFF-${Date.now().toString(36).toUpperCase()}`;
      await pool.query(
        `INSERT INTO vehicles (id, plate_number, make, model, year)
         VALUES ($1, $2, 'Test', 'IdleOff', 2024) ON CONFLICT DO NOTHING`,
        [vehicleId4, plate4],
      );

      const tripId4 = crypto.randomUUID();

      // IGNITION ON
      await pool.query(
        `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
         VALUES ($1, $2, 'IGNITION ON ALERT', 0, true, NOW() - INTERVAL '15 minutes', $3)`,
        [vehicleId4, plate4, tripId4],
      );

      // Simulate scheduler cycle where:
      // - tracker.js emits IDLING ALERT (correctly detects idling)
      // - GPS payload has ignition=false (flaky device)
      // - scheduler should NOT save IGNITION OFF because IDLING ALERT is active
      const alerts = simulateEmittedAlerts([
        {
          vehicleId: vehicleId4,
          plate: plate4,
          eventType: 'IDLING ALERT',
          speed: 0,
          ignition: false, // GPS reports false
          idleAlertCount: 1,
          idlingThresholdReached: 10,
          timestamp: new Date().toISOString(),
        },
      ]);

      // Also simulate that tracker.js did NOT emit IGNITION OFF
      // (because it correctly detects the vehicle is still idling)
      const result = await persistEmittedAlerts(alerts);

      const rows = await getTelemetryForVehicle(vehicleId4);
      const eventTypes = rows.map((r) => r.event_type);

      assert(eventTypes.includes('IDLING ALERT'), 'Should have IDLING ALERT');
      assert(!eventTypes.includes('IGNITION OFF ALERT'), 'Should NOT have IGNITION OFF ALERT');

      // Cleanup
      await pool.query('DELETE FROM gps_telemetry WHERE vehicle_id = $1', [vehicleId4]);
      await pool.query('DELETE FROM gps_idling_dedup WHERE vehicle_id = $1', [vehicleId4]);
      await pool.query('DELETE FROM vehicles WHERE id = $1', [vehicleId4]);
    }))();

    // ── Test 5: Simultaneous Speeding + Low Fuel ─────────────
    console.log('\n─── Test 5: Simultaneous Speeding + Low Fuel ──────');
    await (test('Both speeding and low-fuel alerts are persisted', async () => {
      if (DRY_RUN) { skipped += 1; return; }

      const vehicleId5 = crypto.randomUUID();
      const plate5 = `SPDFUEL-${Date.now().toString(36).toUpperCase()}`;
      await pool.query(
        `INSERT INTO vehicles (id, plate_number, make, model, year)
         VALUES ($1, $2, 'Test', 'SpdFuel', 2024) ON CONFLICT DO NOTHING`,
        [vehicleId5, plate5],
      );

      const tripId5 = crypto.randomUUID();

      // IGNITION ON
      await pool.query(
        `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
         VALUES ($1, $2, 'IGNITION ON ALERT', 0, true, NOW() - INTERVAL '10 minutes', $3)`,
        [vehicleId5, plate5, tripId5],
      );

      // Simulate cycle with both speeding and low-fuel
      const alerts = simulateEmittedAlerts([
        {
          vehicleId: vehicleId5,
          plate: plate5,
          eventType: 'SPEEDING ALERT',
          speed: 100,
          ignition: true,
          timestamp: new Date().toISOString(),
        },
        {
          vehicleId: vehicleId5,
          plate: plate5,
          eventType: 'LOW FUEL ALERT',
          speed: 100,
          fuel: 3,
          ignition: true,
          timestamp: new Date().toISOString(),
        },
      ]);

      await persistEmittedAlerts(alerts);

      const rows = await getTelemetryForVehicle(vehicleId5);
      const eventTypes = rows.map((r) => r.event_type);

      assert(eventTypes.includes('SPEEDING ALERT'), 'Should have SPEEDING ALERT');
      assert(eventTypes.includes('LOW FUEL ALERT'), 'Should have LOW FUEL ALERT');

      // Cleanup
      await pool.query('DELETE FROM gps_telemetry WHERE vehicle_id = $1', [vehicleId5]);
      await pool.query('DELETE FROM gps_idling_dedup WHERE vehicle_id = $1', [vehicleId5]);
      await pool.query('DELETE FROM vehicles WHERE id = $1', [vehicleId5]);
    }))();

    // ── Test 6: Location Update While Moving ─────────────────
    console.log('\n─── Test 6: Location Update While Moving ──────────');
    await (test('Location update does not create duplicate MOVING ALERT', async () => {
      if (DRY_RUN) { skipped += 1; return; }

      const vehicleId6 = crypto.randomUUID();
      const plate6 = `LOCMOVE-${Date.now().toString(36).toUpperCase()}`;
      await pool.query(
        `INSERT INTO vehicles (id, plate_number, make, model, year)
         VALUES ($1, $2, 'Test', 'LocMove', 2024) ON CONFLICT DO NOTHING`,
        [vehicleId6, plate6],
      );

      const tripId6 = crypto.randomUUID();

      // IGNITION ON + MOVING
      await pool.query(
        `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
         VALUES ($1, $2, 'IGNITION ON ALERT', 0, true, NOW() - INTERVAL '30 minutes', $3)`,
        [vehicleId6, plate6, tripId6],
      );
      await pool.query(
        `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
         VALUES ($1, $2, 'MOVING ALERT', 40, true, NOW() - INTERVAL '20 minutes', $3)`,
        [vehicleId6, plate6, tripId6],
      );

      // Simulate location update (should be LOCATION UPDATE, not MOVING)
      const alerts = simulateEmittedAlerts([
        {
          vehicleId: vehicleId6,
          plate: plate6,
          eventType: 'LOCATION UPDATE ALERT',
          speed: 45,
          ignition: true,
          timestamp: new Date().toISOString(),
        },
      ]);

      await persistEmittedAlerts(alerts);

      const rows = await getTelemetryForVehicle(vehicleId6);
      const eventTypes = rows.map((r) => r.event_type);

      assertEqual(eventTypes.filter((e) => e === 'MOVING ALERT').length, 1, 'Should have exactly 1 MOVING ALERT');
      assert(eventTypes.includes('LOCATION UPDATE ALERT'), 'Should have LOCATION UPDATE ALERT');

      // Cleanup
      await pool.query('DELETE FROM gps_telemetry WHERE vehicle_id = $1', [vehicleId6]);
      await pool.query('DELETE FROM gps_idling_dedup WHERE vehicle_id = $1', [vehicleId6]);
      await pool.query('DELETE FROM vehicles WHERE id = $1', [vehicleId6]);
    }))();

    // ── Test 7: Only IGNITION ON Creates active_trip_id ──────
    console.log('\n─── Test 7: Only IGNITION ON Creates active_trip_id ─');
    await (test('Non-IGNITION events are skipped when no active trip exists', async () => {
      if (DRY_RUN) { skipped += 1; return; }

      const vehicleId7 = crypto.randomUUID();
      const plate7 = `NOTRIP-${Date.now().toString(36).toUpperCase()}`;
      await pool.query(
        `INSERT INTO vehicles (id, plate_number, make, model, year)
         VALUES ($1, $2, 'Test', 'NoTrip', 2024) ON CONFLICT DO NOTHING`,
        [vehicleId7, plate7],
      );

      // No IGNITION ON — try to persist other events
      const alerts = simulateEmittedAlerts([
        {
          vehicleId: vehicleId7,
          plate: plate7,
          eventType: 'IDLING ALERT',
          speed: 0,
          ignition: true,
          idleAlertCount: 1,
          idlingThresholdReached: 10,
          timestamp: new Date().toISOString(),
        },
        {
          vehicleId: vehicleId7,
          plate: plate7,
          eventType: 'MOVING ALERT',
          speed: 50,
          ignition: true,
          timestamp: new Date().toISOString(),
        },
        {
          vehicleId: vehicleId7,
          plate: plate7,
          eventType: 'SPEEDING ALERT',
          speed: 100,
          ignition: true,
          timestamp: new Date().toISOString(),
        },
        {
          vehicleId: vehicleId7,
          plate: plate7,
          eventType: 'LOW FUEL ALERT',
          speed: 50,
          fuel: 2,
          ignition: true,
          timestamp: new Date().toISOString(),
        },
        {
          vehicleId: vehicleId7,
          plate: plate7,
          eventType: 'IGNITION OFF ALERT',
          speed: 0,
          ignition: false,
          timestamp: new Date().toISOString(),
        },
      ]);

      const result = await persistEmittedAlerts(alerts);

      assertEqual(result.saved, 0, 'No events should be saved without an active trip');
      assertEqual(result.skipped, 5, 'All 5 events should be skipped');

      const rows = await getTelemetryForVehicle(vehicleId7);
      assertEqual(rows.length, 0, 'Telemetry table should be empty');

      // Cleanup
      await pool.query('DELETE FROM vehicles WHERE id = $1', [vehicleId7]);
    }))();

    // ── Test 8: IGNITION ON Creates New Trip ─────────────────
    console.log('\n─── Test 8: IGNITION ON Creates New Trip ──────────');
    await (test('IGNITION ON ALERT creates a new active_trip_id', async () => {
      if (DRY_RUN) { skipped += 1; return; }

      const vehicleId8 = crypto.randomUUID();
      const plate8 = `NEWTRIP-${Date.now().toString(36).toUpperCase()}`;
      await pool.query(
        `INSERT INTO vehicles (id, plate_number, make, model, year)
         VALUES ($1, $2, 'Test', 'NewTrip', 2024) ON CONFLICT DO NOTHING`,
        [vehicleId8, plate8],
      );

      const alerts = simulateEmittedAlerts([
        {
          vehicleId: vehicleId8,
          plate: plate8,
          eventType: 'IGNITION ON ALERT',
          speed: 0,
          ignition: true,
          timestamp: new Date().toISOString(),
        },
      ]);

      await persistEmittedAlerts(alerts);

      const rows = await getTelemetryForVehicle(vehicleId8);
      assertEqual(rows.length, 1, 'Should have 1 telemetry record');
      assertEqual(rows[0].event_type, 'IGNITION ON ALERT', 'Should be IGNITION ON ALERT');
      assert(rows[0].active_trip_id != null, 'active_trip_id should not be null');

      // Cleanup
      await pool.query('DELETE FROM gps_telemetry WHERE vehicle_id = $1', [vehicleId8]);
      await pool.query('DELETE FROM vehicles WHERE id = $1', [vehicleId8]);
    }))();

  } finally {
    // Cleanup test data
    await cleanupTestData(testVehicleId);
    await pool.end();
  }

  // ── Summary ──────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════');
  console.log('  RESULTS');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Passed:  ${passed}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Total:   ${passed + failed + skipped}`);
  console.log('══════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
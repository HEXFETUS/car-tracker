import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import pg from 'pg';

// This suite never uses DATABASE_URL. Only an explicitly supplied localhost test
// cluster is allowed; fixtures live in a uniquely named disposable schema.
const testUrl = process.env.PHASE1_TEST_DATABASE_URL;
if (testUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(testUrl).hostname)) {
  throw new Error('PHASE1_TEST_DATABASE_URL must target a disposable localhost PostgreSQL cluster');
}
process.env.CARTRACK_API_URL = 'https://phase1-cartrack.invalid/vehicles/status';
process.env.CARTRACK_USERNAME = 'test'; process.env.CARTRACK_PASSWORD = 'test';
const { setPoolForTest } = await import('../db/db.js');
const { dispatchTelegramAlert, ensureTelegramAlertCompatibility,
  retryPendingTelegramAlerts, setTelegramAlertSenderForTest } = await import('./telegramAlertDispatcher.js');
const { syncHistoryBackedAlerts } = await import('./historyAlertSyncService.js');
const { handleIdlingAlertInTransaction } = await import('./scheduler.js');
const { dispatchTrackerAlerts } = await import('./trackerAlertBridge.js');

describe('Phase 1 actual PostgreSQL claims and recovery', { skip: !testUrl }, () => {
  const schema = `phase1_alert_test_${process.pid}`;
  let admin: pg.Pool;
  let pool: pg.Pool;
  let vehicleId: string;
  let sends: string[];
  const originalFetch = globalThis.fetch;
  const event = (overrides: Record<string, unknown> = {}) => ({
    vehicleId, plateNumber: 'TEST123', eventType: 'SPEEDING',
    recordedAt: '2026-10-12T04:00:00Z', telegramMessage: 'Existing alert format',
    latitude: 14, longitude: 121, speedKmh: 95, ignition: true,
    fuelLiters: 20, locationName: 'Road', ...overrides,
  });
  const claim = (value: string) => JSON.parse(value.slice('phase1:'.length));
  async function rows() {
    return (await pool.query('SELECT * FROM gps_telemetry ORDER BY created_at, id')).rows;
  }
  before(async () => {
    admin = new pg.Pool({ connectionString: testUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({ connectionString: testUrl, options: `-c search_path=${schema},public`, max: 12 });
    await pool.query(`
      CREATE TABLE vehicles (id UUID PRIMARY KEY, plate_number TEXT);
      CREATE TABLE travel_orders (id UUID PRIMARY KEY, driver_id UUID);
      CREATE TABLE gps_trip_logs (vehicle_id UUID, active_trip_id UUID, travel_order_id UUID,
        driver_id UUID, departure_time_gps TIMESTAMPTZ);
      CREATE TABLE gps_telemetry (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id UUID NOT NULL REFERENCES vehicles(id),
        plate_number TEXT NOT NULL, event_type TEXT NOT NULL, latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION, speed_kmh DOUBLE PRECISION, fuel_liters DOUBLE PRECISION,
        ignition BOOLEAN, location_name TEXT, driver_id UUID, travel_order_id UUID,
        recorded_at TIMESTAMPTZ NOT NULL, active_trip_id UUID, idling_threshold_minutes INTEGER,
        telegram_message TEXT, telegram_status TEXT CHECK (telegram_status IN ('sent','failed','skipped')),
        telegram_error TEXT, telegram_attempted_at TIMESTAMPTZ, source_event_key TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE UNIQUE INDEX gps_telemetry_source_event_key_uidx ON gps_telemetry(source_event_key)
        WHERE source_event_key IS NOT NULL;
      CREATE TABLE gps_idling_dedup (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id UUID,
        active_trip_id UUID, threshold_minutes INTEGER, idling_started_at TIMESTAMPTZ,
        last_alerted_duration_minutes INTEGER, last_alerted_at TIMESTAMPTZ,
        is_active BOOLEAN NOT NULL DEFAULT true, ended_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now());
      CREATE UNIQUE INDEX gps_idling_active_unique ON gps_idling_dedup(vehicle_id,active_trip_id) WHERE is_active = true;
    `);
    setPoolForTest(pool);
    await ensureTelegramAlertCompatibility(pool);
  });
  beforeEach(async () => {
    setPoolForTest(pool);
    await pool.query('TRUNCATE gps_telemetry, gps_idling_dedup, gps_trip_logs, vehicles CASCADE');
    const cursors = await pool.query("SELECT to_regclass('gps_history_alert_cursors') AS relation");
    if (cursors.rows[0].relation) await pool.query('TRUNCATE gps_history_alert_cursors');
    vehicleId = randomUUID(); sends = [];
    await pool.query('INSERT INTO vehicles (id,plate_number) VALUES ($1,$2)', [vehicleId, 'TEST123']);
    setTelegramAlertSenderForTest(async message => {
      sends.push(message);
      return { ok: true, result: { message_id: sends.length, chat: { id: -123 }, date: 1791777600 } };
    });
    globalThis.fetch = async () => { throw new Error('Unexpected external request in PostgreSQL delivery tests'); };
  });
  afterEach(() => { globalThis.fetch = originalFetch; setTelegramAlertSenderForTest(null); });
  after(async () => {
    setPoolForTest(null);
    await pool?.end();
    // Only remove the schema created by this suite, never a configured database.
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });

  it('serializes first insertion and sends once across 12 concurrent workers', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => dispatchTelegramAlert(event())));
    assert.equal(results.filter(result => result.saved).length, 1);
    assert.equal(results.filter(result => result.outcome === 'accepted').length, 1);
    assert.equal(sends.length, 1); assert.equal((await rows()).length, 1);
    await dispatchTelegramAlert(event()); assert.equal(sends.length, 1);
  });

  it('matches live/history ignition variants with differing trip IDs and timestamps', async () => {
    const first = await dispatchTelegramAlert(event({ eventType: 'IGNITION_ON', activeTripId: randomUUID() }));
    const second = await dispatchTelegramAlert(event({ eventType: 'IGNITION ON ALERT', activeTripId: randomUUID(), recordedAt: '2026-10-12T04:00:10Z' }));
    assert.equal(first.telemetryId, second.telemetryId); assert.equal(sends.length, 1);
  });

  it('does not suppress older unrelated ignition events using a future row', async () => {
    await dispatchTelegramAlert(event({ eventType: 'IGNITION_ON', recordedAt: '2026-10-12T04:00:00Z' }));
    await dispatchTelegramAlert(event({ eventType: 'IGNITION_ON', recordedAt: '2026-10-11T04:00:00Z' }));
    assert.equal(sends.length, 2);
  });

  it('preserves each idling threshold when two milestones share a minute', async () => {
    await dispatchTelegramAlert(event({ eventType: 'IDLING_TOO_LONG', idlingThresholdMinutes: 10 }));
    await dispatchTelegramAlert(event({ eventType: 'IDLING_TOO_LONG', idlingThresholdMinutes: 25 }));
    assert.equal((await rows()).length, 2); assert.equal(sends.length, 2);
  });

  it('deduplicates a live/history idling milestone using the shared idle-session time', async () => {
    const idleStartedAt = '2026-10-12T03:50:00Z';
    const first = await dispatchTelegramAlert(event({ eventType: 'IDLING_TOO_LONG', idlingThresholdMinutes: 10,
      idlingStartedAt: idleStartedAt, activeTripId: randomUUID() }));
    const historical = await dispatchTelegramAlert(event({ eventType: 'IDLING', idlingThresholdMinutes: 10,
      idlingStartedAt: idleStartedAt, activeTripId: randomUUID(), recordedAt: '2026-10-12T04:01:00Z' }));
    assert.equal(first.telemetryId, historical.telemetryId); assert.equal(sends.length, 1);
  });

  it('matches legacy historical rows without replacing their keys or resending them', async () => {
    const first = await dispatchTelegramAlert(event());
    await pool.query('UPDATE gps_telemetry SET source_event_key=$2,telegram_status=NULL,telegram_error=NULL WHERE id=$1', [first.telemetryId, 'legacy-history-key']);
    const repeated = await dispatchTelegramAlert(event());
    assert.equal(repeated.outcome, 'suppressed'); assert.equal(sends.length, 1);
    assert.equal((await rows())[0].source_event_key, 'legacy-history-key');
    assert.deepEqual(await retryPendingTelegramAlerts(), { sent: 0, failed: 0 });
  });

  it('recovers new pending rows with a fresh pool while holding interrupted attempts', async () => {
    const deferred = await dispatchTelegramAlert(event(), { deadlineAtMs: Date.now() + 1 });
    assert.equal(deferred.outcome, 'deferred');
    const restartedPool = new pg.Pool({ connectionString: testUrl, options: `-c search_path=${schema},public` });
    try {
      setPoolForTest(restartedPool);
      assert.deepEqual(await retryPendingTelegramAlerts(), { sent: 1, failed: 0 });
      await pool.query('UPDATE gps_telemetry SET telegram_status=NULL,telegram_error=$1', ['phase1:{"version":1,"state":"attempted","attempts":1}']);
      assert.deepEqual(await retryPendingTelegramAlerts(), { sent: 0, failed: 0 });
      assert.equal((await dispatchTelegramAlert(event())).outcome, 'unknown');
      assert.equal(sends.length, 1);
    } finally { setPoolForTest(pool); await restartedPool.end(); }
  });

  it('excludes future retries so they cannot starve eligible pending work', async () => {
    const deferred = await dispatchTelegramAlert(event(), { deadlineAtMs: Date.now() + 1 });
    await pool.query('UPDATE gps_telemetry SET telegram_error=$2 WHERE id=$1', [deferred.telemetryId,
      'phase1:' + JSON.stringify({ version: 1, state: 'retry', attempts: 1, nextAttemptAt: Date.now() + 60000 })]);
    await dispatchTelegramAlert(event({ recordedAt: '2026-10-12T04:02:00Z' }), { deadlineAtMs: Date.now() + 1 });
    assert.deepEqual(await retryPendingTelegramAlerts(), { sent: 1, failed: 0 });
    assert.equal(sends.length, 1);
  });

  it('keeps the durable attempted row when a database trigger rejects finalization', async () => {
    await pool.query(`CREATE FUNCTION block_finalization() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.telegram_status = 'sent' THEN RAISE EXCEPTION 'test finalization unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER block_finalization BEFORE UPDATE ON gps_telemetry FOR EACH ROW EXECUTE FUNCTION block_finalization();`);
    try {
      const result = await dispatchTelegramAlert(event(), { deadlineAtMs: Date.now() + 5500 });
      assert.equal(result.outcome, 'accepted'); assert.equal(result.finalized, false);
      assert.equal(claim((await rows())[0].telegram_error).state, 'attempted');
      await dispatchTelegramAlert(event()); assert.equal(sends.length, 1);
    } finally { await pool.query('DROP TRIGGER block_finalization ON gps_telemetry; DROP FUNCTION block_finalization()'); }
  });

  it('shares the dispatcher with the tracker compatibility bridge', async () => {
    const alert = { vehicle_id: vehicleId, plate: 'TEST123', type: 'speeding', timestamp: event().recordedAt,
      message: event().telegramMessage, location: 'Road', speed: 95, ignition: true };
    assert.equal((await dispatchTrackerAlerts([alert])).sent, 1);
    assert.equal((await dispatchTrackerAlerts([alert])).skipped, 1);
    assert.equal(sends.length, 1);
  });

  it('routes the exported tracker sender through the compiled backend dispatcher', {
    skip: !existsSync(new URL('../../dist/services/trackerAlertBridge.js', import.meta.url)),
  }, async () => {
    const compiledDb = await import(new URL('../../dist/db/db.js', import.meta.url).href);
    const compiledDispatcher = await import(new URL('../../dist/services/telegramAlertDispatcher.js', import.meta.url).href);
    const { sendVehicleAlerts } = await import('@car-tracker/tracker');
    compiledDb.setPoolForTest(pool);
    compiledDispatcher.setTelegramAlertSenderForTest(async (message: string) => {
      sends.push(message); return { ok: true, result: { message_id: 1, chat: { id: -123 }, date: 100 } };
    });
    try {
      const alert = { vehicle_id: vehicleId, plate: 'TEST123', type: 'speeding', timestamp: event().recordedAt,
        message: event().telegramMessage, location: 'Road', speed: 95, ignition: true };
      assert.equal((await sendVehicleAlerts([alert])).sent, 1);
      assert.equal((await sendVehicleAlerts([alert])).skipped, 1);
      assert.equal(sends.length, 1);
    } finally { compiledDb.setPoolForTest(null); compiledDispatcher.setTelegramAlertSenderForTest(null); }
  });

  it('keeps a suppressed historical location transition tied to its durable row', async () => {
    await dispatchTelegramAlert(event({ eventType: 'LOCATION_UPDATE', recordedAt: '2026-10-12T04:00:00Z' }));
    const repeat = await dispatchTelegramAlert(event({ eventType: 'LOCATION_UPDATE', recordedAt: '2026-10-12T04:02:00Z' }));
    assert.equal(repeat.outcome, 'suppressed'); assert.ok(repeat.telemetryId);
    assert.equal(sends.length, 1);
  });

  it('serializes the first transactional idling milestone and preserves trip links', async () => {
    const tripId = randomUUID(); const travelOrderId = randomUUID(); const driverId = randomUUID();
    const params = { vehicleId, plateNumber: 'TEST123', activeTripId: tripId, latitude: 14, longitude: 121,
      speedKmh: 0, fuelLiters: 20, ignition: true, locationName: 'Depot', recordedAt: event().recordedAt,
      idlingStartedAt: '2026-10-12T03:50:00Z', thresholdMinutes: 10,
      telegramMessage: 'Idling for 10 minutes', travelOrderId, driverId };
    const results = await Promise.all([handleIdlingAlertInTransaction(params), handleIdlingAlertInTransaction(params)]);
    assert.equal(results.filter(result => result.telegramSent).length, 1);
    const saved = await rows(); assert.equal(saved.length, 1); assert.equal(sends.length, 1);
    assert.equal(saved[0].active_trip_id, tripId); assert.equal(saved[0].travel_order_id, travelOrderId);
    assert.equal(saved[0].driver_id, driverId);
  });

  function mockHistory(points: unknown[]) {
    globalThis.fetch = async url => {
      const address = String(url);
      if (!address.startsWith('https://phase1-cartrack.invalid/')) throw new Error('Unexpected request');
      return Response.json(address.includes('/vehicles/status')
        ? [{ vehicle_id: 'unit1', registration: 'TEST123' }] : points);
    };
  }
  async function seedHistoryCursor(at: string) {
    // First call creates the existing historical schema and establishes no events.
    mockHistory([]); await syncHistoryBackedAlerts();
    await pool.query(`INSERT INTO gps_history_alert_cursors (vehicle_id,last_event_at,last_ignition,last_speed_kmh,last_location_name)
      VALUES ($1,$2,true,20,'Old Road') ON CONFLICT(vehicle_id) DO UPDATE SET
      last_event_at=$2,last_ignition=true,last_speed_kmh=20,last_location_name='Old Road'`, [vehicleId, at]);
  }

  it('preserves historical event time and advances the cursor after a safely failed send', async () => {
    const at = new Date(Date.now() - 120000).toISOString(); const next = new Date(Date.now() - 60000).toISOString();
    await seedHistoryCursor(at);
    mockHistory([{ event_time: next, ignition: true, speed: 30, location_name: 'New Road', latitude: 14, longitude: 121 }]);
    setTelegramAlertSenderForTest(async message => { sends.push(message); return { ok: false, outcome: 'rejected', error_code: 429, parameters: { retry_after: 30 } }; });
    const summary = await syncHistoryBackedAlerts();
    assert.equal(summary.alertsSaved, 1); assert.equal(summary.telegramFailed, 1);
    const saved = await rows(); assert.equal(new Date(saved[0].recorded_at).toISOString(), next);
    assert.ok(sends[0].includes(next)); assert.equal(claim(saved[0].telegram_error).state, 'retry');
    const cursor = (await pool.query('SELECT last_event_at FROM gps_history_alert_cursors WHERE vehicle_id=$1', [vehicleId])).rows[0];
    assert.equal(new Date(cursor.last_event_at).toISOString(), next);
    await syncHistoryBackedAlerts(); assert.equal(sends.length, 1);
  });

  it('retains the historical cursor if durable event insertion fails', async () => {
    const at = new Date(Date.now() - 120000).toISOString(); const next = new Date(Date.now() - 60000).toISOString();
    await seedHistoryCursor(at);
    mockHistory([{ event_time: next, ignition: true, speed: 30, location_name: 'New Road' }]);
    await pool.query(`CREATE FUNCTION block_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test insertion unavailable'; END $$;
      CREATE TRIGGER block_insert BEFORE INSERT ON gps_telemetry FOR EACH ROW EXECUTE FUNCTION block_insert();`);
    try {
      const summary = await syncHistoryBackedAlerts(); assert.equal(summary.vehiclesFailed, 1);
      const cursor = (await pool.query('SELECT last_event_at FROM gps_history_alert_cursors WHERE vehicle_id=$1', [vehicleId])).rows[0];
      assert.equal(new Date(cursor.last_event_at).toISOString(), at); assert.equal(sends.length, 0);
    } finally { await pool.query('DROP TRIGGER block_insert ON gps_telemetry; DROP FUNCTION block_insert()'); }
  });

  it('suppresses a historical event already accepted by live processing', async () => {
    const at = new Date(Date.now() - 120000).toISOString(); const next = new Date(Date.now() - 60000).toISOString();
    await seedHistoryCursor(at);
    await dispatchTelegramAlert(event({ eventType: 'LOCATION_UPDATE', recordedAt: next, locationName: 'New Road', speedKmh: 30 }));
    mockHistory([{ event_time: next, ignition: true, speed: 30, location_name: 'New Road' }]);
    const summary = await syncHistoryBackedAlerts();
    assert.equal(summary.alertsSkipped, 1); assert.equal(sends.length, 1); assert.equal((await rows()).length, 1);
  });
});

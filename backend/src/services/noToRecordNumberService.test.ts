import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import { afterEach, describe, it } from 'node:test';
import { setPoolForTest } from '../db/db.js';
import { generateNoToRecordNo, noToYear, renumberNoToRecordNos } from './noToRecordNumberService.js';
import { buildNoToLifecycleTrips, upsertNoToTripLifecycle } from './noToLifecycleService.js';

type Row = { id: string; trip_date: string; no_to_record_no: string; vehicle_id?: string; departure?: string };

// An in-memory transaction model exercises interleaving and immediate unique
// constraints. It does not replace integration testing against PostgreSQL.
class Lock {
  readers = 0;
  writer = false;
  queue: Array<{ shared: boolean; resolve: (release: () => void) => void }> = [];
  acquire(shared: boolean): Promise<() => void> {
    return new Promise(resolve => { this.queue.push({ shared, resolve }); this.drain(); });
  }
  drain() {
    if (this.writer) return;
    while (this.queue.length) {
      const next = this.queue[0];
      if (!next.shared && this.readers) return;
      this.queue.shift();
      if (next.shared) this.readers++; else this.writer = true;
      next.resolve(() => {
        if (next.shared) this.readers--; else this.writer = false;
        this.drain();
      });
      if (!next.shared) return;
    }
  }
}

function database(initial: Row[] = []) {
  const rows = new Map(initial.map(row => [row.id, { ...row }]));
  const locks = new Map<string, Lock>();
  const traces: string[][] = [];
  let nextId = 0;
  let failOn = '';
  let failAfter = 1;
  let failureMatches = 0;
  const yearLocks: number[] = [];
  let pause: (() => Promise<void>) | undefined;
  let releases = 0;
  return {
    rows, traces, yearLocks,
    get releases() { return releases; },
    set failOn(value: string) { failOn = value; failureMatches = 0; },
    set failAfter(value: number) { failAfter = value; },
    set pause(value: (() => Promise<void>) | undefined) { pause = value; },
    async query() { throw new Error('Transaction escaped through pool.query'); },
    async connect() {
      const trace: string[] = [];
      traces.push(trace);
      let active = false;
      const pending = new Map<string, Row>();
      const held = new Map<string, () => void>();
      const view = () => new Map([...rows, ...pending]);
      const unlock = () => { for (const release of held.values()) release(); held.clear(); };
      return {
        release() { assert.equal(active, false); releases++; },
        async query(sql: string, params: any[] = []) {
          trace.push(sql);
          if (sql === 'BEGIN') { active = true; return { rows: [] }; }
          assert.equal(active, true, 'every query must run in a transaction');
          if (sql === 'ROLLBACK') { pending.clear(); active = false; unlock(); return { rows: [] }; }
          if (failOn && sql.includes(failOn) && ++failureMatches === failAfter) {
            throw Object.assign(new Error('injected failure'), { code: '23505' });
          }
          if (sql === 'COMMIT') {
            for (const [id, row] of pending) rows.set(id, row);
            active = false; unlock(); return { rows: [] };
          }
          if (sql.includes('pg_advisory_xact_lock')) {
            const key = params.join(':') + (params.length === 1 ? ':0' : '');
            if (!held.has(key)) {
              let lock = locks.get(key);
              if (!lock) { lock = new Lock(); locks.set(key, lock); }
              held.set(key, await lock.acquire(sql.includes('_shared')));
              if (params.length === 2) yearLocks.push(params[1]);
            }
            return { rows: [] };
          }
          if (sql.includes('ORDER BY trip_date ASC')) {
            if (pause) await pause();
            return { rows: [...view().values()].sort((a, b) => a.trip_date.localeCompare(b.trip_date) || a.id.localeCompare(b.id)) };
          }
          if (sql.includes('WHERE no_to_record_no = ANY')) {
            return { rows: [...view().values()].filter(row => params[0].includes(row.no_to_record_no)).slice(0, 1) };
          }
          if (sql.includes('MAX(split_part')) {
            const matching = [...view().values()].filter(row => new RegExp(params[0]).test(row.no_to_record_no));
            const maximum = matching.reduce((max, row) => {
              const value = BigInt(row.no_to_record_no.split('-')[3]); return value > max ? value : max;
            }, 0n);
            return { rows: [{ max_seq: String(maximum) }] };
          }
          if (sql.includes('FROM unnest($1::uuid[]')) {
            // Model a non-deferrable unique constraint checked on each assignment.
            for (let index = 0; index < params[0].length; index++) {
              const id = params[0][index], number = params[1][index];
              assert.equal([...view().values()].some(row => row.id !== id && row.no_to_record_no === number), false, 'unique number collision');
              pending.set(id, { ...view().get(id)!, no_to_record_no: number });
            }
            return { rows: [], rowCount: params[0].length };
          }
          if (sql.includes('FROM gps_no_to_logs') && sql.includes('departure_time =')) {
            return { rows: [...view().values()].filter(row => row.vehicle_id === params[0] && row.departure === params[1]).slice(0, 1) };
          }
          if (sql.startsWith('INSERT INTO gps_no_to_logs')) {
            assert.equal([...view().values()].some(row => row.no_to_record_no === params[0]), false);
            const id = String(++nextId);
            pending.set(id, { id, no_to_record_no: params[0], vehicle_id: params[1], trip_date: params[3], departure: params[8] });
            return { rows: [{ id }] };
          }
          return { rows: [], rowCount: 1 };
        },
      };
    },
  };
}

function journey(start = '2026-07-18T00:00:00.000Z') {
  const point = (overrides = {}) => ({
    id: null, vehicle_id: '10000000-0000-4000-8000-000000000001', plate_number: 'TEST',
    event_type: 'IGNITION_ON', latitude: 8.45, longitude: 124.62, speed_kmh: 0,
    location_name: 'Base', recorded_at: start, active_trip_id: '20000000-0000-4000-8000-000000000001',
    driver_id: null, ...overrides,
  });
  return buildNoToLifecycleTrips([
    point(), point({ latitude: 8.46, event_type: 'LOCATION_UPDATE', speed_kmh: 20,
      recorded_at: new Date(new Date(start).getTime() + 300000).toISOString() }),
    point({ event_type: 'IGNITION_OFF', recorded_at: new Date(new Date(start).getTime() + 600000).toISOString() }),
  ], '8.45,124.62', 600000)[0];
}

afterEach(() => setPoolForTest(null));

describe('transactional No-TO numbering', () => {
  it('rejects invalid business dates and preserves suffixes above 9999', async () => {
    for (const date of ['bad', '2026-02-30', '2026-1-01', '0000-01-01']) assert.throws(() => noToYear(date));
    assert.equal(noToYear('2024-02-29'), 2024);
    await assert.rejects(generateNoToRecordNo('2026-07-18'), /transaction client/);
    const client = { query: async () => ({ rows: [{ max_seq: '9999' }] }) } as unknown as PoolClient;
    assert.equal(await generateNoToRecordNo('2026-07-18', client), 'NO-TO-2026-10000');
  });

  it('serializes concurrent inserts and rechecks an identical journey after locking', async () => {
    const db = database(); setPoolForTest(db as never);
    const first = journey();
    const outcomes = await Promise.all([upsertNoToTripLifecycle(first), upsertNoToTripLifecycle(first),
      upsertNoToTripLifecycle(journey('2026-07-18T01:00:00.000Z'))]);
    assert.deepEqual(outcomes, ['created', 'updated', 'created']);
    assert.equal(db.rows.size, 2);
    assert.deepEqual([...db.rows.values()].map(row => row.no_to_record_no).sort(), ['NO-TO-2026-0001', 'NO-TO-2026-0002']);
    assert.equal(db.releases, 3);
    for (const trace of db.traces) {
      assert.equal(trace[0], 'BEGIN'); assert.equal(trace.at(-1), 'COMMIT');
      assert.ok(trace.some(sql => sql.includes('DELETE FROM gps_no_to_log_active_trips')));
      assert.ok(trace.some(sql => sql.includes('UPDATE gps_telemetry')));
    }
  });

  it('rolls back a session failure, releases locks, and does not retry an aborted transaction', async () => {
    const db = database(); setPoolForTest(db as never);
    db.failOn = 'INSERT INTO gps_no_to_log_active_trips';
    await assert.rejects(upsertNoToTripLifecycle(journey()), /injected failure/);
    assert.equal(db.rows.size, 0); assert.equal(db.releases, 1);
    assert.equal(db.traces[0].at(-1), 'ROLLBACK');
    db.failOn = '';
    assert.equal(await upsertNoToTripLifecycle(journey()), 'created');
    assert.equal([...db.rows.values()][0].no_to_record_no, 'NO-TO-2026-0001');
  });

  it('canonicalizes UTC identity and preserves an existing business date', async () => {
    const db = database(); setPoolForTest(db as never);
    const trip = journey('2026-01-01T00:00:00.000Z');
    trip.startedAt = '2026-01-01T08:00:00+08:00';
    assert.equal(await upsertNoToTripLifecycle(trip), 'created');
    assert.equal(await upsertNoToTripLifecycle(journey('2026-01-01T00:00:00.000Z')), 'updated');
    assert.equal(db.rows.size, 1);
    [...db.rows.values()][0].trip_date = '2025-12-31';
    db.yearLocks.length = 0;
    assert.equal(await upsertNoToTripLifecycle(trip), 'updated');
    assert.equal([...db.rows.values()][0].trip_date, '2025-12-31');
    const yearKeys = db.traces.at(-1)!.filter(sql => sql.includes('pg_advisory_xact_lock('));
    assert.equal(yearKeys.length, 2);
    assert.deepEqual(db.yearLocks, [2025, 2026]);
  });

  it('renumbers swapped numbers and changed business years in two phases without deleting rows', async () => {
    const db = database([
      { id: 'a', trip_date: '2026-01-01', no_to_record_no: 'NO-TO-2026-0002' },
      { id: 'b', trip_date: '2026-01-02', no_to_record_no: 'NO-TO-2026-0001' },
      { id: 'c', trip_date: '2027-01-01', no_to_record_no: 'NO-TO-2025-0001' },
    ]); setPoolForTest(db as never);
    assert.equal(await renumberNoToRecordNos(), 3);
    assert.deepEqual([...db.rows.values()].map(row => row.no_to_record_no),
      ['NO-TO-2026-0001', 'NO-TO-2026-0002', 'NO-TO-2027-0001']);
    assert.equal(await renumberNoToRecordNos(), 0);
    assert.equal(db.rows.size, 3);
  });

  it('rolls back renumbering if final assignment fails', async () => {
    const db = database([{ id: 'a', trip_date: '2026-01-01', no_to_record_no: 'NO-TO-2026-0009' }]);
    setPoolForTest(db as never); db.failOn = 'FROM unnest($1::uuid[]';
    db.failAfter = 2;
    await assert.rejects(renumberNoToRecordNos(), /injected failure/);
    assert.equal(db.rows.get('a')!.no_to_record_no, 'NO-TO-2026-0009');
    assert.equal(db.traces[0].at(-1), 'ROLLBACK'); assert.equal(db.releases, 1);
  });

  it('preserves five-digit numbers during renumbering', async () => {
    const records = Array.from({ length: 10000 }, (_, index) => ({
      id: String(index + 1).padStart(5, '0'), trip_date: '2026-01-01',
      no_to_record_no: `NO-TO-2026-${String(index + 1 === 10000 ? 10001 : index + 1).padStart(4, '0')}`,
    }));
    const db = database(records); setPoolForTest(db as never);
    assert.equal(await renumberNoToRecordNos(), 1);
    assert.equal(db.rows.get('10000')!.no_to_record_no, 'NO-TO-2026-10000');
    assert.equal(db.rows.size, 10000);
  });

  it('blocks an insert in a new year until renumbering commits', async () => {
    const db = database(); setPoolForTest(db as never);
    let resume!: () => void, entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    db.pause = () => { entered(); return new Promise<void>(resolve => { resume = resolve; }); };
    const renumber = renumberNoToRecordNos();
    await ready;
    let committed = false;
    const insert = upsertNoToTripLifecycle(journey('2027-01-01T00:00:00.000Z')).then(() => { committed = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(committed, false);
    resume(); await renumber; await insert;
    assert.equal([...db.rows.values()][0].no_to_record_no, 'NO-TO-2027-0001');
  });
});

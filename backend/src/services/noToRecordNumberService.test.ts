import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { setPoolForTest } from '../db/db.js';
import { generateNoToRecordNo, renumberNoToRecordNos } from './noToRecordNumberService.js';

afterEach(() => setPoolForTest(null));

describe('NO-TO record numbering', () => {
  it('derives the year from the trip date and uses MAX+1 for the sequence', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const pool = {
      async query(sql: string, params?: unknown[]) {
        capturedSql = sql;
        capturedParams = params ?? [];
        return { rows: [{ max_seq: '40' }], rowCount: 1 };
      },
    };
    setPoolForTest(pool as never);

    const no = await generateNoToRecordNo('2026-07-10');

    assert.equal(no, 'NO-TO-2026-0041');
    assert.deepEqual(capturedParams, [2026]);
    assert.match(capturedSql, /MAX\(CAST\(split_part\(no_to_record_no/);
    assert.match(capturedSql, /EXTRACT\(YEAR FROM COALESCE\(departure_time, trip_date, created_at\)\) = \$1/);
  });

  it('renumbers every year by trip date, created_at, then id', async () => {
    let capturedSql = '';
    const pool = {
      async query(sql: string) {
        capturedSql = sql;
        return { rows: [], rowCount: 7 };
      },
    };
    setPoolForTest(pool as never);

    const renumbered = await renumberNoToRecordNos();

    assert.equal(renumbered, 7);
    assert.match(capturedSql, /ROW_NUMBER\(\) OVER/);
    assert.match(capturedSql, /PARTITION BY EXTRACT\(YEAR FROM COALESCE\(g\.departure_time, g\.trip_date, g\.created_at\)\)/);
    assert.match(capturedSql, /ORDER BY g\.trip_date ASC, g\.created_at ASC, g\.id ASC/);
    assert.match(capturedSql, /LPAD\(r\.rn::text, 4, '0'\)/);
    assert.match(capturedSql, /IS DISTINCT FROM/);
  });
});

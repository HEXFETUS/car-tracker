import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  beginLifecycleSync,
  completeLifecycleSync,
} from './lifecycleSyncProgressService.js';

describe('lifecycle sync progress', () => {
  it('uses an overlap behind the durable watermark for late arrivals', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return { rows: [{ last_created_at: '2026-07-28T04:00:00.000Z' }] };
      },
    };

    const watermark = await beginLifecycleSync(pool as any, 'test-job', {
      lateArrivalOverlapMinutes: 15,
    });

    assert.equal(watermark?.toISOString(), '2026-07-28T03:45:00.000Z');
    assert.equal(queries[0].params[0], 'test-job');
  });

  it('does not read or advance incremental progress during a full-history repair', async () => {
    let calls = 0;
    const pool = {
      query: async () => {
        calls += 1;
        return { rows: [] };
      },
    };

    const watermark = await beginLifecycleSync(pool as any, 'test-job', { fullHistory: true });
    await completeLifecycleSync(pool as any, 'test-job', 100, new Date(), true);

    assert.equal(watermark, null);
    assert.equal(calls, 0);
  });
});

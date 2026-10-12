import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { runTrackerCli } from './trackerSync.js';
import type { SchedulerCycleSummary } from '../services/scheduler.js';

const originalExitCode = process.exitCode;
afterEach(() => { process.exitCode = originalExitCode; });
describe('tracker CLI backend entry point', () => {
  it('runs backend synchronization and closes both existing pools', async () => {
    const calls: string[] = [];
    await runTrackerCli({
      runCycle: async () => { calls.push('backend-sync'); return { skipped: false, telemetryFailed: 0, telegramFailed: 0 } as SchedulerCycleSummary; },
      closePool: async () => { calls.push('backend-close'); },
      closeTrackerDatabase: async () => { calls.push('tracker-close'); },
    });
    assert.deepEqual(calls, ['backend-sync', 'backend-close', 'tracker-close']);
    assert.equal(process.exitCode, originalExitCode);
  });
  it('reports failure and closes both pools if synchronization throws', async () => {
    let closed = 0;
    await runTrackerCli({ runCycle: async () => { throw new Error('mock API failure'); },
      closePool: async () => { closed++; }, closeTrackerDatabase: async () => { closed++; } });
    assert.equal(process.exitCode, 1); assert.equal(closed, 2);
  });
  it('sets a failed exit status for a skipped or failed delivery cycle', async () => {
    await runTrackerCli({
      runCycle: async () => ({ skipped: false, telemetryFailed: 0, telegramFailed: 1 }) as SchedulerCycleSummary,
      closePool: async () => {}, closeTrackerDatabase: async () => {},
    });
    assert.equal(process.exitCode, 1);
  });
});

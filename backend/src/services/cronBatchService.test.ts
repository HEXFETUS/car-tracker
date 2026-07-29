import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyCronBatchResult,
  type CronBatchResult,
} from './cronBatchService.js';
import type { SchedulerCycleSummary } from './scheduler.js';

function summary(overrides: Partial<SchedulerCycleSummary> = {}): SchedulerCycleSummary {
  return {
    skipped: false,
    skipReason: null,
    vehiclesProcessed: 3,
    telemetrySaved: 3,
    telemetrySkipped: 0,
    telemetryFailed: 0,
    telegramSent: 3,
    telegramFailed: 0,
    durationSeconds: 1,
    batch: {
      offset: 0,
      examined: 3,
      remaining: 0,
      nextOffset: 0,
      passComplete: true,
      deadlineReached: false,
    },
    ...overrides,
  };
}

function cronResult(overrides: Partial<SchedulerCycleSummary> = {}): CronBatchResult {
  return { summary: summary(overrides) };
}

describe('full-fleet cron HTTP outcome classification', () => {
  it('reports a completed full-fleet cycle as 200', () => {
    assert.deepEqual(classifyCronBatchResult(cronResult()), {
      status: 'completed',
      httpStatus: 200,
      reason: null,
    });
  });

  it('reports a skipped cycle as 500 instead of a lock conflict', () => {
    assert.deepEqual(classifyCronBatchResult(cronResult({
      skipped: true,
      skipReason: 'paused',
      batch: null,
    })), {
      status: 'failed',
      httpStatus: 500,
      reason: 'paused',
    });
  });
});

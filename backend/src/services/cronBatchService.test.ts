import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyCronBatchResult,
  nextCronProgress,
  type CronBatchResult,
} from './cronBatchService.js';
import type { SchedulerCycleSummary } from './scheduler.js';

function summary(overrides: Partial<SchedulerCycleSummary> = {}): SchedulerCycleSummary {
  return {
    skipped: false,
    skipReason: null,
    vehiclesProcessed: 2,
    telemetrySaved: 2,
    telemetrySkipped: 0,
    telemetryFailed: 0,
    telegramSent: 0,
    telegramFailed: 0,
    durationSeconds: 1,
    batch: {
      offset: 0,
      examined: 2,
      remaining: 3,
      nextOffset: 2,
      passComplete: false,
      deadlineReached: false,
    },
    ...overrides,
  };
}

function cronResult(overrides: Partial<SchedulerCycleSummary> = {}): CronBatchResult {
  return {
    locked: true,
    batchSize: 2,
    softDeadlineMs: 45000,
    fleetPass: 1,
    nextFleetPass: 1,
    summary: summary(overrides),
  };
}

describe('bounded cron outcome classification', () => {
  it('reports a progressing batch as completed', () => {
    assert.deepEqual(classifyCronBatchResult(cronResult()), {
      status: 'completed',
      httpStatus: 200,
      reason: null,
    });
  });

  it('reports an overlapping invocation as a healthy no-op', () => {
    assert.deepEqual(classifyCronBatchResult({
      locked: false,
      batchSize: 2,
      softDeadlineMs: 45000,
      fleetPass: null,
      nextFleetPass: null,
      summary: null,
    }), {
      status: 'already_running',
      httpStatus: 200,
      reason: 'advisory_lock_active',
    });
  });

  it('rejects a batch that made no progress before its deadline', () => {
    assert.deepEqual(classifyCronBatchResult(cronResult({
      vehiclesProcessed: 0,
      batch: {
        offset: 2,
        examined: 0,
        remaining: 3,
        nextOffset: 2,
        passComplete: false,
        deadlineReached: true,
      },
    })), {
      status: 'failed',
      httpStatus: 500,
      reason: 'no_batch_progress',
    });
  });

  it('reports a skipped cycle as failed', () => {
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

describe('bounded cron cursor progression', () => {
  it('advances the cursor after a partial batch', () => {
    assert.deepEqual(nextCronProgress(4, 0, summary()), {
      nextVehicleOffset: 2,
      nextFleetPass: 4,
    });
  });

  it('rolls the cursor and increments the pass after the last batch', () => {
    assert.deepEqual(nextCronProgress(4, 4, summary({
      batch: {
        offset: 4,
        examined: 1,
        remaining: 0,
        nextOffset: 0,
        passComplete: true,
        deadlineReached: false,
      },
    })), {
      nextVehicleOffset: 0,
      nextFleetPass: 5,
    });
  });

  it('preserves progress when a cycle is skipped', () => {
    assert.deepEqual(nextCronProgress(4, 2, summary({
      skipped: true,
      skipReason: 'paused',
      batch: null,
    })), {
      nextVehicleOffset: 2,
      nextFleetPass: 4,
    });
  });
});

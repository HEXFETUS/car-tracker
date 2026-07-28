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
      offset: 4,
      examined: 2,
      remaining: 3,
      nextOffset: 6,
      passComplete: false,
      deadlineReached: false,
    },
    ...overrides,
  };
}

describe('cron batch progress', () => {
  it('advances to the next successfully examined fleet position', () => {
    assert.deepEqual(nextCronProgress(3, 4, summary()), {
      nextVehicleOffset: 6,
      nextFleetPass: 3,
    });
  });

  it('wraps the cursor and increments the fleet pass on completion', () => {
    const completed = summary({
      batch: {
        offset: 8,
        examined: 1,
        remaining: 0,
        nextOffset: 0,
        passComplete: true,
        deadlineReached: false,
      },
    });
    assert.deepEqual(nextCronProgress(3, 8, completed), {
      nextVehicleOffset: 0,
      nextFleetPass: 4,
    });
  });

  it('does not move the durable cursor when a cycle is skipped', () => {
    const skipped = summary({ skipped: true, skipReason: 'lock_active', batch: null });
    assert.deepEqual(nextCronProgress(3, 4, skipped), {
      nextVehicleOffset: 4,
      nextFleetPass: 3,
    });
  });

  it('processes a three-vehicle fleet across two batches', () => {
    const first = summary({
      batch: {
        offset: 0, examined: 2, remaining: 1, nextOffset: 2,
        passComplete: false, deadlineReached: false,
      },
    });
    const second = summary({
      vehiclesProcessed: 1,
      batch: {
        offset: 2, examined: 1, remaining: 0, nextOffset: 0,
        passComplete: true, deadlineReached: false,
      },
    });

    assert.deepEqual(nextCronProgress(1, 0, first), {
      nextVehicleOffset: 2, nextFleetPass: 1,
    });
    assert.deepEqual(nextCronProgress(1, 2, second), {
      nextVehicleOffset: 0, nextFleetPass: 2,
    });
  });
});

function batchResult(overrides: Partial<CronBatchResult> = {}): CronBatchResult {
  return {
    locked: true,
    batchSize: 2,
    softDeadlineMs: 20_000,
    fleetPass: 1,
    nextFleetPass: 1,
    summary: summary(),
    ...overrides,
  };
}

describe('cron HTTP outcome classification', () => {
  it('reports an advisory lock collision as 409', () => {
    assert.deepEqual(classifyCronBatchResult(batchResult({ locked: false, summary: null })), {
      status: 'lock_active', httpStatus: 409, reason: 'advisory_lock_active',
    });
  });

  it('reports an internal cycle lock as 409', () => {
    const skipped = summary({ skipped: true, skipReason: 'lock_active', batch: null });
    assert.deepEqual(classifyCronBatchResult(batchResult({ summary: skipped })), {
      status: 'lock_active', httpStatus: 409, reason: 'cycle_lock_active',
    });
  });

  it('reports other skipped and no-progress cycles as 503', () => {
    const paused = summary({ skipped: true, skipReason: 'paused', batch: null });
    assert.equal(classifyCronBatchResult(batchResult({ summary: paused })).httpStatus, 503);

    const stalled = summary({
      vehiclesProcessed: 0,
      batch: {
        offset: 0, examined: 0, remaining: 3, nextOffset: 0,
        passComplete: false, deadlineReached: true,
      },
    });
    assert.deepEqual(classifyCronBatchResult(batchResult({ summary: stalled })), {
      status: 'no_progress', httpStatus: 503, reason: 'no_batch_progress',
    });
  });
});

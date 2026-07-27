import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nextCronProgress } from './cronBatchService.js';
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
});

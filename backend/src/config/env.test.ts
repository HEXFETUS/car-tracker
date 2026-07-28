import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CRON_BATCH_SIZE,
  CRON_SOFT_DEADLINE_MS,
} from './env.js';

describe('numeric environment defaults', () => {
  it('uses cron defaults when optional environment values are absent', () => {
    assert.equal(CRON_BATCH_SIZE, 2);
    assert.equal(CRON_SOFT_DEADLINE_MS, 45_000);
  });
});

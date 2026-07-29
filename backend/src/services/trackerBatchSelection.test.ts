import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { selectFleetBatch } from '@car-tracker/tracker';

const fleet = [
  { registration: 'CCC-003' },
  { registration: 'AAA-001' },
  { registration: 'BBB-002' },
];

describe('tracker fleet batch selection', () => {
  it('selects the complete fleet when cron omits batching options', () => {
    const result = selectFleetBatch(fleet);
    assert.deepEqual(
      result.vehicles.map((vehicle) => vehicle.registration),
      ['AAA-001', 'BBB-002', 'CCC-003'],
    );
    assert.equal(result.vehicles.length, 3);
    assert.equal(result.offset, 0);
  });

  it('uses a stable plate order before applying the cursor and limit', () => {
    const result = selectFleetBatch(fleet, 1, 2);
    assert.deepEqual(
      result.vehicles.map((vehicle) => vehicle.registration),
      ['BBB-002', 'CCC-003'],
    );
    assert.equal(result.offset, 1);
  });

  it('wraps an out-of-range cursor to the beginning of the fleet', () => {
    const result = selectFleetBatch(fleet, 99, 2);
    assert.deepEqual(
      result.vehicles.map((vehicle) => vehicle.registration),
      ['AAA-001', 'BBB-002'],
    );
    assert.equal(result.offset, 0);
  });
});

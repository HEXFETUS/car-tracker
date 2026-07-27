import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveTelemetryTravelOrderForEvent,
  type TelemetryTravelOrderCandidate,
} from './scheduler.js';

const candidates: TelemetryTravelOrderCandidate[] = [
  {
    id: 'to-july-15',
    vehicle_id: 'vehicle-1',
    driver_id: 'driver-1',
    to_number: 'TO-2026-0004',
    travel_date: '2026-07-15',
    scheduled_departure_local: '2026-07-15 09:30:00',
    scheduled_arrival_local: '2026-07-15 12:00:00',
  },
  {
    id: 'to-july-16',
    vehicle_id: 'vehicle-1',
    driver_id: 'driver-2',
    to_number: 'TO-2026-0005',
    travel_date: '2026-07-16',
    scheduled_departure_local: '2026-07-16 09:00:00',
    scheduled_arrival_local: '2026-07-16 14:00:00',
  },
];

describe('scheduler travel-order event-date resolution', () => {
  it('uses the telemetry event date in Asia/Manila', () => {
    const resolved = resolveTelemetryTravelOrderForEvent(
      'vehicle-1',
      '2026-07-16T00:30:16.000Z',
      candidates,
    );

    assert.equal(resolved?.id, 'to-july-16');
    assert.equal(resolved?.driver_id, 'driver-2');
  });

  it('does not select another vehicle or a future travel date', () => {
    assert.equal(resolveTelemetryTravelOrderForEvent(
      'vehicle-2',
      '2026-07-16T00:30:16.000Z',
      candidates,
    ), null);
    assert.equal(resolveTelemetryTravelOrderForEvent(
      'vehicle-1',
      '2026-07-14T15:30:16.000Z',
      candidates,
    ), null);
  });

  it('prefers the order whose scheduled window contains the event', () => {
    const overlapping = [
      ...candidates,
      {
        ...candidates[1],
        id: 'to-july-16-evening',
        to_number: 'TO-2026-0006',
        scheduled_departure_local: '2026-07-16 18:00:00',
        scheduled_arrival_local: '2026-07-16 20:00:00',
      },
    ];

    assert.equal(resolveTelemetryTravelOrderForEvent(
      'vehicle-1',
      '2026-07-16T02:00:00.000Z',
      overlapping,
    )?.id, 'to-july-16');
  });
});

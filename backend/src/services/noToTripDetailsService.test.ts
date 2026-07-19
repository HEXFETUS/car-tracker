import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { anchorNoToRouteAtOrigin, deriveNoToTripDetails } from './noToTripDetailsService.js';

const route = [
  { lat: 8.45, lng: 124.62, timestamp: '2026-07-18T01:00:00.000Z', speed: 20, locationName: 'Origin' },
  { lat: 8.40, lng: 124.30, timestamp: '2026-07-18T02:00:00.000Z', speed: 30, locationName: 'Farthest destination' },
  { lat: 8.44, lng: 124.60, timestamp: '2026-07-18T03:00:00.000Z', speed: 10, locationName: 'Return point' },
];

describe('No TO trip details derivation', () => {
  it('prepends the canonical fleet-base Origin when a session starts away', () => {
    const anchored = anchorNoToRouteAtOrigin(
      route.slice(1),
      '8.453993,124.6229589',
      'Trade Street fleet base',
      '2026-07-18T01:55:31.000Z',
    );

    assert.equal(anchored.length, route.length);
    assert.equal(anchored[0].lat, 8.453993);
    assert.equal(anchored[0].lng, 124.6229589);
    assert.equal(anchored[0].locationName, 'Trade Street fleet base');
  });

  it('uses the farthest route point as Arrival', () => {
    const details = deriveNoToTripDetails(route, [], 'PAUSED_AWAY_FROM_BASE');

    assert.equal(details.arrivalAddress, 'Farthest destination');
    assert.equal(details.arrivalCoordinates, '8.4,124.3');
    assert.equal(details.arrivalTime, '2026-07-18T02:00:00.000Z');
    assert.equal(details.status, 'ongoing');
  });

  it('keeps End blank until the journey is completed', () => {
    const details = deriveNoToTripDetails(route, [], 'RETURNING');

    assert.equal(details.endAddress, null);
    assert.equal(details.endCoordinates, null);
    assert.equal(details.endTime, null);
  });

  it('uses the final route point and session duration for a completed journey', () => {
    const details = deriveNoToTripDetails(route, [{
      startTime: '2026-07-18T01:00:00.000Z',
      endTime: '2026-07-18T03:00:00.000Z',
    }], 'COMPLETED');

    assert.equal(details.endAddress, 'Return point');
    assert.equal(details.endCoordinates, '8.44,124.6');
    assert.equal(details.endTime, '2026-07-18T03:00:00.000Z');
    assert.equal(details.engineHours, 2);
    assert.equal(details.status, 'completed');
  });
});

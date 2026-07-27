import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveActualTripEndpoints } from './tripDetailsRouteService.js';

describe('trip details actual route endpoints', () => {
  it('uses the same first and last telemetry points as the map', () => {
    const endpoints = deriveActualTripEndpoints([
      {
        lat: 8.439483,
        lng: 124.643974,
        timestamp: '2026-07-15T01:57:48.000Z',
        locationName: 'S. Diversion Road, Indahag',
      },
      {
        lat: 8.454537,
        lng: 124.623337,
        timestamp: '2026-07-15T08:49:21.000Z',
        locationName: 'Beacon Avenue, Carmen',
      },
    ], '8.453993,124.6229589', 'completed');

    assert.equal(endpoints.originAddress, 'S. Diversion Road, Indahag');
    assert.equal(endpoints.originCoordinates, '8.439483,124.643974');
    assert.equal(endpoints.startTime, '2026-07-15T01:57:48.000Z');
    assert.equal(endpoints.endAddress, 'Beacon Avenue, Carmen');
    assert.equal(endpoints.endCoordinates, '8.454537,124.623337');
    assert.equal(endpoints.endTime, '2026-07-15T08:49:21.000Z');
    assert.equal(endpoints.returnedToBaseAt, '2026-07-15T08:49:21.000Z');
    assert.ok((endpoints.matchedOriginDistanceM ?? Infinity) < 100);
  });

  it('returns null endpoints so callers can preserve planned placeholders without telemetry', () => {
    const endpoints = deriveActualTripEndpoints([], '8.453993,124.6229589', 'pending');

    assert.equal(endpoints.originAddress, null);
    assert.equal(endpoints.endAddress, null);
    assert.equal(endpoints.originCoordinates, null);
    assert.equal(endpoints.endCoordinates, null);
  });
});

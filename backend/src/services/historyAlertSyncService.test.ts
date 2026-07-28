import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LOW_FUEL_LITERS } from '@car-tracker/tracker';
import { deriveHistoryAlerts } from './historyAlertSyncService.js';

function state(overrides: Record<string, unknown> = {}) {
  return {
    lastEventAt: '2026-07-28T02:00:00.000Z',
    ignition: true,
    speedKmh: 20,
    fuelLiters: 30,
    locationName: 'Old Road',
    idleStartedAt: null,
    lastIdlingThresholdMinutes: 0,
    activeTripId: '11111111-1111-4111-8111-111111111111',
    ...overrides,
  };
}

function point(overrides: Record<string, unknown> = {}) {
  return {
    recordedAt: '2026-07-28T02:02:00.000Z',
    timestampMs: Date.parse('2026-07-28T02:02:00.000Z'),
    ignition: true,
    speedKmh: 25,
    fuelLiters: 29,
    locationName: 'New Road',
    latitude: 14.6,
    longitude: 121,
    ...overrides,
  };
}

describe('history alert derivation', () => {
  it('recovers a moving location transition between snapshots', () => {
    const result = deriveHistoryAlerts(state(), point());
    assert.deepEqual(result.alerts.map((alert) => alert.eventType), ['LOCATION_UPDATE']);
    assert.equal(result.next.locationName, 'New Road');
  });

  it('recovers ignition, speeding, and low-fuel threshold transitions', () => {
    const result = deriveHistoryAlerts(
      state({ ignition: false, speedKmh: 0, fuelLiters: LOW_FUEL_LITERS + 5, activeTripId: null }),
      point({ ignition: true, speedKmh: 90, fuelLiters: LOW_FUEL_LITERS - 1 }),
    );
    assert.deepEqual(result.alerts.map((alert) => alert.eventType), [
      'IGNITION_ON', 'LOCATION_UPDATE', 'SPEEDING', 'LOW_FUEL',
    ]);
    assert.ok(result.next.activeTripId);
  });

  it('reconstructs idling milestones and motion resumption', () => {
    const idle = deriveHistoryAlerts(
      state({
        speedKmh: 0,
        locationName: 'Depot',
        idleStartedAt: '2026-07-28T02:00:00.000Z',
      }),
      point({
        recordedAt: '2026-07-28T02:10:00.000Z',
        timestampMs: Date.parse('2026-07-28T02:10:00.000Z'),
        speedKmh: 0,
        locationName: 'Depot',
      }),
    );
    assert.equal(idle.alerts[0]?.eventType, 'IDLING_TOO_LONG');
    assert.equal(idle.alerts[0]?.idlingThresholdMinutes, 10);

    const moving = deriveHistoryAlerts(
      idle.next,
      point({
        recordedAt: '2026-07-28T02:11:00.000Z',
        timestampMs: Date.parse('2026-07-28T02:11:00.000Z'),
        speedKmh: 20,
        locationName: 'Exit Road',
      }),
    );
    assert.deepEqual(moving.alerts.map((alert) => alert.eventType), [
      'LOCATION_UPDATE', 'MOTION_STARTED',
    ]);
  });

  it('does not fabricate transition alerts during cursor bootstrap', () => {
    const result = deriveHistoryAlerts(
      state({ ignition: null, speedKmh: 0, fuelLiters: null, locationName: null, activeTripId: null }),
      point(),
    );
    assert.deepEqual(result.alerts, []);
  });
});

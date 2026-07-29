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
    assert.deepEqual(moving.alerts.map((alert) => alert.eventType), ['MOTION_STARTED']);

    const unchangedLocation = deriveHistoryAlerts(
      moving.next,
      point({
        recordedAt: '2026-07-28T02:12:00.000Z',
        timestampMs: Date.parse('2026-07-28T02:12:00.000Z'),
        speedKmh: 20,
        locationName: 'Exit Road',
      }),
    );
    assert.deepEqual(unchangedLocation.alerts, []);

    const changedAgain = deriveHistoryAlerts(
      unchangedLocation.next,
      point({
        recordedAt: '2026-07-28T02:13:00.000Z',
        timestampMs: Date.parse('2026-07-28T02:13:00.000Z'),
        speedKmh: 20,
        locationName: 'Next Road',
      }),
    );
    assert.deepEqual(changedAgain.alerts.map((alert) => alert.eventType), ['LOCATION_UPDATE']);
  });

  it('emits each cumulative idling milestone only once', () => {
    let cursor: Parameters<typeof deriveHistoryAlerts>[0] = state({
      speedKmh: 0,
      locationName: 'Depot',
      idleStartedAt: '2026-07-28T02:00:00.000Z',
    });

    const expected = [
      ['2026-07-28T02:10:00.000Z', 10],
      ['2026-07-28T02:25:00.000Z', 25],
      ['2026-07-28T02:55:00.000Z', 55],
    ] as const;
    for (const [recordedAt, threshold] of expected) {
      const result = deriveHistoryAlerts(cursor, point({
        recordedAt,
        timestampMs: Date.parse(recordedAt),
        speedKmh: 0,
        locationName: 'Depot',
      }));
      assert.deepEqual(result.alerts, [{
        eventType: 'IDLING_TOO_LONG',
        idlingThresholdMinutes: threshold,
      }]);
      cursor = result.next;

      const duplicate = deriveHistoryAlerts(cursor, point({
        recordedAt,
        timestampMs: Date.parse(recordedAt),
        speedKmh: 0,
        locationName: 'Depot',
      }));
      assert.deepEqual(duplicate.alerts, []);
      cursor = duplicate.next;
    }
  });

  it('resets idling milestones after movement and alerts on a later idle session', () => {
    const moving = deriveHistoryAlerts(
      state({
        speedKmh: 0,
        locationName: 'Depot',
        idleStartedAt: '2026-07-28T02:00:00.000Z',
        lastIdlingThresholdMinutes: 10,
      }),
      point({
        recordedAt: '2026-07-28T02:11:00.000Z',
        timestampMs: Date.parse('2026-07-28T02:11:00.000Z'),
        speedKmh: 20,
      }),
    );
    assert.equal(moving.next.idleStartedAt, null);
    assert.equal(moving.next.lastIdlingThresholdMinutes, 0);

    const idleStart = deriveHistoryAlerts(moving.next, point({
      recordedAt: '2026-07-28T02:12:00.000Z',
      timestampMs: Date.parse('2026-07-28T02:12:00.000Z'),
      speedKmh: 0,
      locationName: 'Next Depot',
    }));
    const nextMilestone = deriveHistoryAlerts(idleStart.next, point({
      recordedAt: '2026-07-28T02:22:00.000Z',
      timestampMs: Date.parse('2026-07-28T02:22:00.000Z'),
      speedKmh: 0,
      locationName: 'Next Depot',
    }));
    assert.equal(nextMilestone.alerts.at(-1)?.idlingThresholdMinutes, 10);
  });

  it('does not fabricate transition alerts during cursor bootstrap', () => {
    const result = deriveHistoryAlerts(
      state({ ignition: null, speedKmh: 0, fuelLiters: null, locationName: null, activeTripId: null }),
      point(),
    );
    assert.deepEqual(result.alerts, []);
  });
});

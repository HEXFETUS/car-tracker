import { dispatchTelegramAlert } from './telegramAlertDispatcher.js';
import type { TrackerAlertEvent } from '@car-tracker/tracker';
const eventTypes: Record<string, string> = {
  ignition_ON: 'IGNITION_ON', ignition_OFF: 'IGNITION_OFF',
  trip_state_IGNITION_ON: 'IGNITION_ON', trip_state_IGNITION_OFF: 'IGNITION_OFF',
  speeding: 'SPEEDING', low_fuel: 'LOW_FUEL', idling_too_long: 'IDLING_TOO_LONG',
  motion: 'MOTION_STARTED', location_update: 'LOCATION_UPDATE',
};

/** Compatibility route for the exported tracker helper. No second bot or pool. */
export async function dispatchTrackerAlerts(alerts: TrackerAlertEvent[], options: { deadlineAtMs?: number } = {}) {
  const summary = { queued: alerts.length, sent: 0, skipped: 0, failed: 0, persisted: 0 };
  for (const alert of alerts) {
    try {
      const result = await dispatchTelegramAlert({
        vehicleId: alert.vehicle_id ?? alert.vehicleId ?? '', plateNumber: alert.plate ?? '',
        eventType: alert.eventType ?? eventTypes[alert.type ?? ''] ?? '', recordedAt: alert.timestamp ?? '',
        telegramMessage: alert.message ?? '', activeTripId: alert.tripId ?? null,
        driverId: alert.driver_id ?? null, travelOrderId: alert.travelOrderId ?? null,
        idlingThresholdMinutes: alert.idlingThresholdReached ?? null,
        idlingStartedAt: alert.idlingStartedAt ?? null,
        latitude: alert.coordinates?.latitude ?? alert.coordinates?.lat ?? null,
        longitude: alert.coordinates?.longitude ?? alert.coordinates?.lng ?? null,
        ignition: alert.ignition ?? false, speedKmh: alert.speed ?? 0,
        fuelLiters: alert.fuel ?? null, locationName: alert.location ?? null,
      }, options);
      if (result.saved) summary.persisted++;
      if (result.outcome === 'accepted') summary.sent++;
      else if (result.outcome === 'failed' || result.outcome === 'unknown') summary.failed++;
      else summary.skipped++;
    } catch {
      // Do not echo arbitrary input or database/HTTP connection strings.
      console.error('[tracker] Durable alert dispatch failed');
      summary.failed++;
    }
  }
  return summary;
}

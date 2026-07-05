/**
 * Fleet Configuration Service
 *
 * Abstraction layer for accessing fleet operational settings.
 * Currently reads from compile-time constants, but can be swapped
 * to a database-backed Settings module without changing any consumer.
 *
 * Every service should use getFleetConfig() instead of importing
 * FLEET_CONFIG directly.
 */
import { FLEET_CONFIG } from '../config/constants.js';
import type { FleetConfig } from '../config/constants.js';

let cachedConfig: Readonly<FleetConfig> | null = null;

/**
 * Get the current fleet configuration.
 *
 * In the future, this function can be changed to read from a
 * database settings table, environment variables, or a remote
 * configuration service without modifying any consumer code.
 */
export function getFleetConfig(): Readonly<FleetConfig> {
  if (!cachedConfig) {
    cachedConfig = FLEET_CONFIG;
    console.log(`[FleetConfig] Loaded v${cachedConfig.version}`);
    console.log(`[FleetConfig] Base: ${cachedConfig.base.address}`);
    console.log(`[FleetConfig] Arrival radius: ${cachedConfig.arrival.radiusMeters}m, idle: ${cachedConfig.arrival.idleMinutes}min`);
    console.log(`[FleetConfig] Speed limit: ${cachedConfig.speed.defaultLimitKph}km/h`);
    console.log(`[FleetConfig] Trip idle limit: ${cachedConfig.trip.idleLimitMinutes}min, coord threshold: ${cachedConfig.trip.coordMatchThresholdM}m`);
  }
  return cachedConfig;
}

/**
 * Invalidate the cached config so the next call to getFleetConfig()
 * re-reads from the source. Useful when settings are changed at runtime.
 */
export function invalidateFleetConfigCache(): void {
  cachedConfig = null;
  console.log('[FleetConfig] Cache invalidated');
}
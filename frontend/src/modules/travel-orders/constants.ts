/**
 * Centralized fleet operational settings.
 *
 * All business rules (base location, arrival detection, speed limits,
 * telemetry deduplication) are defined here so they can be changed in
 * one place. When these values are eventually moved to a database-driven
 * Settings page, only this file needs to be replaced.
 */
export const FLEET_CONFIG = {
  /** Configuration version — bump when business rules change */
  version: 1,

  /** Depot / base location */
  base: {
    address:
      'Trade Street, Zone 1, Pueblo de Oro, Balulang, Cagayan de Oro, Northern Mindanao, 9000, Philippines',
    latitude: 8.4539930,
    longitude: 124.6229589,
    /** Radius (meters) within which a vehicle is considered "at base" */
    radiusMeters: 100,
  },
  /** Arrival detection at destinations */
  arrival: {
    /** Distance (meters) from a destination to trigger arrival */
    radiusMeters: 200,
    /** Minutes a vehicle must be idling before arrival is confirmed */
    idleMinutes: 10,
  },
  /** Telemetry deduplication rules */
  telemetry: {
    /** Only insert a new LOCATION_UPDATE row when the location_name changes */
    locationUpdateRule: 'LOCATION_NAME' as const,
  },
  /** Speed thresholds */
  speed: {
    /** Default speed limit (km/h) for alerting */
    defaultLimitKph: 80,
  },
  /** Trip detection */
  trip: {
    /** Minutes of idling before a trip is considered ended */
    idleLimitMinutes: 10,
    /** Distance threshold (meters) for coordinate-based TO matching */
    coordMatchThresholdM: 200,
  },
} as const;

// ── Backward-compatible aliases ────────────────────────────────

export const DEFAULT_ORIGIN_ADDRESS = FLEET_CONFIG.base.address;
export const DEFAULT_ORIGIN_LATLONG = `${FLEET_CONFIG.base.latitude},${FLEET_CONFIG.base.longitude}`;
export const DEFAULT_ORIGIN = {
  address: FLEET_CONFIG.base.address,
  latitude: FLEET_CONFIG.base.latitude,
  longitude: FLEET_CONFIG.base.longitude,
};
export const DEFAULT_BASE_RADIUS_METERS = FLEET_CONFIG.base.radiusMeters;
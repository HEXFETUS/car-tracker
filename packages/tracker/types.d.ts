// ── Type declarations for @car-tracker/tracker ──────────────
//
// These declarations describe the public API of the ESM-only JS
// tracker module so that TypeScript consumers (like the backend)
// can import it with full type safety.

/** Summary of the alert dispatch results for a single sync cycle. */
export interface AlertSummary {
  queued: number;
  sent: number;
  skipped: number;
  failed: number;
  persisted: number;
}

/** Per-vehicle status object returned in the sync result data array. */
export interface VehicleStatus {
  id: string;
  name: string;
  model: string | null;
  coordinates: { latitude: number; longitude: number } | null;
  location: string;
  time: string;
  speed: number;
  speeding: boolean;
  speed_limit: number;
  fuel: number | null;
  fuel_liters: number | null;
  fuel_percent: number | null;
  low_fuel: boolean;
  low_fuel_liters: number;
  idle_minutes: number | null;
  idling_too_long: boolean;
  idle_limit_minutes: number;
  idle_alert_count: number;
}

/** Structure of a trip log record produced by the tracker transformer. */
export interface TripLogRecord {
  plateNumber: string;
  tripDate: string;
  originGpsStartPoint: string;
  destinationGpsEndPoint: string;
  actualRouteRoadTaken: string;
  departureTimeGps: string | null;
  arrivalTimeGps: string | null;
  gpsDistanceKm: number;
  engineHours: number;
  maxSpeedKph: number;
  tripStatus: string;
  anomalyFlag: boolean;
  driverName: string | null;
  toNumber: string | null;
  vehicleId?: string;
}

/** Result returned by syncFleetAndAlert(). */
export interface SyncResult {
  status: string;
  vehicles: number;
  alerts: AlertSummary;
  data: VehicleStatus[];
  tripLogs: TripLogRecord[];
}

/**
 * Execute one full fleet sync and alert cycle.
 * Fetches live data from Cartrack, processes each vehicle's
 * telemetry, generates alerts, dispatches them to Telegram,
 * and persists them to Supabase.
 */
export function syncFleetAndAlert(): Promise<SyncResult>;

// ── Trip Log Transformer ──────────────────────────────────────

export function getEngineHours(vehicle: any): number;
export function getGpsDistanceKm(vehicle: any): number;
export function getStreetName(vehicle: any): string;
export function getTripStatus(vehicle: any, speed: number, ignition: boolean): string;
export function getPreviousLocation(vehicle: any): string;
export function buildTripLogRecord(vehicle: any, vehicleStatus: any, currentLocation: string): Omit<TripLogRecord, 'vehicleId'>;

import type { GpsTripLog, ApiResponse } from '@car-tracker/shared';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3500';

export interface GpsLogFilters {
  page?: number;
  pageSize?: number;
  vehicleId?: string;
  driverId?: string;
  tripDate?: string;
  anomalyFlag?: string;
}

export interface EnrichedGpsTripLog extends GpsTripLog {
  vehiclePlateNo: string;
  driverName: string;
  toNumber: string | null;
}

export interface GpsLogsResult {
  logs: EnrichedGpsTripLog[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchGpsLogs(filters: GpsLogFilters = {}): Promise<GpsLogsResult> {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  if (filters.vehicleId) params.set('vehicleId', filters.vehicleId);
  if (filters.driverId) params.set('driverId', filters.driverId);
  if (filters.tripDate) params.set('tripDate', filters.tripDate);
  if (filters.anomalyFlag !== undefined) params.set('anomalyFlag', filters.anomalyFlag);

  const qs = params.toString();
  const res = await fetch(`${API_BASE}/api/gps-logs${qs ? `?${qs}` : ''}`);
  const body: { success: boolean; data: EnrichedGpsTripLog[]; total: number; page: number; pageSize: number } = await res.json();
  if (!body.success) throw new Error('Failed to fetch GPS logs');
  return { logs: body.data, total: body.total, page: body.page, pageSize: body.pageSize };
}

export async function createGpsLog(
  payload: Record<string, unknown>,
): Promise<GpsTripLog> {
  const res = await fetch(`${API_BASE}/api/gps-logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: ApiResponse<GpsTripLog> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to create GPS log');
  return body.data;
}

export interface UpdateGpsLogPayload {
  notesRemarks?: string | null;
  actualRouteRoadTaken?: string;
  arrivalTimeGps?: string | null;
  gpsDistanceKm?: number;
  engineHours?: number;
  maxSpeedKph?: number;
  tripStatusGps?: string;
  anomalyFlag?: boolean;
  toStatusAuto?: string | null;
  travelOrderId?: string | null;
}

export async function updateGpsLog(id: string, payload: UpdateGpsLogPayload): Promise<GpsTripLog> {
  const res = await fetch(`${API_BASE}/api/gps-logs/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: ApiResponse<GpsTripLog> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to update GPS log');
  return body.data;
}

export async function deleteGpsLog(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/gps-logs/${id}`, {
    method: 'DELETE',
  });
  const body: { success: boolean; error?: string } = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to delete GPS log');
}

/** Result shape returned by the sync endpoint. */
export interface SyncResult {
  success: boolean;
  elapsed_seconds?: number;
  total_active_units?: number;
  alerts_dispatched?: number;
  alerts_skipped?: number;
  alerts_failed?: number;
  alerts_persisted?: number;
  gps_logs_saved?: number;
  gps_logs_failed?: number;
  timestamp?: string;
  error?: string;
}

/** Result shape returned by the sync-history endpoint. */
export interface SyncHistoryResult {
  success: boolean;
  synced: boolean;
  elapsed_seconds?: number;
  travel_order_id?: string;
  travel_order_status?: string;
  total_records_found?: number;
  gps_logs_saved?: number;
  gps_logs_failed?: number;
  message?: string;
  error?: string;
  timestamp?: string;
}

/**
 * Trigger a fleet sync cycle that fetches live telemetry from Cartrack
 * for all 3 tracked vehicles and persists GPS trip logs to the database.
 */
export async function syncGpsLogs(): Promise<SyncResult> {
  const res = await fetch(`${API_BASE}/api/gps-logs/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const body: SyncResult = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Sync failed');
  return body;
}

/**
 * Trigger a targeted historical sync for a specific vehicle and date.
 * The backend checks for an approved travel order before fetching
 * historical tracking telemetry from Cartrack.
 */
export async function syncGpsLogsHistory(
  vehicleId: string,
  date: string,
): Promise<SyncHistoryResult> {
  const params = new URLSearchParams({ vehicle_id: vehicleId, date });
  const res = await fetch(`${API_BASE}/api/gps-logs/sync-history?${params.toString()}`);
  const body: SyncHistoryResult = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Sync-history failed');
  return body;
}

/** Simplified vehicle shape for the dropdown selector. */
export interface VehicleOption {
  id: string;
  plateNumber: string;
}

const TRACKED_PLATES = ['KAR6444', 'KAR6412', 'KAR6558'];

/**
 * Fetch vehicles from the backend, filtered strictly by our
 * tracked plate numbers: KAR6444, KAR6412, KAR6558.
 */
export async function fetchTrackedVehicles(): Promise<VehicleOption[]> {
  const res = await fetch(`${API_BASE}/api/vehicles`);
  const body: { success: boolean; data: VehicleOption[] } = await res.json();
  if (!body.success || !body.data) return [];
  return body.data.filter((v) =>
    TRACKED_PLATES.includes(v.plateNumber.toUpperCase()),
  );
}
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

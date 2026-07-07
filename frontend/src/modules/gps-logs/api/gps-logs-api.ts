// ── GPS Logs API ──────────────────────────────────────────────
//
// Frontend API client for GPS logs and alerts.

import { API_BASE as ROOT_API_BASE } from '@/shared/api';
import { apiFetch } from '@/shared/api-client';

const API_BASE = '/api/gps-logs';

export interface EnrichedGpsTripLog {
  id: string;
  gpsRecordNo: string;
  tripDate: string;
  toDate?: string | null;
  vehicleId: string;
  driverId: string;
  originGpsStartPoint: string;
  destinationGpsEndPoint: string;
  coordinatesOrigin?: string | null;
  coordinatesDestination?: string | null;
  actualRouteRoadTaken: string;
  toOrigin?: string | null;
  toDestination?: string | null;
  departureTimeGps: string | null;
  parentGpsRecordNo?: string | null;
  pairedReturnId?: string | null;
  pairedReturnGpsRecordNo?: string | null;
  missionDisplay?: string;
  linkedOutboundTrip?: { id: string; gpsRecordNo: string } | null;
  linkedReturnTrip?: { id: string; gpsRecordNo: string } | null;
  arrivalTimeGps: string | null;
  gpsDistanceKm: number | null;
  engineHours: number | null;
  maxSpeedKph: number | null;
  tripStatusGps: string;
  travelOrderId: string | null;
  travelOrderStatus: string | null;
  toStatusAuto: string | null;
  anomalyFlag: boolean;
  notesRemarks: string | null;
  // Enhanced trip detection fields
  destinationVerified?: boolean;
  tripType?: string;
  parentTripId?: string | null;
  locationName?: string | null;
  vehiclePlateNo: string;
  driverName: string;
  toNumber: string | null;
  createdAt: string;
  updatedAt: string;
  // Calculated fields
  movingHours?: number | null;
  boundToBoundDistanceKm?: number | null;
}

export interface GpsLogsResult {
  success: boolean;
  data: EnrichedGpsTripLog[];
  total: number;
  page: number;
  pageSize: number;
  message?: string;
}

export interface NoToGpsLog {
  id: string;
  noToRecordNo: string;
  tripDate: string;
  vehicleId: string | null;
  driverId: string | null;
  travelOrderId: string | null;
  linkedToNumber: string | null;
  vehiclePlateNo: string;
  driverName: string;
  originAddress: string | null;
  originCoordinates: string | null;
  destinationAddress: string | null;
  destinationCoordinates: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  distanceKm: number | null;
  engineHours: number | null;
  movingHours: number | null;
  maxSpeedKph: number | null;
  status: string;
  statusDisplay: string;
  anomalyFlag: boolean;
  anomalyReason: string | null;
  notes: string | null;
  linkedAt: string | null;
  convertedGpsTripLogId: string | null;
  createdAt: string;
}

export interface NoToGpsLogsResult {
  success: boolean;
  data: NoToGpsLog[];
  total: number;
  page: number;
  pageSize: number;
}

export interface NoToLinkOption {
  id: string;
  toNumber: string;
  scheduledDeparture: string | null;
  scheduledArrival: string | null;
  origin: string | null;
  destination: string | null;
  vehiclePlateNo: string | null;
  driverName: string | null;
}

export interface SyncHistoryResult {
  success: boolean;
  synced: boolean;
  elapsed_seconds: number;
  travel_order_id?: string | null;
  travel_order_status?: string | null;
  total_records_found?: number;
  trips_found?: number;
  gps_logs_saved?: number;
  gps_logs_failed?: number;
  message: string;
  timestamp: string;
}

export interface VehicleOption {
  id: string;
  plateNumber: string;
}

type GpsLogResponse = {
  success: boolean;
  data: EnrichedGpsTripLog;
  message?: string;
  error?: string;
};

type DeleteGpsLogResponse = {
  success: boolean;
  message?: string;
  error?: string;
};

export type CreateGpsLogPayload = {
  gpsRecordNo: string;
  tripDate: string;
  vehicleId: string;
  driverId: string;
  originGpsStartPoint: string;
  destinationGpsEndPoint: string;
  actualRouteRoadTaken?: string;
  departureTimeGps?: string | null;
  arrivalTimeGps?: string | null;
  gpsDistanceKm?: number | null;
  engineHours?: number | null;
  maxSpeedKph?: number | null;
  tripStatusGps: string;
  travelOrderId?: string | null;
  toStatusAuto?: string | null;
  anomalyFlag?: boolean;
  notesRemarks?: string | null;
};

export type UpdateGpsLogPayload = Partial<{
  anomalyFlag: boolean;
  notesRemarks: string | null;
  tripStatusGps: string;
  actualRouteRoadTaken: string;
  arrivalTimeGps: string | null;
  gpsDistanceKm: number | null;
  engineHours: number | null;
  maxSpeedKph: number | null;
  toStatusAuto: string | null;
  travelOrderId: string | null;
}>;

const UPDATE_FIELD_MAP: Record<keyof UpdateGpsLogPayload, string> = {
  anomalyFlag: 'anomaly_flag',
  notesRemarks: 'notes_remarks',
  tripStatusGps: 'trip_status_gps',
  actualRouteRoadTaken: 'actual_route_road_taken',
  arrivalTimeGps: 'arrival_time_gps',
  gpsDistanceKm: 'gps_distance_km',
  engineHours: 'engine_hours',
  maxSpeedKph: 'max_speed_kph',
  toStatusAuto: 'to_status_auto',
  travelOrderId: 'travel_order_id',
};

async function parseJsonOrThrow<T>(res: Response, fallbackMessage: string): Promise<T> {
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error || json?.message || fallbackMessage);
  }
  return json as T;
}

/**
 * Fetch paginated GPS logs with optional filters.
 */
export async function fetchGpsLogs(params: {
  page?: number;
  pageSize?: number;
  vehicleId?: string;
  driverId?: string;
  tripDate?: string;
  anomalyFlag?: boolean;
} = {}): Promise<GpsLogsResult> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  if (params.vehicleId) qs.set('vehicleId', params.vehicleId);
  if (params.driverId) qs.set('driverId', params.driverId);
  if (params.tripDate) qs.set('tripDate', params.tripDate);
  if (params.anomalyFlag !== undefined) qs.set('anomalyFlag', String(params.anomalyFlag));

  const url = qs.toString() ? `${API_BASE}?${qs.toString()}` : API_BASE;
  const res = await apiFetch(url);
  if (!res.ok) throw new Error('Failed to fetch GPS logs');
  return res.json();
}

export async function fetchNoToGpsLogs(params: {
  page?: number;
  pageSize?: number;
  vehicleId?: string;
  tripDate?: string;
} = {}): Promise<NoToGpsLogsResult> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  if (params.vehicleId) qs.set('vehicleId', params.vehicleId);
  if (params.tripDate) qs.set('tripDate', params.tripDate);
  const res = await apiFetch(`${API_BASE}/no-to?${qs.toString()}`);
  return parseJsonOrThrow<NoToGpsLogsResult>(res, 'Failed to fetch No TO GPS logs');
}

export interface NoToSyncResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

export async function syncNoToLogs(): Promise<{ success: boolean; data: NoToSyncResult; message: string }> {
  const res = await apiFetch(`${API_BASE}/no-to/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return parseJsonOrThrow(res, 'Failed to sync No TO logs');
}

export async function fetchNoToLinkOptions(vehicleId?: string | null): Promise<{ success: boolean; data: NoToLinkOption[] }> {
  const qs = new URLSearchParams();
  if (vehicleId) qs.set('vehicleId', vehicleId);
  const res = await apiFetch(`${API_BASE}/no-to/link-options?${qs.toString()}`);
  return parseJsonOrThrow<{ success: boolean; data: NoToLinkOption[] }>(res, 'Failed to fetch Travel Order options');
}

export async function linkNoToGpsLog(id: string, travelOrderId: string): Promise<{ success: boolean; data: { telemetryBackfilled: number; linkedToNumber: string } }> {
  const res = await apiFetch(`${API_BASE}/no-to/${id}/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ travel_order_id: travelOrderId }),
  });
  return parseJsonOrThrow<{ success: boolean; data: { telemetryBackfilled: number; linkedToNumber: string } }>(res, 'Failed to link No TO GPS log');
}

/**
 * Create a GPS log.
 */
export async function createGpsLog(payload: CreateGpsLogPayload): Promise<GpsLogResponse> {
  const res = await apiFetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<GpsLogResponse>(res, 'Failed to create GPS log');
}

/**
 * Update allowed GPS log fields.
 */
export async function updateGpsLog(
  id: string,
  payload: UpdateGpsLogPayload,
): Promise<GpsLogResponse> {
  const body = Object.entries(payload).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (value !== undefined) {
      acc[UPDATE_FIELD_MAP[key as keyof UpdateGpsLogPayload]] = value;
    }
    return acc;
  }, {});

  const res = await apiFetch(`${API_BASE}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseJsonOrThrow<GpsLogResponse>(res, 'Failed to update GPS log');
}

/**
 * Delete a GPS log.
 */
export async function deleteGpsLog(id: string): Promise<DeleteGpsLogResponse> {
  const res = await apiFetch(`${API_BASE}/${id}`, { method: 'DELETE' });
  return parseJsonOrThrow<DeleteGpsLogResponse>(res, 'Failed to delete GPS log');
}

/**
 * Trigger historical sync for a specific vehicle and date.
 */
export async function syncGpsLogsHistory(vehicleId: string, date: string): Promise<SyncHistoryResult> {
  const qs = new URLSearchParams({ vehicle_id: vehicleId, date });
  const res = await apiFetch(`${API_BASE}/sync-history?${qs.toString()}`);
  if (!res.ok) throw new Error('History sync failed');
  return res.json();
}

/**
 * Fetch tracked vehicles list for dropdown filters.
 */
export async function fetchTrackedVehicles(): Promise<VehicleOption[]> {
  const res = await apiFetch(`${ROOT_API_BASE}/api/vehicles`);
  if (!res.ok) throw new Error('Failed to fetch vehicles');
  const json = await res.json();
  return (json.data || []).map((v: { id: string; plateNumber: string }) => ({
    id: v.id,
    plateNumber: v.plateNumber,
  }));
}

export interface AdminSyncPayload {
  fromDate: string;
  toDate: string;
}

export interface VehicleSyncResult {
  status: 'no_travel_order' | 'cartrack_unavailable' | 'no_gps_data' | 'completed';
  tripsCreated?: number;
  tripsFailed?: number;
  vehiclePlate?: string;
}

export interface TelemetryRow {
  id: string;
  vehicleId: string;
  plateNumber: string;
  eventType: string;
  latitude: number | null;
  longitude: number | null;
  speedKmh: number;
  fuelLiters: number | null;
  ignition: boolean;
  locationName: string | null;
  driverName: string | null;
  toNumber: string | null;
  recordedAt: string;
  createdAt: string;
}

export interface TelemetryResult {
  success: boolean;
  data: TelemetryRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TrackingHistorySyncResponse {
  success: boolean;
  data: {
    success: boolean;
    fromDate: string;
    toDate: string;
    totalVehiclesProcessed: number;
    totalTripsCreated: number;
    totalTripsFailed: number;
    results: VehicleSyncResult[];
    elapsedSeconds: number;
  };
  message: string;
  elapsed_seconds: number;
}

export async function fetchTelemetry(params: {
  page?: number;
  pageSize?: number;
  vehicleId?: string;
  plateNumber?: string;
  eventType?: string;
  dateFrom?: string;
  dateTo?: string;
} = {}): Promise<TelemetryResult> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  if (params.vehicleId) qs.set('vehicleId', params.vehicleId);
  if (params.plateNumber) qs.set('plateNumber', params.plateNumber);
  if (params.eventType) qs.set('eventType', params.eventType);
  if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
  if (params.dateTo) qs.set('dateTo', params.dateTo);

  const url = `${API_BASE}/telemetry?${qs.toString()}`;
  const res = await apiFetch(url);
  if (!res.ok) throw new Error('Failed to fetch telemetry');
  return res.json();
}

export async function syncTrackingHistory(payload: AdminSyncPayload): Promise<TrackingHistorySyncResponse> {
  const res = await apiFetch(`${ROOT_API_BASE}/api/admin/sync-tracking-history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Tracking history sync failed');
  return res.json();
}

export interface OrderStatusRow {
  id: string;
  toNumber: string;
  tripDate: string;
  driverName: string;
  vehiclePlate: string;
  vehicleId: string;
  origin: string;
  destination: string;
  toStatus: string;
  lastLocation: string;
  lastUpdate: string;
  speed: number;
  fuel: number | null;
  ignition: boolean;
  eventType: string;
  totalHours: number;
  movingHours: number;
  idlingHours: number;
  departureTime: string | null;
  arrivalTime: string | null;
  legNumber: number;
  legDescription: string;
  from: string;
  to: string;
}

export interface OrderStatusResult {
  success: boolean;
  data: OrderStatusRow[];
  total: number;
  page: number;
  pageSize: number;
  message?: string;
}

export async function fetchOrderStatus(params: {
  vehicleId?: string;
  tripDate?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<OrderStatusResult> {
  const qs = new URLSearchParams();
  if (params.vehicleId) qs.set('vehicleId', params.vehicleId);
  if (params.tripDate) qs.set('tripDate', params.tripDate);
  qs.set('page', String(params.page || 1));
  qs.set('pageSize', String(params.pageSize || 20));

  const res = await apiFetch(`${ROOT_API_BASE}/api/gps-logs/order-status?${qs.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch order status');
  return res.json();
}

// ── Trip Details Types ─────────────────────────────────────────

export interface TripRoutePoint {
  lat: number;
  lng: number;
  timestamp: string;
  speed: number;
  locationName: string | null;
  activeTripId?: string | null;
}

export interface ActiveTripSession {
  activeTripId: string;
  startTime: string | null;
  endTime: string | null;
}

export interface TripDetails {
  date: string;
  vehicle: string;
  driver: string;
  linkedTO: string | null;
  status: string;
  distance: number | null;
  engineHours: number | null;
  movingHours: number | null;
  maxSpeed: number | null;
  notes: string | null;
  origin: string;
  destination: string;
  routeRoadTaken: string;
  toOrigin: string | null;
  toDestination: string | null;
  toStatus: string | null;
  startTime: string | null;
  plannedDestinationAddress?: string | null;
  plannedDestinationCoordinates?: string | null;
  parentTripId?: string | null;
  parentGpsRecordNo?: string | null;
  pairedReturnId?: string | null;
  pairedReturnGpsRecordNo?: string | null;
  missionDisplay: string;
  linkedOutboundTrip?: { id: string; gpsRecordNo: string } | null;
  linkedReturnTrip?: { id: string; gpsRecordNo: string } | null;
  arrivedTime: string | null;
  endTime: string | null;
  arrivedCoordinates: string | null;
  arrivedLocation: string | null;
  matchedDestinationDistanceM?: number | null;
  endAddress?: string | null;
  endCoordinates?: string | null;
  returnedToBaseAt?: string | null;
  // No-TO specific arrival/end mapping fields
  destinationReachedAt?: string | null;
  arrivalTime?: string | null;
  departureTime?: string | null;
  pausedAt?: string | null;
  // Backend-computed arrival time (validated: rejects arrival == departure
  // unless destination_reached_at proves actual arrival; falls back to pausedAt)
  arrivalDisplayTime?: string | null;
  matchedOriginDistanceM?: number | null;
  travelOrderStatus?: string | null;
  anomalyFlag: boolean;
  anomalyReason?: string | null;
  coordinatesOrigin: string | null;
  coordinatesDestination: string | null;
  tripType?: string | null;
}

export interface TripDetailsResponse {
  success: boolean;
  data: {
    trip: TripDetails;
    route: TripRoutePoint[];
    routeCount: number;
    activeTripSessions?: ActiveTripSession[];
  };
}

/**
 * Fetch detailed trip information including GPS route history.
 * If the id is a pending ID (not a real UUID), it attempts to look
 * up the GPS log by travel order first, then fetches details.
 */
export async function fetchTripDetails(id: string): Promise<TripDetailsResponse> {
  let detailsId = id;

  // If the id starts with "pending-", this is a travel_order_id fallback
  if (id.startsWith('pending-')) {
    const travelOrderId = id.replace('pending-', '');
    try {
      const gpsLog = await fetchGpsLogByTravelOrder(travelOrderId);
      detailsId = gpsLog.data.id;
    } catch {
      // If no GPS log exists yet, fetch details directly from travel order via telemetry
      const res = await apiFetch(`${API_BASE}/travel-order/${travelOrderId}/details`);
      if (!res.ok) throw new Error('Failed to fetch trip details');
      const json = await res.json();
      console.log('[fetchTripDetails] Raw API response:', JSON.stringify(json, null, 2));
      return json;
    }
  }

  const res = await apiFetch(`${API_BASE}/${detailsId}/details`);
  if (!res.ok) throw new Error('Failed to fetch trip details');
  const json = await res.json();
  console.log('[fetchTripDetails] Raw API response:', JSON.stringify(json, null, 2));
  return json;
}

export async function fetchNoToTripDetails(id: string): Promise<TripDetailsResponse> {
  const res = await apiFetch(`${API_BASE}/no-to/${id}/details`);
  return parseJsonOrThrow<TripDetailsResponse>(res, 'Failed to fetch No TO trip details');
}

/**
 * Update only the notes field of a GPS log using the dedicated notes endpoint.
 * This is the preferred method for notes editing.
 */
export async function updateGpsLogNotes(id: string, notes: string | null): Promise<GpsLogResponse> {
  const res = await apiFetch(`${API_BASE}/${id}/notes`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes }),
  });
  return parseJsonOrThrow<GpsLogResponse>(res, 'Failed to update notes');
}

/**
 * Ensure a GPS log exists for a travel order (create or update).
 * If a log already exists for the travel_order_id, it updates the status.
 * If not, it creates a new GPS log.
 */
export async function ensureGpsLog(payload: {
  travel_order_id: string;
  vehicle_id: string;
  driver_id?: string | null;
  trip_status?: string;
  notes?: string | null;
}): Promise<GpsLogResponse & { created?: boolean }> {
  const res = await apiFetch(`${API_BASE}/ensure-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<GpsLogResponse & { created?: boolean }>(res, 'Failed to ensure GPS log');
}

/**
 * Get the single GPS log for a given travel order.
 */
export async function fetchGpsLogByTravelOrder(travelOrderId: string): Promise<GpsLogResponse> {
  const res = await apiFetch(`${API_BASE}/by-travel-order/${travelOrderId}`);
  if (!res.ok) throw new Error('Failed to fetch GPS log for travel order');
  return res.json();
}


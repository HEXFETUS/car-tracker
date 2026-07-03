// ── GPS Logs API ──────────────────────────────────────────────
//
// Frontend API client for GPS logs and alerts.

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
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch GPS logs');
  return res.json();
}

/**
 * Create a GPS log.
 */
export async function createGpsLog(payload: CreateGpsLogPayload): Promise<GpsLogResponse> {
  const res = await fetch(API_BASE, {
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

  const res = await fetch(`${API_BASE}/${id}`, {
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
  const res = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });
  return parseJsonOrThrow<DeleteGpsLogResponse>(res, 'Failed to delete GPS log');
}

/**
 * Trigger historical sync for a specific vehicle and date.
 */
export async function syncGpsLogsHistory(vehicleId: string, date: string): Promise<SyncHistoryResult> {
  const qs = new URLSearchParams({ vehicle_id: vehicleId, date });
  const res = await fetch(`${API_BASE}/sync-history?${qs.toString()}`);
  if (!res.ok) throw new Error('History sync failed');
  return res.json();
}

/**
 * Fetch tracked vehicles list for dropdown filters.
 */
export async function fetchTrackedVehicles(): Promise<VehicleOption[]> {
  const res = await fetch('/api/vehicles');
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
  // Active travel order info
  activeToNumber?: string | null;
  activeToStatus?: string | null;
  activeDriverName?: string | null;
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
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch telemetry');
  return res.json();
}

export async function syncTrackingHistory(payload: AdminSyncPayload): Promise<TrackingHistorySyncResponse> {
  const res = await fetch('/api/admin/sync-tracking-history', {
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

  const res = await fetch(`/api/gps-logs/order-status?${qs.toString()}`);
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
  anomalyFlag: boolean;
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
      const res = await fetch(`${API_BASE}/travel-order/${travelOrderId}/details`);
      if (!res.ok) throw new Error('Failed to fetch trip details');
      const json = await res.json();
      console.log('[fetchTripDetails] Raw API response:', JSON.stringify(json, null, 2));
      return json;
    }
  }

  const res = await fetch(`${API_BASE}/${detailsId}/details`);
  if (!res.ok) throw new Error('Failed to fetch trip details');
  const json = await res.json();
  console.log('[fetchTripDetails] Raw API response:', JSON.stringify(json, null, 2));
  return json;
}

/**
 * Update only the notes field of a GPS log using the dedicated notes endpoint.
 * This is the preferred method for notes editing.
 */
export async function updateGpsLogNotes(id: string, notes: string | null): Promise<GpsLogResponse> {
  const res = await fetch(`${API_BASE}/${id}/notes`, {
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
  const res = await fetch(`${API_BASE}/ensure-log`, {
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
  const res = await fetch(`${API_BASE}/by-travel-order/${travelOrderId}`);
  if (!res.ok) throw new Error('Failed to fetch GPS log for travel order');
  return res.json();
}


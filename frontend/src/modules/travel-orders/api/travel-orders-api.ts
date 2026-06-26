import type { ApiResponse } from '@/shared/types';
import { API_BASE } from '@/shared/api';
import { apiFetch } from '@/shared/api-client';

/** Fetch the next available TO sequence number for the current year. */
export async function fetchNextToNumber(): Promise<number> {
  const res = await apiFetch(`${API_BASE}/api/travel-orders/next-number`);
  const body: ApiResponse<number> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch next TO number');
  return body.data;
}

/** Shape returned by the /api/travel-orders endpoint. */
export interface TravelOrderData {
  id: string;
  toNumber: string;
  vehicleId: string | null;
  driverId: string | null;
  originLocation: string;
  destinationLocation: string;
  scheduledDepartureAt: string | null;
  scheduledArrivalAt: string | null;
  actualDepartureAt: string | null;
  actualArrivalAt: string | null;
  status: string;
  purpose: string | null;
  notes: string | null;
  department: string;
  travelerName: string;
  requestVehicle: boolean;
  requestDriver: boolean;
  plateNumber: string | null;
  driverName: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchTravelOrders(): Promise<TravelOrderData[]> {
  const res = await apiFetch(`${API_BASE}/api/travel-orders`);
  const body: ApiResponse<TravelOrderData[]> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch travel orders');
  return body.data;
}

/** Fetch PENDING orders where vehicle_id AND driver_id are NULL (Needs Assigning tab). */
export async function fetchPendingOrders(): Promise<TravelOrderData[]> {
  const res = await apiFetch(`${API_BASE}/api/travel-orders/pending`);
  const body: ApiResponse<TravelOrderData[]> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch pending travel orders');
  return body.data;
}

/** Fetch APPROVED orders (Approved tab). */
export async function fetchApprovedOrders(): Promise<TravelOrderData[]> {
  const res = await apiFetch(`${API_BASE}/api/travel-orders/approved`);
  const body: ApiResponse<TravelOrderData[]> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch approved travel orders');
  return body.data;
}

/** Fetch FOR_APPROVAL orders where vehicle_id AND driver_id are populated (For Approval tab). */
export async function fetchForApprovalOrders(): Promise<TravelOrderData[]> {
  const res = await apiFetch(`${API_BASE}/api/travel-orders/for-approval`);
  const body: ApiResponse<TravelOrderData[]> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch for-approval travel orders');
  return body.data;
}

/** Fetch CANCELLED orders (Cancelled tab). */
export async function fetchCancelledOrders(): Promise<TravelOrderData[]> {
  const res = await apiFetch(`${API_BASE}/api/travel-orders/cancelled`);
  const body: ApiResponse<TravelOrderData[]> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch cancelled travel orders');
  return body.data;
}

/** Assign a vehicle and driver to a travel order (transitions status to FOR_APPROVAL). */
export async function assignTravelOrder(
  id: string,
  vehicleId: string,
  driverId: string,
): Promise<TravelOrderData> {
  const res = await apiFetch(`${API_BASE}/api/travel-orders/${id}/assign`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vehicle_id: vehicleId, driver_id: driverId }),
  });
  const body: ApiResponse<TravelOrderData> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to assign travel order');
  return body.data;
}

/** Fetch all available vehicles. */
export async function fetchVehicles(): Promise<Array<{ id: string; plateNumber: string; make: string; model: string; year: number }>> {
  const res = await apiFetch(`${API_BASE}/api/vehicles`);
  const body: ApiResponse<Array<{ id: string; plateNumber: string; make: string; model: string; year: number }>> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch vehicles');
  return body.data;
}

/** Fetch all available drivers. */
export async function fetchDrivers(): Promise<Array<{ id: string; fullName: string; phone: string; licenseNumber: string }>> {
  const res = await apiFetch(`${API_BASE}/api/drivers`);
  const body: ApiResponse<Array<{ id: string; fullName: string; phone: string; licenseNumber: string }>> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch drivers');
  return body.data;
}

export async function fetchTravelOrderById(id: string): Promise<TravelOrderData> {
  const res = await apiFetch(`${API_BASE}/api/travel-orders/${id}`);
  const body: ApiResponse<TravelOrderData> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch travel order');
  return body.data;
}

export async function createTravelOrder(
  payload: {
    toNumber: string;
    vehicleId?: string;
    driverId?: string;
    originLocation: string;
    destinationLocation: string;
    scheduledDepartureAt?: string;
    scheduledArrivalAt?: string;
    purpose?: string;
    notes?: string;
    department?: string;
    travelerName?: string;
    requestVehicle?: boolean;
    requestDriver?: boolean;
    latLongOrigin?: string | null;
    latLongDestination?: string | null;
  },
): Promise<TravelOrderData> {
  const res = await apiFetch(`${API_BASE}/api/travel-orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: ApiResponse<TravelOrderData> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to create travel order');
  return body.data;
}

export async function updateTravelOrder(
  id: string,
  payload: Partial<{
    originLocation: string;
    destinationLocation: string;
    scheduledDepartureAt: string;
    scheduledArrivalAt: string;
    purpose: string;
    notes: string;
    department: string;
    travelerName: string;
    requestVehicle: boolean;
    requestDriver: boolean;
    status: string;
    approvedBy: string;
  }>,
): Promise<TravelOrderData> {
  const res = await apiFetch(`${API_BASE}/api/travel-orders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: ApiResponse<TravelOrderData> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to update travel order');
  return body.data;
}

export async function deleteTravelOrder(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/travel-orders/${id}`, {
    method: 'DELETE',
  });
  const body: ApiResponse<null> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to delete travel order');
}
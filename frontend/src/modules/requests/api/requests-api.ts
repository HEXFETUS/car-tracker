import type { ApiResponse } from '@car-tracker/shared';
import { API_BASE } from '@/shared/api';

/** Shape of a pending travel order from the /api/travel-orders/pending endpoint. */
export interface PendingTravelOrder {
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
  createdAt: string;
  updatedAt: string;
}

/** Shape of a vehicle from the /api/vehicles endpoint. */
export interface VehicleOption {
  id: string;
  plateNumber: string;
  make: string;
  model: string;
  year: number;
}

/** Shape of a driver from the /api/drivers endpoint. */
export interface DriverOption {
  id: string;
  fullName: string;
  phone: string;
}

/** Fetch all pending travel orders (PENDING status). */
export async function fetchPendingTravelOrders(): Promise<PendingTravelOrder[]> {
  const res = await fetch(`${API_BASE}/api/travel-orders/pending`);
  const body: ApiResponse<PendingTravelOrder[]> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch pending travel orders');
  return body.data;
}

/** Fetch all for-request travel orders (FOR_REQUEST status). */
export async function fetchForRequestOrders(): Promise<PendingTravelOrder[]> {
  const res = await fetch(`${API_BASE}/api/travel-orders/for-request`);
  const body: ApiResponse<PendingTravelOrder[]> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch for-request travel orders');
  return body.data;
}

/** Fetch all scheduled travel orders (FOR_APPROVAL, APPROVED, ACTIVE with departure dates). */
export async function fetchScheduledOrders(): Promise<PendingTravelOrder[]> {
  const res = await fetch(`${API_BASE}/api/travel-orders/scheduled`);
  const body: ApiResponse<PendingTravelOrder[]> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch scheduled travel orders');
  return body.data;
}

/** Fetch all vehicles (for the dropdown). */
export async function fetchVehicles(): Promise<VehicleOption[]> {
  const res = await fetch(`${API_BASE}/api/vehicles`);
  const body: ApiResponse<VehicleOption[]> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch vehicles');
  return body.data;
}

/** Fetch all drivers (for the dropdown). */
export async function fetchDrivers(): Promise<DriverOption[]> {
  const res = await fetch(`${API_BASE}/api/drivers`);
  const body: ApiResponse<DriverOption[]> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch drivers');
  return body.data;
}

/** Assign a vehicle and driver to a travel order. */
export async function assignTravelOrder(
  orderId: string,
  payload: { vehicle_id: string; driver_id: string },
): Promise<PendingTravelOrder> {
  const res = await fetch(`${API_BASE}/api/travel-orders/${orderId}/assign`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: ApiResponse<PendingTravelOrder> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to assign travel order');
  return body.data;
}

/** Update a travel order (e.g. change status). */
export async function updateTravelOrder(
  orderId: string,
  payload: Partial<{ status: string }>,
): Promise<PendingTravelOrder> {
  const res = await fetch(`${API_BASE}/api/travel-orders/${orderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: ApiResponse<PendingTravelOrder> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to update travel order');
  return body.data;
}

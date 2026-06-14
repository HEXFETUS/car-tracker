import type { ApiResponse } from '@car-tracker/shared';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3500';

/** Shape returned by the /api/travel-orders endpoint. */
export interface TravelOrderData {
  id: string;
  toNumber: number;
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

export async function fetchTravelOrders(): Promise<TravelOrderData[]> {
  const res = await fetch(`${API_BASE}/api/travel-orders`);
  const body: ApiResponse<TravelOrderData[]> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch travel orders');
  return body.data;
}

export async function fetchTravelOrderById(id: string): Promise<TravelOrderData> {
  const res = await fetch(`${API_BASE}/api/travel-orders/${id}`);
  const body: ApiResponse<TravelOrderData> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch travel order');
  return body.data;
}

export async function createTravelOrder(
  payload: {
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
  },
): Promise<TravelOrderData> {
  const res = await fetch(`${API_BASE}/api/travel-orders`, {
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
  }>,
): Promise<TravelOrderData> {
  const res = await fetch(`${API_BASE}/api/travel-orders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: ApiResponse<TravelOrderData> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to update travel order');
  return body.data;
}

export async function deleteTravelOrder(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/travel-orders/${id}`, {
    method: 'DELETE',
  });
  const body: ApiResponse<null> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to delete travel order');
}
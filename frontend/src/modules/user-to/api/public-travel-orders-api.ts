import { API_BASE } from '@/shared/api';

/** Response wrapper for public API calls. */
interface PublicApiResponse<T> {
  success: boolean;
  data: T;
  error: string | null;
}

/**
 * Fetch the next available TO sequence number for the current year.
 * Uses the public endpoint (no auth required).
 */
export async function fetchPublicNextToNumber(): Promise<number> {
  const res = await fetch(`${API_BASE}/api/public/travel-orders/next-number`);
  const body: PublicApiResponse<number> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch next TO number');
  return body.data;
}

/** Payload for creating a travel order via the public endpoint. */
export interface CreatePublicTravelOrderPayload {
  toNumber: string;
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
}

/**
 * Create a new travel order via the public endpoint (no auth required).
 */
export async function createPublicTravelOrder(
  payload: CreatePublicTravelOrderPayload,
): Promise<{ id: string; toNumber: string; status: string }> {
  const res = await fetch(`${API_BASE}/api/public/travel-orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: PublicApiResponse<{ id: string; to_number: string; status: string }> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to create travel order');
  return {
    id: body.data.id,
    toNumber: body.data.to_number,
    status: body.data.status,
  };
}
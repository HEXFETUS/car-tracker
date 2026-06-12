import type { Vehicle, ApiResponse } from '@car-tracker/shared';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export async function fetchVehicles(): Promise<Vehicle[]> {
  const res = await fetch(`${API_BASE}/api/vehicles`);
  const body: ApiResponse<Vehicle[]> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch vehicles');
  return body.data;
}

export async function createVehicle(
  payload: Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<Vehicle> {
  const res = await fetch(`${API_BASE}/api/vehicles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: ApiResponse<Vehicle> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to create vehicle');
  return body.data;
}
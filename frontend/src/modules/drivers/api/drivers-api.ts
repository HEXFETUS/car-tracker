import type { Driver, ApiResponse } from '@car-tracker/shared';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3500';

export async function fetchDrivers(): Promise<Driver[]> {
  const res = await fetch(`${API_BASE}/api/drivers`);
  const body: ApiResponse<Driver[]> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch drivers');
  return body.data;
}

export async function createDriver(
  payload: Omit<Driver, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<Driver> {
  const res = await fetch(`${API_BASE}/api/drivers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: ApiResponse<Driver> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to create driver');
  return body.data;
}
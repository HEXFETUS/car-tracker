import type { Driver, ApiResponse } from '@car-tracker/shared';
import { API_BASE } from '@/shared/api';

export async function fetchDrivers(): Promise<Driver[]> {
  const res = await fetch(`${API_BASE}/api/drivers`);
  const body: ApiResponse<Driver[]> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch drivers');
  return body.data;
}

export async function fetchDriver(id: string): Promise<Driver> {
  const res = await fetch(`${API_BASE}/api/drivers/${id}`);
  const body: ApiResponse<Driver> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch driver');
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

export async function updateDriver(
  id: string,
  payload: Partial<Omit<Driver, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<Driver> {
  const res = await fetch(`${API_BASE}/api/drivers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: ApiResponse<Driver> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to update driver');
  return body.data;
}

export async function updateDriverStatus(
  id: string,
  status: string,
): Promise<Driver> {
  return updateDriver(id, { status });
}

export async function deleteDriver(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/drivers/${id}`, {
    method: 'DELETE',
  });
  const body: ApiResponse<null> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to delete driver');
}
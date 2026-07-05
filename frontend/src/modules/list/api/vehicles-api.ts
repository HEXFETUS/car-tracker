import type { Vehicle, ApiResponse } from '@/shared/types';
import { API_BASE } from '@/shared/api';
import { apiFetch } from '@/shared/api-client';

export async function fetchVehicles(): Promise<Vehicle[]> {
  const res = await apiFetch(`${API_BASE}/api/vehicles`);
  const body: ApiResponse<Vehicle[]> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch vehicles');
  return body.data;
}

export async function fetchVehicle(id: string): Promise<Vehicle> {
  const res = await apiFetch(`${API_BASE}/api/vehicles/${id}`);
  const body: ApiResponse<Vehicle> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch vehicle');
  return body.data;
}

export async function createVehicle(
  payload: Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<Vehicle> {
  const res = await apiFetch(`${API_BASE}/api/vehicles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: ApiResponse<Vehicle> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to create vehicle');
  return body.data;
}

export async function updateVehicle(
  id: string,
  payload: Partial<Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<Vehicle> {
  const res = await apiFetch(`${API_BASE}/api/vehicles/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: ApiResponse<Vehicle> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to update vehicle');
  return body.data;
}

export async function toggleVehicleRepair(
  id: string,
  underRepair: boolean,
  notes?: string,
): Promise<Vehicle> {
  const res = await apiFetch(`${API_BASE}/api/vehicles/${id}/repair`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ underRepair, notes }),
  });
  const body: ApiResponse<Vehicle> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to update vehicle repair status');
  return body.data;
}

export async function deleteVehicle(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/vehicles/${id}`, {
    method: 'DELETE',
  });
  const body: ApiResponse<null> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to delete vehicle');
}

import type { Maintenance, ApiResponse } from '@/shared/types';
import { API_BASE } from '@/shared/api';
import { apiFetch } from '@/shared/api-client';

export async function fetchMaintenanceRecords(): Promise<Maintenance[]> {
  const res = await apiFetch(`${API_BASE}/api/maintenance`);
  const body: ApiResponse<Maintenance[]> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch maintenance records');
  return body.data;
}

export async function fetchMaintenanceRecord(id: string): Promise<Maintenance> {
  const res = await apiFetch(`${API_BASE}/api/maintenance/${id}`);
  const body: ApiResponse<Maintenance> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch maintenance record');
  return body.data;
}

export async function createMaintenance(
  payload: Omit<Maintenance, 'id' | 'createdAt' | 'updatedAt' | 'vehiclePlate' | 'vehicleName'>,
): Promise<Maintenance> {
  const res = await apiFetch(`${API_BASE}/api/maintenance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: ApiResponse<Maintenance> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to create maintenance record');
  return body.data;
}

export async function updateMaintenance(
  id: string,
  payload: Omit<Maintenance, 'id' | 'createdAt' | 'updatedAt' | 'vehiclePlate' | 'vehicleName'>,
): Promise<Maintenance> {
  const res = await apiFetch(`${API_BASE}/api/maintenance/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: ApiResponse<Maintenance> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to update maintenance record');
  return body.data;
}

export async function deleteMaintenance(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/maintenance/${id}`, {
    method: 'DELETE',
  });
  const body: ApiResponse<null> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to delete maintenance record');
}

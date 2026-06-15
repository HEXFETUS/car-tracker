import type { AppUser, ApiResponse } from '@car-tracker/shared';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3500';

export async function fetchUsers(): Promise<AppUser[]> {
  const res = await fetch(`${API_BASE}/api/users`);
  const body: ApiResponse<AppUser[]> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to fetch users');
  return body.data;
}

export async function createUser(
  payload: { name: string; username: string; password: string; userType: string; department?: string },
): Promise<AppUser> {
  const res = await fetch(`${API_BASE}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: ApiResponse<AppUser> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to create user');
  return body.data;
}

export async function updateUser(
  id: string,
  payload: { name?: string; username?: string; userType?: string; department?: string },
): Promise<AppUser> {
  const res = await fetch(`${API_BASE}/api/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: ApiResponse<AppUser> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to update user');
  return body.data;
}

export async function changeUserPassword(id: string, password: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/users/${id}/password`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const body: ApiResponse<AppUser> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to change password');
}

export async function deleteUser(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/users/${id}`, {
    method: 'DELETE',
  });
  const body: ApiResponse<{ id: string }> = await res.json();
  if (!body.success) throw new Error(body.error ?? 'Failed to delete user');
}

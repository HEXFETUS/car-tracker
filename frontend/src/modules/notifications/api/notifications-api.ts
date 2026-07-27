import type { ApiResponse, NotificationPageResponse } from '@/shared/types';
import { API_BASE } from '@/shared/api';
import { apiFetch } from '@/shared/api-client';

export async function fetchNotifications(page = 1): Promise<NotificationPageResponse> {
  const res = await apiFetch(`${API_BASE}/api/notifications?page=${page}`);
  const body: NotificationPageResponse = await res.json();
  return body.success
    ? body
    : { success: false, data: [], total: 0, page, pageSize: 20, hasMore: false };
}

export async function fetchUnreadCount(): Promise<number> {
  const res = await apiFetch(`${API_BASE}/api/notifications/unread-count`);
  const body: ApiResponse<{count:number}> = await res.json();
  return body.success ? body.data.count : 0;
}

export async function markAsRead(id: string): Promise<void> {
  await apiFetch(`${API_BASE}/api/notifications/${id}/read`, { method: 'PATCH' });
}

export async function markAllAsRead(): Promise<void> {
  await apiFetch(`${API_BASE}/api/notifications/read-all`, { method: 'PATCH' });
}

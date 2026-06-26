import { API_BASE } from '@/shared/api';
import { apiFetch } from '@/shared/api-client';

// ── Types ──────────────────────────────────────────────────────

export interface ConnectionMetric {
  [key: string]: unknown;
}

export interface ConnectionCheck {
  name: string;
  label: string;
  status: 'connected' | 'disconnected' | 'error';
  detail: string;
  lastChecked?: string;
  metrics?: ConnectionMetric;
}

export interface ConnectionStatusData {
  overall: 'connected' | 'degraded';
  connections: ConnectionCheck[];
  timestamp: string;
}

export interface SchedulerIntervalData {
  intervalSeconds: number;
  running: boolean;
}

export interface TelegramTestResult {
  ok: boolean;
  message: string;
}

interface ConnectionStatusResponse {
  success: boolean;
  data: ConnectionStatusData | null;
  error?: string;
}

interface SchedulerIntervalResponse {
  success: boolean;
  data: SchedulerIntervalData | null;
  error?: string;
}

interface TelegramTestResponse {
  success: boolean;
  data: TelegramTestResult | null;
  error?: string;
}

// ── API Functions ──────────────────────────────────────────────

/**
 * Fetch the current connection status of all system integrations.
 */
export async function fetchConnectionStatus(): Promise<ConnectionStatusData> {
  const base = API_BASE || '';
  const response = await apiFetch(`${base}/api/settings/connection-status`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to check connection status (HTTP ${response.status})`);
  }

  const result: ConnectionStatusResponse = await response.json();

  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to check connection status');
  }

  return result.data;
}

/**
 * Send a test Telegram message to verify connectivity.
 */
export async function sendTelegramTest(): Promise<TelegramTestResult> {
  const base = API_BASE || '';
  const response = await apiFetch(`${base}/api/settings/telegram-test`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to send test message (HTTP ${response.status})`);
  }

  const result: TelegramTestResponse = await response.json();

  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to send test message');
  }

  return result.data;
}

/**
 * Update the scheduler sync interval at runtime.
 */
export async function updateSchedulerInterval(intervalSeconds: number): Promise<SchedulerIntervalData> {
  const base = API_BASE || '';
  const response = await apiFetch(`${base}/api/settings/scheduler-interval`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ intervalSeconds }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update scheduler interval (HTTP ${response.status})`);
  }

  const result: SchedulerIntervalResponse = await response.json();

  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to update scheduler interval');
  }

  return result.data;
}
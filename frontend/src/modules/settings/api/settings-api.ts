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
export interface TelemetryTestResult {
  overall: 'passed' | 'failed';
  passed: number;
  failed: number;
  total: number;
  results: Array<{ name: string; passed: boolean; error?: string }>;
  timestamp: string;
}

interface TelemetryTestResponse {
  success: boolean;
  data: TelemetryTestResult | null;
  error?: string;
}

/**
 * Run the telemetry alert persistence regression tests.
 */
export async function runTelemetryTests(): Promise<TelemetryTestResult> {
  const base = API_BASE || '';
  const response = await apiFetch(`${base}/api/settings/run-telemetry-tests`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to run telemetry tests (HTTP ${response.status})`);
  }

  const result: TelemetryTestResponse = await response.json();

  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to run telemetry tests');
  }

  return result.data;
}

export interface SchedulerRunData {
  runs: Array<{
    id: number;
    started_at: string;
    finished_at: string | null;
    status: 'running' | 'success' | 'error';
    cycles_completed: number;
    error_message: string | null;
    created_at: string;
  }>;
  summary: {
    lastRunAt: string | null;
    lastStatus: 'success' | 'error' | 'running' | null;
    lastErrorMessage: string | null;
    cyclesCompleted: number;
    totalRuns: number;
    totalErrors: number;
  };
}

interface SchedulerRunsResponse {
  success: boolean;
  data: SchedulerRunData | null;
  error?: string;
}

interface SchedulerRunNowResponse {
  success: boolean;
  data: Record<string, unknown> | null;
  error?: string;
}

/**
 * Fetch recent scheduler run history from the database.
 */
export async function fetchSchedulerRuns(): Promise<SchedulerRunData> {
  const base = API_BASE || '';
  const response = await apiFetch(`${base}/api/settings/scheduler-runs`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch scheduler runs (HTTP ${response.status})`);
  }

  const result: SchedulerRunsResponse = await response.json();

  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to fetch scheduler runs');
  }

  return result.data;
}

/**
 * Manually trigger a single scheduler cycle ("Run Once").
 */
export async function triggerSchedulerRunOnce(): Promise<Record<string, unknown>> {
  const base = API_BASE || '';
  const response = await apiFetch(`${base}/api/settings/scheduler-run-now`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Failed to trigger scheduler run (HTTP ${response.status})`);
  }

  const result: SchedulerRunNowResponse = await response.json();

  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to trigger scheduler run');
  }

  return result.data;
}

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
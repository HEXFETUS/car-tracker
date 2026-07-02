// ── Connection Page ────────────────────────────────────────────
//
// Modern card-based layout showing system health and connection status.
// Uses SettingsCard components in a responsive grid.

import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { useNotification } from '@/shared/context/NotificationContext';
import { cn } from '@/shared/lib/utils';
import {
  fetchConnectionStatus,
  updateSchedulerInterval,
  sendTelegramTest,
  type ConnectionCheck,
} from '../api/settings-api';
import {
  Loader2,
  AlertTriangle,
  Activity,
  Truck,
  MessageSquare,
  Timer,
  Database,
  RefreshCw,
  CheckCircle2,
  Globe,
} from 'lucide-react';
import { SettingsCard, type StatusVariant, type SettingsCardDetail } from '../components/SettingsCard';
import { SchedulerRunOnceButton } from '../components/SchedulerRunOnceButton';
import { SchedulerRunHistory } from '../components/SchedulerRunHistory';

// ── Helpers ─────────────────────────────────────────────────────

function connectionStatusToVariant(status: ConnectionCheck['status']): StatusVariant {
  switch (status) {
    case 'connected': return 'connected';
    case 'disconnected': return 'disconnected';
    case 'error': return 'error';
    default: return 'disabled';
  }
}

function formatDate(dateStr: unknown): string {
  if (!dateStr || typeof dateStr !== 'string') return '—';
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return String(dateStr);
  }
}

function formatNumber(value: unknown): string {
  if (typeof value === 'number') return value.toLocaleString();
  return String(value ?? '—');
}

function isConfigured(value: unknown): string {
  if (value === true || value === 'true') return 'Configured';
  if (value === false || value === 'false') return 'Not Configured';
  return String(value ?? '—');
}

// ── Scheduler Interval Editor ──────────────────────────────────

function SchedulerIntervalEditor({
  currentSeconds,
  onReload,
}: {
  currentSeconds: number;
  onReload?: () => void;
}) {
  const { toast } = useNotification();
  const initMinutes = Math.floor(currentSeconds / 60);
  const initSeconds = currentSeconds % 60;
  const [minutes, setMinutes] = useState(initMinutes);
  const [seconds, setSeconds] = useState(initSeconds);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMinutes(Math.floor(currentSeconds / 60));
    setSeconds(currentSeconds % 60);
  }, [currentSeconds]);

  const handleSave = async () => {
    const totalSec = minutes * 60 + seconds;
    if (totalSec < 10) {
      toast('Interval must be at least 10 seconds', 'error');
      return;
    }
    setSaving(true);
    try {
      await updateSchedulerInterval(totalSec);
      toast(`Sync interval updated to ${formatDuration(totalSec)}`, 'success');
      onReload?.();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update interval', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-zinc-400">Min</span>
          <input
            type="number"
            min={0}
            max={60}
            value={minutes}
            onChange={(e) => setMinutes(Math.max(0, parseInt(e.target.value) || 0))}
            className="w-16 rounded-lg border border-zinc-200 px-2 py-1 text-xs text-zinc-800 focus:border-brand-teal focus:outline-none focus:ring-1 focus:ring-brand-teal"
          />
        </label>
        <span className="pb-1 text-xs text-zinc-400">:</span>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-zinc-400">Sec</span>
          <input
            type="number"
            min={0}
            max={59}
            value={seconds}
            onChange={(e) => setSeconds(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
            className="w-16 rounded-lg border border-zinc-200 px-2 py-1 text-xs text-zinc-800 focus:border-brand-teal focus:outline-none focus:ring-1 focus:ring-brand-teal"
          />
        </label>
        <span className="pb-1 text-[10px] text-zinc-400">
          = {formatDuration(minutes * 60 + seconds)}
        </span>
      </div>
      <button
        onClick={handleSave}
        disabled={saving}
        className="inline-flex items-center gap-1 rounded-lg bg-brand-teal px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-teal/80 disabled:opacity-60"
      >
        {saving && <Loader2 className="size-3 animate-spin" />}
        {saving ? 'Saving…' : 'Apply'}
      </button>
    </div>
  );
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

// ── Telegram Test Section ──────────────────────────────────────

function TelegramTestSection() {
  const { toast } = useNotification();
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    setSending(true);
    try {
      await sendTelegramTest();
      toast('Test message sent successfully!', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to send test message', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex justify-end mt-2">
      <button
        onClick={handleSend}
        disabled={sending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-teal/80 disabled:opacity-60"
      >
        {sending && <Loader2 className="size-3 animate-spin" />}
        <MessageSquare className="size-3" />
        {sending ? 'Sending…' : 'Send Test'}
      </button>
    </div>
  );
}

// ── Overall Status Banner ──────────────────────────────────────

const OVERALL_CONFIG = {
  connected: {
    icon: CheckCircle2,
    bg: 'bg-emerald-50 border-emerald-200',
    text: 'text-emerald-800',
    label: 'All systems operational',
  },
  degraded: {
    icon: AlertTriangle,
    bg: 'bg-amber-50 border-amber-200',
    text: 'text-amber-800',
    label: 'Degraded service',
  },
} as const;

function OverallBanner({ overall }: { overall: 'connected' | 'degraded' }) {
  const config = OVERALL_CONFIG[overall] ?? OVERALL_CONFIG.degraded;
  const Icon = config.icon;

  return (
    <div className={cn('rounded-xl border px-4 py-3', config.bg)}>
      <div className="flex items-center gap-3">
        <Icon className={cn('size-5 shrink-0', config.text)} />
        <p className={cn('text-sm font-medium', config.text)}>{config.label}</p>
      </div>
    </div>
  );
}

// ── Connection Card Factory ────────────────────────────────────

function buildSystemHealthCard(connection: ConnectionCheck, onReload: () => void) {
  const m = connection.metrics || {};
  const details: SettingsCardDetail[] = [];

  // General system info
  if (connection.lastChecked) {
    details.push({ label: 'Last Checked', value: formatDate(connection.lastChecked) });
  }

  return (
    <SettingsCard
      key={connection.name}
      icon={<Activity className="size-4" />}
      title={connection.label}
      description={connection.detail}
      status={connectionStatusToVariant(connection.status)}
      details={details}
      action={{ label: 'Refresh', onClick: onReload }}
    >
      {connection.name === 'scheduler' && m.intervalSeconds != null && (
        <SchedulerIntervalEditor
          currentSeconds={Number(m.intervalSeconds)}
          onReload={onReload}
        />
      )}
    </SettingsCard>
  );
}

function buildSchedulerCard(connection: ConnectionCheck, _onReload: () => void) {
  const m = connection.metrics || {};

  const details: SettingsCardDetail[] = [
    { label: 'Cron Mode', value: String(m.cronMode ?? 'Vercel Cron') },
    { label: 'Last Status', value: String(m.lastCronStatus ?? m.dbLastStatus ?? '—') },
    { label: 'Last Run', value: formatDate(m.lastRunAt ?? m.dbLastRunAt) },
    { label: 'Cycles Completed', value: formatNumber(m.cyclesCompleted ?? m.dbCyclesCompleted ?? 0) },
    { label: 'Total Runs', value: formatNumber(m.totalRuns ?? m.dbTotalRuns ?? 0) },
    { label: 'Total Errors', value: formatNumber(m.errors ?? m.totalErrors ?? m.dbTotalErrors ?? 0) },
    { label: 'Next Schedule', value: String(m.nextSchedule ?? 'Daily at 8:00 AM Manila') },
  ];

  const status: StatusVariant = connection.status === 'connected' ? 'connected' : 'degraded';

  return (
    <SettingsCard
      key={connection.name}
      icon={<Timer className="size-4" />}
      title="Scheduler Status"
      description="Vercel Cron-powered fleet sync scheduler"
      status={status}
      details={details}
    >
      {/* Action buttons aligned right */}
      <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-zinc-100">
        <button
          onClick={_onReload}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
        >
          <RefreshCw className="size-3" />
          Refresh
        </button>
        <SchedulerRunOnceButton onComplete={_onReload} />
      </div>
    </SettingsCard>
  );
}

function buildTelegramCard(connection: ConnectionCheck) {
  const m = connection.metrics || {};

  const details: SettingsCardDetail[] = [
    { label: 'Status', value: connection.detail },
    { label: 'Bot Token', value: m.botValid ? 'Configured' : 'Not Configured' },
    { label: 'Chat ID', value: m.chatReachable ? 'Configured' : 'Not Configured' },
  ];

  return (
    <SettingsCard
      key={connection.name}
      icon={<MessageSquare className="size-4" />}
      title="Telegram Configuration"
      description="Bot notifications and alerts"
      status={connectionStatusToVariant(connection.status)}
      details={details}
    >
      <TelegramTestSection />
    </SettingsCard>
  );
}

function buildDatabaseCard(_connection?: ConnectionCheck) {
  // Database status is derived from overall connection data
  return (
    <SettingsCard
      icon={<Database className="size-4" />}
      title="Database Status"
      description="PostgreSQL database connection"
      status="connected"
      details={[
        { label: 'Connection', value: 'Active' },
        { label: 'Type', value: 'PostgreSQL' },
      ]}
    />
  );
}

function buildCartrackApiCard(connection: ConnectionCheck) {
  const m = connection.metrics || {};

  const details: SettingsCardDetail[] = [
    { label: 'API Status', value: connection.detail },
    { label: 'Configured', value: isConfigured(m.cartrackConfigured) },
    { label: 'Reachable', value: isConfigured(m.cartrackReachable) },
    { label: 'Total Vehicles', value: formatNumber(m.totalVehicles) },
    { label: 'Vehicles with Plates', value: formatNumber(m.vehiclesWithPlate) },
  ];

  return (
    <SettingsCard
      key="cartrack"
      icon={<Truck className="size-4" />}
      title="Cartrack API Configuration"
      description="Fleet data integration"
      status={connectionStatusToVariant(connection.status)}
      details={details}
    />
  );
}

function buildVercelCronCard(_connection?: ConnectionCheck) {
  return (
    <SettingsCard
      icon={<Globe className="size-4" />}
      title="Vercel Cron"
      description="Scheduled fleet sync via Vercel Cron Jobs"
      status="teal"
      details={[
        { label: 'Schedule', value: 'Daily at 8:00 AM Manila' },
        { label: 'Type', value: 'CRON (Vercel)' },
        { label: 'Status', value: 'Active' },
      ]}
    />
  );
}

// ── Component ──────────────────────────────────────────────────

export interface ConnectionPageHandle {
  refresh: () => void;
}

export const ConnectionPage = forwardRef<ConnectionPageHandle, object>(function ConnectionPage(_props, ref) {
  const { toast } = useNotification();

  const [overall, setOverall] = useState<'connected' | 'degraded'>('degraded');
  const [connections, setConnections] = useState<ConnectionCheck[]>([]);
  const [timestamp, setTimestamp] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setRefreshing] = useState(false);

  const loadStatus = useCallback(
    async (isRefresh = false) => {
      try {
        if (isRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        setError(null);

        const data = await fetchConnectionStatus();
        setOverall(data.overall);
        setConnections(data.connections);
        setTimestamp(data.timestamp);

        if (data.overall === 'degraded') {
          const failed = data.connections.filter((c) => c.status !== 'connected');
          const message = failed.map((c) => c.label).join(', ');
          toast(`Connection issues: ${message}`, 'info');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load connection status');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useImperativeHandle(ref, () => ({
    refresh: () => loadStatus(true),
  }));

  // ── Render ──────────────────────────────────────────────────

  // Loading state
  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-100 bg-white p-6 shadow-brand">
        <div className="flex items-center justify-center py-10">
          <Loader2 className="size-5 animate-spin text-brand-teal" />
          <span className="ml-3 text-sm text-zinc-500">Loading settings...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="rounded-xl border border-zinc-100 bg-white p-6 shadow-brand">
        <div className="text-center py-10">
          <AlertTriangle className="size-8 text-red-400 mx-auto mb-3" />
          <p className="text-sm font-medium text-zinc-700">Unable to load settings</p>
          <p className="text-xs text-zinc-400 mt-1 mb-4">
            Please refresh or check backend connection.
          </p>
          <button
            onClick={() => loadStatus()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-teal/80"
          >
            <RefreshCw className="size-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Find specific connections by name
  const schedulerConn = connections.find((c) => c.name === 'scheduler');
  const telegramConn = connections.find((c) => c.name === 'telegram');
  const cartrackConn = connections.find((c) => c.name === 'fleet' || c.name === 'cartrack');
  const systemConns = connections.filter(
    (c) => c.name !== 'scheduler' && c.name !== 'telegram' && c.name !== 'fleet' && c.name !== 'cartrack',
  );

  return (
    <div className="space-y-4">
      {/* Overall status banner */}
      <OverallBanner overall={overall} />

      {/* Responsive card grid */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {/* System Health cards (non-scheduler, non-telegram, non-fleet) */}
        {systemConns.map((conn) => buildSystemHealthCard(conn, () => loadStatus(true)))}

        {/* Scheduler card */}
        {schedulerConn && buildSchedulerCard(schedulerConn, () => loadStatus(true))}

        {/* Telegram card */}
        {telegramConn && buildTelegramCard(telegramConn)}

        {/* Database status */}
        {buildDatabaseCard()}

        {/* Cartrack API card */}
        {cartrackConn && buildCartrackApiCard(cartrackConn)}

        {/* Vercel Cron card */}
        {buildVercelCronCard()}
      </div>

      {/* Scheduler Run History */}
      <SchedulerRunHistory />

      {/* Timestamp */}
      {timestamp && (
        <p className="text-center text-xs text-zinc-400">
          Last updated: {new Date(timestamp).toLocaleString()}
        </p>
      )}
    </div>
  );
});
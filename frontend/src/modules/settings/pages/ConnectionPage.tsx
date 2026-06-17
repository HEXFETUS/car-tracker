import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { useNotification } from '@/shared/context/NotificationContext';
import { cn } from '@/shared/lib/utils';
import { fetchConnectionStatus, updateSchedulerInterval, sendTelegramTest, type ConnectionCheck } from '../api/settings-api';
import {
  Wifi,
  WifiOff,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Activity,
  Truck,
  MapPin,
  MessageSquare,
  Timer,
} from 'lucide-react';

// ── Icons per connection type ──────────────────────────────────

const CONNECTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  fleet: Truck,
  'gps-logs': MapPin,
  telegram: MessageSquare,
  scheduler: Timer,
};

// ── Status Badge ───────────────────────────────────────────────

const STATUS_CONFIG = {
  connected: {
    icon: Wifi,
    bg: 'bg-emerald-100',
    text: 'text-emerald-700',
    dot: 'bg-emerald-500',
    label: 'Connected',
  },
  disconnected: {
    icon: WifiOff,
    bg: 'bg-zinc-100',
    text: 'text-zinc-500',
    dot: 'bg-zinc-400',
    label: 'Disconnected',
  },
  error: {
    icon: AlertTriangle,
    bg: 'bg-amber-100',
    text: 'text-amber-700',
    dot: 'bg-amber-500',
    label: 'Degraded',
  },
} as const;

function StatusBadge({ status }: { status: ConnectionCheck['status'] }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.disconnected;
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
        config.bg,
        config.text,
      )}
    >
      <span className={cn('size-1.5 rounded-full', config.dot)} />
      <Icon className="size-3" />
      {config.label}
    </span>
  );
}

// ── Overall Status Banner ──────────────────────────────────────

const OVERALL_CONFIG = {
  connected: {
    icon: Wifi,
    bg: 'bg-emerald-50 border-emerald-200',
    text: 'text-emerald-800',
    label: 'All systems operational',
    description: 'All connections are working properly.',
  },
  degraded: {
    icon: AlertTriangle,
    bg: 'bg-amber-50 border-amber-200',
    text: 'text-amber-800',
    label: 'Degraded service',
    description: 'One or more connections have issues.',
  },
} as const;

function OverallBanner({ overall }: { overall: 'connected' | 'degraded' }) {
  const config = OVERALL_CONFIG[overall] ?? OVERALL_CONFIG.degraded;
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'rounded-2xl border p-4 sm:p-6',
        config.bg,
      )}
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <div className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-xl',
          overall === 'connected' ? 'bg-emerald-200' : 'bg-amber-200',
        )}>
          <Icon className={cn('size-5', config.text)} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className={cn('text-base font-semibold sm:text-lg', config.text)}>
            {config.label}
          </h2>
          <p className={cn('mt-0.5 text-sm', config.text)}>
            {config.description}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Connection Detail Card ─────────────────────────────────────

interface ConnectionCardProps {
  connection: ConnectionCheck;
  defaultExpanded?: boolean;
  onReload?: () => void;
}

const DETAIL_LABELS: Record<string, string> = {
  cartrackConfigured: 'Cartrack API Configured',
  totalVehicles: 'Total Vehicles',
  vehiclesWithPlate: 'Vehicles with Plate Numbers',
  cartrackReachable: 'Cartrack API Reachable',
  totalGpsLogs: 'Total GPS Logs',
  logsWithTravelOrder: 'Logs Linked to Travel Orders',
  vehiclesWithLogs: 'Vehicles with Logs',
  logsLast24h: 'Logs in Last 24 Hours',
  pipelineRunning: 'Fleet Sync Pipeline Active',
  schedulerCyclesCompleted: 'Scheduler Cycles Completed',
  schedulerErrors: 'Scheduler Errors',
  activeTelemetryCount: 'Active Telemetry (Ignition On)',
  secondsSinceLastPipelineRun: 'Seconds Since Last Sync',
  telegramConfigured: 'Telegram Configured',
  botValid: 'Bot Token Valid',
  botUsername: 'Bot Username',
  chatReachable: 'Chat Reachable',
  schedulerRunning: 'Scheduler Running',
  schedulerPaused: 'Scheduler Paused',
  cyclesCompleted: 'Cycles Completed',
  errors: 'Errors',
  intervalSeconds: 'Sync Interval (s)',
  startedAt: 'Started At',
  lastRunAt: 'Last Run At',
  lastResult: 'Last Result',
};

// ── Scheduler Interval Editor ──────────────────────────────────

function SchedulerIntervalEditor({
  currentSeconds,
  onReload,
}: {
  currentSeconds: number;
  onReload?: () => void;
}) {
  const { toast } = useNotification();

  // Derive initial minutes/seconds from the current value
  const initMinutes = Math.floor(currentSeconds / 60);
  const initSeconds = currentSeconds % 60;

  const [minutes, setMinutes] = useState(initMinutes);
  const [seconds, setSeconds] = useState(initSeconds);
  const [saving, setSaving] = useState(false);

  // Keep local state in sync if the prop changes (outside refresh)
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
    <div className="rounded-xl border border-zinc-100 p-3 space-y-3">
      <p className="text-xs font-medium text-zinc-500">Sync Interval</p>

      <div className="flex items-end gap-2">
        {/* Minutes */}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-zinc-400">Minutes</span>
          <input
            type="number"
            min={0}
            max={60}
            value={minutes}
            onChange={(e) => setMinutes(Math.max(0, parseInt(e.target.value) || 0))}
            className="w-20 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm text-zinc-800 focus:border-brand-teal focus:outline-none focus:ring-1 focus:ring-brand-teal"
          />
        </label>

        <span className="pb-2 text-sm text-zinc-400">:</span>

        {/* Seconds */}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-zinc-400">Seconds</span>
          <input
            type="number"
            min={0}
            max={59}
            value={seconds}
            onChange={(e) => setSeconds(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
            className="w-20 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm text-zinc-800 focus:border-brand-teal focus:outline-none focus:ring-1 focus:ring-brand-teal"
          />
        </label>

        {/* Preview */}
        <div className="pb-2 text-xs text-zinc-400">
          = {formatDuration(minutes * 60 + seconds)}
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-teal/80 disabled:opacity-60"
      >
        {saving && <Loader2 className="size-3 animate-spin" />}
        {saving ? 'Saving…' : 'Apply'}
      </button>
    </div>
  );
}

/** Format a total number of seconds into a human-readable duration string. */
function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

// ── Telegram Test Button ───────────────────────────────────────

function TelegramTestButton() {
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
    <div className="rounded-xl border border-zinc-100 p-3 space-y-3">
      <p className="text-xs font-medium text-zinc-500">Test Connection</p>
      <p className="text-xs text-zinc-400">
        Send a test message to your Telegram chat to verify end-to-end connectivity.
      </p>
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

function ConnectionCard({ connection, defaultExpanded = false, onReload }: ConnectionCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const Icon = CONNECTION_ICONS[connection.name] ?? Activity;
  const metricsEntries = connection.metrics
    ? Object.entries(connection.metrics).filter(([key]) => key in DETAIL_LABELS)
    : [];

  return (
    <div className="rounded-2xl bg-white shadow-brand overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-brand-cream/50"
      >
        <div className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-xl',
          connection.status === 'connected' ? 'bg-emerald-100' : 'bg-zinc-100',
        )}>
          <Icon className={cn(
            'size-5',
            connection.status === 'connected' ? 'text-emerald-600' : 'text-zinc-400',
          )} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-900">
              {connection.label}
            </span>
            <StatusBadge status={connection.status} />
          </div>
          <p className="mt-0.5 text-xs text-zinc-400 truncate">
            {connection.detail}
          </p>
        </div>

        <div className="shrink-0 text-zinc-300">
          {expanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-zinc-100 px-5 py-4 space-y-3">
          {/* Last checked time */}
          {connection.lastChecked && (
            <div className="text-xs text-zinc-400">
              Last checked: {new Date(connection.lastChecked).toLocaleString()}
            </div>
          )}

          {/* Detail text */}
          <div className="text-sm text-zinc-600">
            {connection.detail}
          </div>

          {/* Metrics table */}
          {metricsEntries.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-zinc-100">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-brand-cream">
                    <th className="px-3 py-2 font-medium text-zinc-600">Metric</th>
                    <th className="px-3 py-2 font-medium text-zinc-600">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {metricsEntries.map(([key, value]) => (
                    <tr key={key} className="border-t border-zinc-100">
                      <td className="px-3 py-2 text-zinc-500">
                        {DETAIL_LABELS[key] ?? key}
                      </td>
                      <td className="px-3 py-2 font-medium text-zinc-800">
                        {typeof value === 'boolean'
                          ? value
                            ? '✅ Yes'
                            : '❌ No'
                          : typeof value === 'number'
                            ? value.toLocaleString()
                            : String(value ?? '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Scheduler interval editor – only shown for the scheduler card */}
          {connection.name === 'scheduler' && connection.metrics?.intervalSeconds != null && (
            <SchedulerIntervalEditor
              currentSeconds={Number(connection.metrics.intervalSeconds)}
              onReload={onReload}
            />
          )}

          {/* Telegram Send Test button – only shown for the telegram card */}
          {connection.name === 'telegram' && (
            <TelegramTestButton />
          )}
        </div>
      )}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────

export interface ConnectionPageHandle {
  refresh: () => void;
}

export const ConnectionPage = forwardRef<ConnectionPageHandle, object>(function ConnectionPage(_props, ref) {
  const { toast } = useNotification();

  // ── State ──────────────────────────────────────────────────

  const [overall, setOverall] = useState<'connected' | 'degraded'>('degraded');
  const [connections, setConnections] = useState<ConnectionCheck[]>([]);
  const [timestamp, setTimestamp] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setRefreshing] = useState(false);

  // ── Data Fetching ────────────────────────────────────────

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

  return (
    <div className="space-y-8">
      {/* ── Loading state ───────────────────────────────────── */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-brand-teal" />
          <span className="ml-3 text-sm text-zinc-500">Checking connections…</span>
        </div>
      )}

      {/* ── Error state ─────────────────────────────────────── */}
      {!loading && error && (
        <div className="rounded-2xl bg-red-50 p-6 text-center shadow-brand">
          <p className="text-sm font-medium text-red-700">{error}</p>
          <button
            onClick={() => loadStatus()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-medium text-red-600 ring-1 ring-red-200 transition-colors hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Status content ──────────────────────────────────── */}
      {!loading && !error && (
        <div className="space-y-6">
          {/* Overall status banner */}
          <OverallBanner overall={overall} />

          {/* Connection cards */}
          <div className="space-y-3">
            {connections.map((connection, index) => (
              <ConnectionCard
                key={connection.name}
                connection={connection}
                defaultExpanded={connection.status !== 'connected' || index === 0}
                onReload={() => loadStatus(true)}
              />
            ))}
          </div>

          {/* Timestamp */}
          {timestamp && (
            <p className="text-center text-xs text-zinc-400">
              Last updated: {new Date(timestamp).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
});
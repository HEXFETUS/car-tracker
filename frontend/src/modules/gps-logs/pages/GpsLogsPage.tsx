import { useState, useEffect, useCallback } from 'react';
import { Loader2, Navigation, AlertTriangle, Calendar, X, Car, History, Pencil } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { useAuth } from '@/modules/auth/context/auth-context';
import { cn } from '@/shared/lib/utils';
import {
  fetchGpsLogs,
  fetchTrackedVehicles,
  fetchGpsAlerts,
  fetchTelemetry,
  fetchTravelReports,
  syncTrackingHistory,
  type GpsLogsResult,
  type SyncHistoryResult,
  type VehicleOption,
  type EnrichedGpsTripLog,
  type GpsAlertRow,
  type TelemetryRow,
  type TravelReportRow,
} from '../api/gps-logs-api';
import { EditGpsLogModal } from '../components/EditGpsLogModal';

// ── Types ──────────────────────────────────────────────────────

type TabKey = 'logs' | 'reports' | 'alerts' | 'telemetry';

// ── Formatting Helpers ─────────────────────────────────────────

function formatDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  // Parse YYYY-MM-DD as local time to avoid timezone shift
  const [year, month, day] = iso.split('-').map(Number);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return '—';
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAlertDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatNumber(val: number | null | undefined, decimals = 2): string {
  if (val == null) return '—';
  return Number(val).toFixed(decimals);
}

const STATUS_COLORS: Record<string, string> = {
  departed: 'bg-amber-50 text-amber-700 border-amber-200',
  'en-route': 'bg-blue-50 text-blue-700 border-blue-200',
  arrived: 'bg-green-50 text-green-700 border-green-200',
  cancelled: 'bg-zinc-50 text-zinc-500 border-zinc-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const ALERT_TYPE_COLORS: Record<string, string> = {
  IGNITION_ON: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  IGNITION_OFF: 'bg-slate-50 text-slate-700 border-slate-200',
  IDLING: 'bg-amber-50 text-amber-700 border-amber-200',
  NO_APPROVED_TRAVEL_ORDER: 'bg-red-50 text-red-700 border-red-200',
};

// ── Page Component ─────────────────────────────────────────────

export function GpsLogsPage() {
  const { toast } = useNotification();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>('logs');

  // Logs state
  const [result, setResult] = useState<GpsLogsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncHistoryResult, setSyncHistoryResult] = useState<SyncHistoryResult | null>(null);
  const [page, setPage] = useState(1);
  const [dateFilter, setDateFilter] = useState('');
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [editLog, setEditLog] = useState<EnrichedGpsTripLog | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);

  // Reports state
  const [reportsResult, setReportsResult] = useState<TravelReportRow[] | null>(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [reportsTotal, setReportsTotal] = useState(0);
  const [reportsPage, setReportsPage] = useState(1);
  const [reportsVehicleFilter, setReportsVehicleFilter] = useState('');
  const [reportsDateFilter, setReportsDateFilter] = useState('');
  const reportsPageSize = 20;

  // Telemetry state
  const [telemetryResult, setTelemetryResult] = useState<TelemetryRow[] | null>(null);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [telemetryTotal, setTelemetryTotal] = useState(0);
  const [telemetryPage, setTelemetryPage] = useState(1);
  const [telemetryVehicleFilter, setTelemetryVehicleFilter] = useState('');
  const [telemetryEventFilter, setTelemetryEventFilter] = useState('');
  const [telemetryDateFrom, setTelemetryDateFrom] = useState('');
  const [telemetryDateTo, setTelemetryDateTo] = useState('');
  const telemetryPageSize = 20;

  // Alerts state
  const [alertsResult, setAlertsResult] = useState<GpsAlertRow[] | null>(null);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [alertsTotal, setAlertsTotal] = useState(0);
  const [alertsPage, setAlertsPage] = useState(1);
  const [alertVehicleFilter, setAlertVehicleFilter] = useState('');
  const [alertTypeFilter, setAlertTypeFilter] = useState('');
  const [alertDate, setAlertDate] = useState('');
  const pageSize = 25;
  const alertsPageSize = 25;

  // ── Load tracked vehicles on mount ──────────────────────────
  useEffect(() => {
    let cancelled = false;
    setVehiclesLoading(true);
    fetchTrackedVehicles()
      .then((list) => {
        if (!cancelled) setVehicles(list);
      })
      .catch(() => {
        if (!cancelled) toast('Failed to load vehicles', 'error');
      })
      .finally(() => {
        if (!cancelled) setVehiclesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  // ── Load Logs ────────────────────────────────────────────────
  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchGpsLogs({
        page,
        pageSize,
        tripDate: dateFilter || undefined,
        vehicleId: vehicleFilter || undefined,
      });
      setResult(data);
    } catch {
      setError('Failed to load GPS logs. Please try again.');
      toast('Failed to load GPS logs', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, dateFilter, vehicleFilter, toast]);

  useEffect(() => {
    if (activeTab === 'logs') loadLogs();
  }, [activeTab, loadLogs]);

  // ── Load Alerts ──────────────────────────────────────────────
  const loadAlerts = useCallback(async () => {
    try {
      setAlertsLoading(true);
      setAlertsError(null);
      const data = await fetchGpsAlerts({
        page: alertsPage,
        pageSize: alertsPageSize,
        vehicleId: alertVehicleFilter || undefined,
        alertType: alertTypeFilter || undefined,
        alertDate: alertDate || undefined,
      });
      setAlertsResult(data.data);
      setAlertsTotal(data.total);
    } catch {
      setAlertsError('Failed to load GPS alerts. Please try again.');
      toast('Failed to load GPS alerts', 'error');
    } finally {
      setAlertsLoading(false);
    }
  }, [alertsPage, alertsPageSize, alertVehicleFilter, alertTypeFilter, alertDate, toast]);

  useEffect(() => {
    if (activeTab === 'alerts') loadAlerts();
  }, [activeTab, loadAlerts]);

  // ── Handlers ────────────────────────────────────────────────
  const handleSyncHistory = async () => {
    if (!vehicleFilter) {
      toast('Please select a vehicle first', 'info');
      return;
    }
    if (!dateFilter) {
      toast('Please select a date first', 'info');
      return;
    }

    try {
      setSyncing(true);
      setSyncHistoryResult(null);
      const res = await syncTrackingHistory({ fromDate: dateFilter, toDate: dateFilter });
      setSyncHistoryResult({
        success: res.success,
        synced: true,
        elapsed_seconds: res.elapsed_seconds,
        gps_logs_saved: res.data.totalTripsCreated,
        gps_logs_failed: res.data.totalTripsFailed,
        message: res.message,
        timestamp: new Date().toISOString(),
        travel_order_status: res.data.results.find((r) => r.status === 'completed') ? 'COMPLETED' : undefined,
      } as any);

      const perVehicleResults = res.data.results
        .map((r) => {
          if (r.status === 'completed') return `${r.vehiclePlate}: ${r.tripsCreated} created, ${r.tripsFailed} failed`;
          if (r.status === 'no_travel_order') return `${r.vehiclePlate || 'some vehicle'}: no travel order`;
          if (r.status === 'cartrack_unavailable') return `${r.vehiclePlate || 'some vehicle'}: Cartrack unavailable`;
          return `${r.vehiclePlate || 'some vehicle'}: no GPS data`;
        })
        .join(' | ');

      toast(
        `History sync completed — ${res.data.totalTripsCreated} trips created, ${res.data.totalTripsFailed} failed across ${res.data.totalVehiclesProcessed} vehicles`,
        'success',
      );

      // Log per-vehicle results for debugging
      console.log('[SyncHistory] Per-vehicle results:', perVehicleResults);

      await loadLogs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'History sync failed';
      toast(msg, 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleDateChange = (value: string) => {
    setDateFilter(value);
    setPage(1);
  };

  const clearDateFilter = () => {
    setDateFilter('');
    setPage(1);
  };

  const handleVehicleChange = (value: string) => {
    setVehicleFilter(value);
    setPage(1);
  };

  const clearVehicleFilter = () => {
    setVehicleFilter('');
    setPage(1);
  };

  const handleAlertVehicleChange = (value: string) => {
    setAlertVehicleFilter(value);
    setAlertsPage(1);
  };

  const clearAlertVehicleFilter = () => {
    setAlertVehicleFilter('');
    setAlertsPage(1);
  };

  const handleAlertTypeChange = (value: string) => {
    setAlertTypeFilter(value);
    setAlertsPage(1);
  };

  const clearAlertTypeFilter = () => {
    setAlertTypeFilter('');
    setAlertsPage(1);
  };

  const handleAlertDateChange = (value: string) => {
    setAlertDate(value);
    setAlertsPage(1);
  };

  const clearAlertDate = () => {
    setAlertDate('');
    setAlertsPage(1);
  };

  const today = new Date().toISOString().split('T')[0];

  // ── Load Reports ──────────────────────────────────────────────
  const loadReports = useCallback(async () => {
    try {
      setReportsLoading(true);
      setReportsError(null);
      const data = await fetchTravelReports({
        vehicleId: reportsVehicleFilter || undefined,
        tripDate: reportsDateFilter || undefined,
        page: reportsPage,
        pageSize: reportsPageSize,
      });
      setReportsResult(data.data);
      setReportsTotal(data.total);
    } catch {
      setReportsError('Failed to load travel reports. Please try again.');
      toast('Failed to load travel reports', 'error');
    } finally {
      setReportsLoading(false);
    }
  }, [reportsPage, reportsPageSize, reportsVehicleFilter, reportsDateFilter, toast]);

  useEffect(() => {
    if (activeTab === 'reports') loadReports();
  }, [activeTab, loadReports]);

  function handleEdit(log: EnrichedGpsTripLog) {
    setEditLog(log);
    setEditModalOpen(true);
  }

  function handleEditSuccess() {
    setEditModalOpen(false);
    setEditLog(null);
    loadLogs();
  }

  // ── Render Helpers ──────────────────────────────────────────

  const renderLogsContent = () => (
    <div className="space-y-4">
      {/* Toolbar: Filters + Button */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end sm:justify-end gap-3">
        <div className="flex flex-col gap-1.5 w-full sm:w-auto">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Vehicle</label>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <Car className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-teal pointer-events-none" />
              <select
                value={vehicleFilter}
                onChange={(e) => handleVehicleChange(e.target.value)}
                className="w-full rounded-lg border-0 bg-white pl-10 pr-8 py-3 sm:py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm appearance-none cursor-pointer"
              >
                <option value="">All Vehicles</option>
                {vehiclesLoading && <option value="" disabled>Loading…</option>}
                {!vehiclesLoading && vehicles.map((v) => (
                  <option key={v.id} value={v.id}>{v.plateNumber}</option>
                ))}
              </select>
            </div>
            {vehicleFilter && (
              <button onClick={clearVehicleFilter} className="rounded-lg bg-zinc-100 p-2 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 shrink-0" title="Clear vehicle filter">
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 w-full sm:w-auto">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Trip Date</label>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-teal pointer-events-none" />
              <input
                type="date"
                value={dateFilter}
                max={today}
                onChange={(e) => handleDateChange(e.target.value)}
                className="w-full rounded-lg border-0 bg-white pl-10 pr-3 py-3 sm:py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm"
              />
            </div>
            {dateFilter && (
              <button onClick={clearDateFilter} className="rounded-lg bg-zinc-100 p-2 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 shrink-0" title="Clear date filter">
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>

        <button
          onClick={handleSyncHistory}
          disabled={syncing || !vehicleFilter || !dateFilter}
          className={cn(
            'inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 sm:py-2.5 text-sm font-medium text-white shadow-sm transition-all active:scale-[0.97] w-full sm:w-auto',
            syncing || !vehicleFilter || !dateFilter ? 'bg-brand-teal/50 cursor-not-allowed' : 'bg-brand-teal hover:bg-brand-teal/80',
          )}
        >
          {syncing ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Syncing History…
            </>
          ) : (
            <>
              <History className="size-4" />
              Sync Tracking History
            </>
          )}
        </button>
      </div>

      {syncHistoryResult && (
        <div className={cn('rounded-lg border px-4 py-3 text-sm', syncHistoryResult.synced ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800')}>
          <span className="font-medium">Last sync:</span>{' '}
          {syncHistoryResult.message ?? 'Completed'}
          {syncHistoryResult.gps_logs_saved != null && <> — {syncHistoryResult.gps_logs_saved} logs saved</>}
          {syncHistoryResult.gps_logs_failed ? `, ${syncHistoryResult.gps_logs_failed} failed` : ''}
          {syncHistoryResult.elapsed_seconds ? ` (${syncHistoryResult.elapsed_seconds}s)` : ''}
          {syncHistoryResult.travel_order_status && (
            <span className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-brand-teal/10 text-brand-teal">
              {syncHistoryResult.travel_order_status}
            </span>
          )}
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
          <Loader2 className="size-8 text-brand-teal animate-spin mb-3" />
          <p className="text-base font-medium text-zinc-600">Loading GPS logs...</p>
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
          <AlertTriangle className="size-10 text-red-400 mb-3" />
          <p className="text-base font-medium text-red-600">{error}</p>
          <button onClick={loadLogs} className="mt-4 rounded-lg bg-brand-teal px-5 py-2 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors">Retry</button>
        </div>
      )}

      {!loading && !error && result && result.data.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
          <Navigation className="size-10 text-zinc-300 mb-3" />
          <p className="text-base font-medium text-zinc-600">No GPS logs found</p>
          <p className="mt-1 text-sm text-zinc-400">
            {dateFilter || vehicleFilter ? 'No logs for the selected filters. Try a different date or vehicle.' : 'Select a vehicle and date, then click "Sync Tracking History".'}
          </p>
        </div>
      )}

      {!loading && !error && result && result.data.length > 0 && (
        <>
          <div className="hidden md:block rounded-xl bg-white shadow-brand overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-zinc-100 bg-brand-cream/50">
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Departure Time</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Vehicle Plate No.</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Driver Name</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Origin (GPS Start)</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Destination (GPS End)</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Route / Road Taken</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Distance (km)</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Engine Hours</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Moving Hrs</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Max Speed</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Trip Status</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Linked TO No.</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">TO Status</th>
                    <th className="px-4 py-3.5 text-center text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Anomaly</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Notes</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((log, idx) => {
                    const hasAnomaly = log.anomalyFlag && !log.toNumber;
                    return (
                      <tr key={log.id} className={cn('border-b border-zinc-50 transition-colors hover:bg-brand-cream/30', idx % 2 === 0 ? 'bg-white' : 'bg-zinc-50/30', hasAnomaly && 'bg-red-50/40 hover:bg-red-50/60')}>
                        <td className="px-4 py-3 text-zinc-600 text-xs">{formatDateTime(log.departureTimeGps)}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 font-mono">{log.vehiclePlateNo}</span>
                        </td>
                        <td className="px-4 py-3 text-zinc-700">{log.driverName}</td>
                        <td className="px-4 py-3 text-zinc-600 max-w-40 truncate" title={log.toOrigin || log.originGpsStartPoint}>{log.toOrigin || log.originGpsStartPoint}</td>
                        <td className="px-4 py-3 text-zinc-600 max-w-40 truncate" title={log.toDestination || log.destinationGpsEndPoint}>{log.toDestination || log.destinationGpsEndPoint}</td>
                        <td className="px-4 py-3 text-zinc-600 max-w-45 truncate" title={log.locationName || undefined}>
                          {log.destinationVerified
                            ? <span className="text-brand-teal font-medium">{log.locationName || log.destinationGpsEndPoint}</span>
                            : <span className="text-zinc-500">{log.locationName || log.destinationGpsEndPoint}</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-700 tabular-nums">{formatNumber(log.gpsDistanceKm, 1)}</td>
                        <td className="px-4 py-3 text-right text-zinc-700 tabular-nums">{formatNumber(log.engineHours, 1)}</td>
                        <td className="px-4 py-3 text-right text-zinc-700 tabular-nums">{formatNumber(log.movingHours, 1)}</td>
                        <td className="px-4 py-3 text-right text-zinc-700 tabular-nums">{formatNumber(log.maxSpeedKph, 0)}</td>
                        <td className="px-4 py-3">
                          <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize', STATUS_COLORS[log.tripStatusGps] ?? 'bg-zinc-50 text-zinc-600')}>
                            {log.tripStatusGps.replace('-', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {log.toNumber ? <span className="font-mono text-xs text-brand-teal font-medium">{log.toNumber}</span> : <span className="text-zinc-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {log.toStatusAuto ? <span className="text-xs text-zinc-500">{log.toStatusAuto}</span> : <span className="text-zinc-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {hasAnomaly ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700">⚠ TO NOT APPROVED</span>
                          ) : (
                            <span className="text-zinc-300 text-xs">No</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-zinc-500 max-w-45 truncate text-xs" title={log.notesRemarks ?? ''}>{log.notesRemarks || <span className="text-zinc-300">—</span>}</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => handleEdit(log)} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-brand-teal hover:bg-brand-teal/5 transition-colors">
                            <Pencil className="size-3.5" /> Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-zinc-100 px-5 py-3">
              <p className="text-xs text-zinc-400">
                Showing {Math.min((page - 1) * pageSize + 1, result.total)}–{Math.min(page * pageSize, result.total)} of {result.total}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none">Previous</button>
                <span className="text-xs text-zinc-400">Page {page} of {Math.ceil(result.total / pageSize)}</span>
                <button onClick={() => setPage((p) => Math.min(Math.ceil(result.total / pageSize), p + 1))} disabled={page >= Math.ceil(result.total / pageSize)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none">Next</button>
              </div>
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {result.data.map((log) => {
              const hasAnomaly = log.anomalyFlag && !log.toNumber;
              return (
                <div key={log.id} className={cn('rounded-xl bg-white shadow-brand overflow-hidden', hasAnomaly && 'ring-1 ring-red-200')}>
                  <div className="flex items-center justify-between bg-brand-cream/60 px-4 py-3">
                    <div className="min-w-0 flex-1">
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize', STATUS_COLORS[log.tripStatusGps] ?? 'bg-zinc-50 text-zinc-600')}>
                        {log.tripStatusGps.replace('-', ' ')}
                      </span>
                      <button onClick={() => handleEdit(log)} className="inline-flex items-center justify-center rounded-lg p-2 text-brand-teal hover:bg-brand-teal/5 min-h-11 min-w-11">
                        <Pencil className="size-4" />
                      </button>
                    </div>
                  </div>
                  <div className="px-4 py-3 space-y-2.5">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 font-mono">{log.vehiclePlateNo}</span>
                      <span className="text-sm text-zinc-700 truncate">{log.driverName}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Origin</p>
                        <p className="text-xs text-zinc-700 truncate" title={log.toOrigin || log.originGpsStartPoint}>{log.toOrigin || log.originGpsStartPoint}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Destination</p>
                        <p className="text-xs text-zinc-700 truncate" title={log.toDestination || log.destinationGpsEndPoint}>{log.toDestination || log.destinationGpsEndPoint}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Route / Road Taken</p>
                        <p className={`text-xs truncate ${log.destinationVerified ? 'text-brand-teal font-medium' : 'text-zinc-700'}`} title={log.locationName || undefined}>
                          {log.locationName || log.destinationGpsEndPoint}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Departure</p>
                        <p className="text-xs text-zinc-700">{formatDateTime(log.departureTimeGps)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Arrival</p>
                        <p className="text-xs text-zinc-700">{formatDateTime(log.arrivalTimeGps)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Distance</p>
                        <p className="text-xs font-mono font-medium text-zinc-900">{formatNumber(log.gpsDistanceKm, 1)} km</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Engine</p>
                        <p className="text-xs font-mono text-zinc-700">{formatNumber(log.engineHours, 1)} hrs</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Moving</p>
                        <p className="text-xs font-mono text-zinc-700">{formatNumber(log.movingHours, 1)} hrs</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Max Speed</p>
                        <p className="text-xs font-mono text-zinc-700">{formatNumber(log.maxSpeedKph, 0)} kph</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">TO No.</p>
                        {log.toNumber ? <span className="font-mono text-xs text-brand-teal font-medium">{log.toNumber}</span> : <span className="text-xs text-zinc-300">—</span>}
                      </div>
                    </div>
                    {hasAnomaly && (
                      <div className="flex items-center gap-1 rounded-md bg-orange-50 px-3 py-1.5">
                        <span className="text-xs font-semibold text-orange-700">⚠ TO NOT APPROVED</span>
                      </div>
                    )}
                    {log.notesRemarks && (
                      <p className="text-xs text-zinc-500 bg-zinc-50 rounded-lg px-3 py-2 leading-relaxed">{log.notesRemarks}</p>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-brand">
              <p className="text-xs text-zinc-400">
                {Math.min((page - 1) * pageSize + 1, result.total)}–{Math.min(page * pageSize, result.total)} of {result.total}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none min-h-11">Previous</button>
                <span className="text-xs text-zinc-400">{page}/{Math.ceil(result.total / pageSize)}</span>
                <button onClick={() => setPage((p) => Math.min(Math.ceil(result.total / pageSize), p + 1))} disabled={page >= Math.ceil(result.total / pageSize)} className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none min-h-11">Next</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );

  const renderAlertsContent = () => (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
        <div className="flex flex-col gap-1.5 w-full sm:w-auto">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Vehicle</label>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <Car className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-teal pointer-events-none" />
              <select
                value={alertVehicleFilter}
                onChange={(e) => handleAlertVehicleChange(e.target.value)}
                className="w-full rounded-lg border-0 bg-white pl-10 pr-8 py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm appearance-none cursor-pointer"
              >
                <option value="">All Vehicles</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>{v.plateNumber}</option>
                ))}
              </select>
            </div>
            {alertVehicleFilter && (
              <button onClick={clearAlertVehicleFilter} className="rounded-lg bg-zinc-100 p-2 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 shrink-0" title="Clear vehicle filter">
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 w-full sm:w-auto">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Alert Type</label>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <AlertTriangle className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-teal pointer-events-none" />
              <select
                value={alertTypeFilter}
                onChange={(e) => handleAlertTypeChange(e.target.value)}
                className="w-full rounded-lg border-0 bg-white pl-10 pr-8 py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm appearance-none cursor-pointer"
              >
                <option value="">All Types</option>
                <option value="IGNITION_ON">Ignition On</option>
                <option value="IGNITION_OFF">Ignition Off</option>
                <option value="SPEEDING">Speeding</option>
                <option value="LOW_FUEL">Low Fuel</option>
                <option value="IDLING">Idling</option>
                <option value="MOTION">Motion Started</option>
                <option value="LOCATION_UPDATE">Location Update</option>
                <option value="TRIP_STATE">Trip State</option>
                <option value="NO_APPROVED_TRAVEL_ORDER">No Approved Travel Order</option>
              </select>
            </div>
            {alertTypeFilter && (
              <button onClick={clearAlertTypeFilter} className="rounded-lg bg-zinc-100 p-2 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 shrink-0" title="Clear alert type filter">
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 w-full sm:w-auto">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Alert Date</label>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-teal pointer-events-none" />
              <input
                type="date"
                value={alertDate}
                max={today}
                onChange={(e) => handleAlertDateChange(e.target.value)}
                className="w-full rounded-lg border-0 bg-white pl-10 pr-3 py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm"
              />
            </div>
            {alertDate && (
              <button onClick={clearAlertDate} className="rounded-lg bg-zinc-100 p-2 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 shrink-0" title="Clear alert date filter">
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {alertsLoading && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-12 text-center shadow-brand">
          <Loader2 className="size-8 text-brand-teal animate-spin mb-3" />
          <p className="text-base font-medium text-zinc-600">Loading alerts...</p>
        </div>
      )}

      {!alertsLoading && alertsError && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-12 text-center shadow-brand">
          <AlertTriangle className="size-10 text-red-400 mb-3" />
          <p className="text-base font-medium text-red-600">{alertsError}</p>
          <button onClick={loadAlerts} className="mt-4 rounded-lg bg-brand-teal px-5 py-2 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors">Retry</button>
        </div>
      )}

      {!alertsLoading && !alertsError && alertsResult && alertsResult.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-12 text-center shadow-brand">
          <AlertTriangle className="size-10 text-zinc-300 mb-3" />
          <p className="text-base font-medium text-zinc-600">No alerts found</p>
          <p className="mt-1 text-sm text-zinc-400">
            {alertVehicleFilter || alertTypeFilter ? 'No alerts match the selected filters.' : 'Alerts will appear here when generated from fleet telemetry.'}
          </p>
        </div>
      )}

      {!alertsLoading && !alertsError && alertsResult && alertsResult.length > 0 && (
        <>
          <div className="hidden md:block rounded-xl bg-white shadow-brand overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-zinc-100 bg-brand-cream/50">
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Date/Time</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Vehicle</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Alert Type</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Alert Message</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Latitude</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Longitude</th>
                  </tr>
                </thead>
                <tbody>
                  {alertsResult.map((alert, idx) => {
                    const plate = alert.vehiclePlate ?? 'Unknown';
                    return (
                      <tr key={alert.id} className={cn('border-b border-zinc-50 transition-colors hover:bg-brand-cream/30', idx % 2 === 0 ? 'bg-white' : 'bg-zinc-50/30')}>
                        <td className="px-4 py-3 text-zinc-600 text-xs">{formatAlertDateTime(alert.created_at)}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 font-mono">{plate}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium', ALERT_TYPE_COLORS[alert.alert_type] || 'bg-zinc-50 text-zinc-600')}>
                            {alert.alert_type.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-zinc-700 max-w-60 truncate" title={alert.alert_message}>{alert.alert_message}</td>
                        <td className="px-4 py-3 text-zinc-600 text-xs font-mono">{alert.latitude != null ? Number(alert.latitude).toFixed(5) : '—'}</td>
                        <td className="px-4 py-3 text-zinc-600 text-xs font-mono">{alert.longitude != null ? Number(alert.longitude).toFixed(5) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-zinc-100 px-5 py-3">
              <p className="text-xs text-zinc-400">
                Showing {Math.min((alertsPage - 1) * alertsPageSize + 1, alertsTotal)}–{Math.min(alertsPage * alertsPageSize, alertsTotal)} of {alertsTotal}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setAlertsPage((p) => Math.max(1, p - 1))} disabled={alertsPage <= 1} className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none">Previous</button>
                <span className="text-xs text-zinc-400">Page {alertsPage} of {Math.ceil(alertsTotal / alertsPageSize)}</span>
                <button onClick={() => setAlertsPage((p) => Math.min(Math.ceil(alertsTotal / alertsPageSize), p + 1))} disabled={alertsPage >= Math.ceil(alertsTotal / alertsPageSize)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none">Next</button>
              </div>
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {alertsResult.map((alert) => {
              const plate = alert.vehiclePlate ?? 'Unknown';
              return (
                <div key={alert.id} className="rounded-xl bg-white shadow-brand overflow-hidden">
                  <div className="flex items-center justify-between bg-brand-cream/60 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-mono font-bold text-brand-teal truncate">{plate}</p>
                      <p className="text-[10px] text-zinc-400 mt-0.5">{formatAlertDateTime(alert.created_at)}</p>
                    </div>
                    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium', ALERT_TYPE_COLORS[alert.alert_type] || 'bg-zinc-50 text-zinc-600')}>
                      {alert.alert_type.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="px-4 py-3 space-y-2">
                    <p className="text-xs text-zinc-700 leading-relaxed">{alert.alert_message}</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Latitude</p>
                        <p className="text-xs font-mono text-zinc-700">{alert.latitude != null ? Number(alert.latitude).toFixed(5) : '—'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Longitude</p>
                        <p className="text-xs font-mono text-zinc-700">{alert.longitude != null ? Number(alert.longitude).toFixed(5) : '—'}</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-brand">
              <p className="text-xs text-zinc-400">
                {Math.min((alertsPage - 1) * alertsPageSize + 1, alertsTotal)}–{Math.min(alertsPage * alertsPageSize, alertsTotal)} of {alertsTotal}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setAlertsPage((p) => Math.max(1, p - 1))} disabled={alertsPage <= 1} className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none min-h-11">Previous</button>
                <span className="text-xs text-zinc-400">{alertsPage}/{Math.ceil(alertsTotal / alertsPageSize)}</span>
                <button onClick={() => setAlertsPage((p) => Math.min(Math.ceil(alertsTotal / alertsPageSize), p + 1))} disabled={alertsPage >= Math.ceil(alertsTotal / alertsPageSize)} className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none min-h-11">Next</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );

  // ── Load Telemetry ──────────────────────────────────────────
  const loadTelemetry = useCallback(async () => {
    try {
      setTelemetryLoading(true);
      setTelemetryError(null);
      const data = await fetchTelemetry({
        page: telemetryPage,
        pageSize: telemetryPageSize,
        vehicleId: telemetryVehicleFilter || undefined,
        plateNumber: undefined,
        eventType: telemetryEventFilter || undefined,
        dateFrom: telemetryDateFrom || undefined,
        dateTo: telemetryDateTo || undefined,
      });
      setTelemetryResult(data.data);
      setTelemetryTotal(data.total);
    } catch {
      setTelemetryError('Failed to load telemetry data. Please try again.');
      toast('Failed to load telemetry', 'error');
    } finally {
      setTelemetryLoading(false);
    }
  }, [telemetryPage, telemetryPageSize, telemetryVehicleFilter, telemetryEventFilter, telemetryDateFrom, telemetryDateTo, toast]);

  useEffect(() => {
    if (activeTab === 'telemetry') {
      setTelemetryEventFilter('');
      setTelemetryVehicleFilter('');
      setTelemetryDateFrom('');
      setTelemetryDateTo('');
      setTelemetryPage(1);
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'telemetry') loadTelemetry();
  }, [activeTab, loadTelemetry]);

  const renderReportsContent = () => (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
        <div className="flex flex-col gap-1.5 w-full sm:w-auto">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Vehicle</label>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <Car className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-teal pointer-events-none" />
              <select
                value={reportsVehicleFilter}
                onChange={(e) => { setReportsVehicleFilter(e.target.value); setReportsPage(1); }}
                className="w-full rounded-lg border-0 bg-white pl-10 pr-8 py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm appearance-none cursor-pointer"
              >
                <option value="">All Vehicles</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>{v.plateNumber}</option>
                ))}
              </select>
            </div>
            {reportsVehicleFilter && (
              <button onClick={() => { setReportsVehicleFilter(''); setReportsPage(1); }} className="rounded-lg bg-zinc-100 p-2 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 shrink-0" title="Clear vehicle filter">
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 w-full sm:w-auto">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Date</label>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-teal pointer-events-none" />
              <input
                type="date"
                value={reportsDateFilter}
                max={today}
                onChange={(e) => { setReportsDateFilter(e.target.value); setReportsPage(1); }}
                className="w-full rounded-lg border-0 bg-white pl-10 pr-3 py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm"
              />
            </div>
            {reportsDateFilter && (
              <button onClick={() => { setReportsDateFilter(''); setReportsPage(1); }} className="rounded-lg bg-zinc-100 p-2 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 shrink-0" title="Clear date filter">
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {reportsLoading && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-12 text-center shadow-brand">
          <Loader2 className="size-8 text-brand-teal animate-spin mb-3" />
          <p className="text-base font-medium text-zinc-600">Loading travel orders...</p>
        </div>
      )}

      {!reportsLoading && reportsError && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-12 text-center shadow-brand">
          <AlertTriangle className="size-10 text-red-400 mb-3" />
          <p className="text-base font-medium text-red-600">{reportsError}</p>
          <button onClick={loadReports} className="mt-4 rounded-lg bg-brand-teal px-5 py-2 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors">Retry</button>
        </div>
      )}

      {!reportsLoading && !reportsError && reportsResult && reportsResult.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-12 text-center shadow-brand">
          <Navigation className="size-10 text-zinc-300 mb-3" />
          <p className="text-base font-medium text-zinc-600">No travel orders found</p>
          <p className="mt-1 text-sm text-zinc-400">Create a travel order and sync GPS data to see it here.</p>
          <button onClick={loadReports} className="mt-4 rounded-lg bg-brand-teal px-5 py-2 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors">Refresh</button>
        </div>
      )}

      {!reportsLoading && !reportsError && reportsResult && reportsResult.length > 0 && (
        <>
          <div className="hidden md:block rounded-xl bg-white shadow-brand overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-zinc-100 bg-brand-cream/50">
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Date</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">TO No.</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Trip</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Driver</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Vehicle</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">From</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">To</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Departure</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Arrival</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Moving</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Idling</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {reportsResult.map((row, idx) => (
                    <tr key={row.id} className={cn('border-b border-zinc-50 transition-colors hover:bg-brand-cream/30', idx % 2 === 0 ? 'bg-white' : 'bg-zinc-50/30')}>
                      <td className="px-4 py-3 text-zinc-700 text-xs">{formatDate(row.tripDate)}</td>
                      <td className="px-4 py-3 text-zinc-600 text-xs font-mono">{row.toNumber}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium bg-brand-teal/10 text-brand-teal border-brand-teal/20">
                          {row.legDescription}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-700">{row.driverName}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 font-mono">{row.vehiclePlate}</span>
                      </td>
                      <td className="px-4 py-3 text-zinc-600 max-w-60 truncate" title={row.from}>{row.from}</td>
                      <td className="px-4 py-3 text-zinc-600 max-w-60 truncate" title={row.to}>{row.to}</td>
                      <td className="px-4 py-3 text-zinc-500 text-xs">
                        {row.legDescription === 'Return' ? (row.departureTime || '—') : '—'}
                      </td>
                      <td className="px-4 py-3 text-zinc-500 text-xs">
                        {row.legDescription === 'Outbound' ? (row.arrivalTime || '—') : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-700 tabular-nums">{Number(row.movingHours) > 0 ? `${Number(row.movingHours).toFixed(1)} hrs` : ''}</td>
                      <td className="px-4 py-3 text-right text-zinc-700 tabular-nums">{Number(row.idlingHours) > 0 ? `${Number(row.idlingHours).toFixed(1)} hrs` : ''}</td>
                      <td className="px-4 py-3 text-right text-zinc-700 tabular-nums font-medium">{Number(row.totalHours) > 0 ? `${Number(row.totalHours).toFixed(1)} hrs` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-zinc-100 px-5 py-3">
              <p className="text-xs text-zinc-400">
                Showing {Math.min((reportsPage - 1) * reportsPageSize + 1, reportsTotal)}–{Math.min(reportsPage * reportsPageSize, reportsTotal)} of {reportsTotal}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setReportsPage((p) => Math.max(1, p - 1))} disabled={reportsPage <= 1} className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none">Previous</button>
                <span className="text-xs text-zinc-400">Page {reportsPage} of {Math.ceil(reportsTotal / reportsPageSize)}</span>
                <button onClick={() => setReportsPage((p) => Math.min(Math.ceil(reportsTotal / reportsPageSize), p + 1))} disabled={reportsPage >= Math.ceil(reportsTotal / reportsPageSize)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none">Next</button>
              </div>
            </div>
          </div>

                  <div className="space-y-3 md:hidden">
                    {reportsResult.map((row) => (
                      <div key={row.id} className="rounded-xl bg-white shadow-brand overflow-hidden">
                        <div className="flex items-center justify-between bg-brand-cream/60 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-mono font-bold text-brand-teal truncate">{row.toNumber}</p>
                            <p className="text-[10px] text-zinc-400 mt-0.5">{formatDate(row.tripDate)}</p>
                          </div>
                </div>
                <div className="px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 font-mono">{row.vehiclePlate}</span>
                    <span className="text-sm text-zinc-700 truncate">{row.driverName}</span>
                  </div>
                  <div>
                    <p className="text-xs text-brand-teal font-medium truncate" title={row.legDescription}>{row.legDescription}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">From</p>
                    <p className="text-xs text-zinc-700 truncate" title={row.from}>{row.from}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">To</p>
                    <p className="text-xs text-zinc-700 truncate" title={row.to}>{row.to}</p>
                  </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Departure</p>
                        <p className="text-xs text-zinc-700">
                          {row.legDescription === 'Return' ? (row.departureTime || '—') : '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Arrival</p>
                        <p className="text-xs text-zinc-700">
                          {row.legDescription === 'Outbound' ? (row.arrivalTime || '—') : '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Moving Hrs</p>
                        <p className="text-xs font-mono text-zinc-700">{Number(row.movingHours) > 0 ? `${Number(row.movingHours).toFixed(1)} hrs` : ''}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Idling Hrs</p>
                        <p className="text-xs font-mono text-zinc-700">{Number(row.idlingHours) > 0 ? `${Number(row.idlingHours).toFixed(1)} hrs` : ''}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Total Hrs</p>
                        <p className="text-xs font-mono text-zinc-700 font-medium">{Number(row.totalHours) > 0 ? `${Number(row.totalHours).toFixed(1)} hrs` : ''}</p>
                      </div>
                    </div>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-brand">
              <p className="text-xs text-zinc-400">
                {Math.min((reportsPage - 1) * reportsPageSize + 1, reportsTotal)}–{Math.min(reportsPage * reportsPageSize, reportsTotal)} of {reportsTotal}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setReportsPage((p) => Math.max(1, p - 1))} disabled={reportsPage <= 1} className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none min-h-11">Previous</button>
                <span className="text-xs text-zinc-400">{reportsPage}/{Math.ceil(reportsTotal / reportsPageSize)}</span>
                <button onClick={() => setReportsPage((p) => Math.min(Math.ceil(reportsTotal / reportsPageSize), p + 1))} disabled={reportsPage >= Math.ceil(reportsTotal / reportsPageSize)} className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none min-h-11">Next</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );

  const renderTelemetryContent = () => (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
        <div className="flex flex-col gap-1.5 w-full sm:w-auto">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Vehicle</label>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <Car className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-teal pointer-events-none" />
              <select
                value={telemetryVehicleFilter}
                onChange={(e) => { setTelemetryVehicleFilter(e.target.value); setTelemetryPage(1); }}
                className="w-full rounded-lg border-0 bg-white pl-10 pr-8 py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm appearance-none cursor-pointer"
              >
                <option value="">All Vehicles</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>{v.plateNumber}</option>
                ))}
              </select>
            </div>
            {telemetryVehicleFilter && (
              <button onClick={() => { setTelemetryVehicleFilter(''); setTelemetryPage(1); }} className="rounded-lg bg-zinc-100 p-2 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 shrink-0" title="Clear vehicle filter">
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 w-full sm:w-auto">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Event Type</label>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <AlertTriangle className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-teal pointer-events-none" />
              <select
                value={telemetryEventFilter}
                onChange={(e) => { setTelemetryEventFilter(e.target.value); setTelemetryPage(1); }}
                className="w-full rounded-lg border-0 bg-white pl-10 pr-8 py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm appearance-none cursor-pointer"
              >
                <option value="">All Events</option>
                <option value="LOCATION_UPDATE">Location Update</option>
                <option value="IDLING">Idling</option>
                <option value="IGNITION_OFF">Ignition Off</option>
              </select>
            </div>
            {telemetryEventFilter && (
              <button onClick={() => { setTelemetryEventFilter(''); setTelemetryPage(1); }} className="rounded-lg bg-zinc-100 p-2 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 shrink-0" title="Clear event filter">
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 w-full sm:w-auto">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Date From</label>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-teal pointer-events-none" />
              <input
                type="date"
                value={telemetryDateFrom}
                max={today}
                onChange={(e) => { setTelemetryDateFrom(e.target.value); setTelemetryPage(1); }}
                className="w-full rounded-lg border-0 bg-white pl-10 pr-3 py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm"
              />
            </div>
            {telemetryDateFrom && (
              <button onClick={() => { setTelemetryDateFrom(''); setTelemetryPage(1); }} className="rounded-lg bg-zinc-100 p-2 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 shrink-0" title="Clear date from">
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 w-full sm:w-auto">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Date To</label>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-teal pointer-events-none" />
              <input
                type="date"
                value={telemetryDateTo}
                max={today}
                onChange={(e) => { setTelemetryDateTo(e.target.value); setTelemetryPage(1); }}
                className="w-full rounded-lg border-0 bg-white pl-10 pr-3 py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm"
              />
            </div>
            {telemetryDateTo && (
              <button onClick={() => { setTelemetryDateTo(''); setTelemetryPage(1); }} className="rounded-lg bg-zinc-100 p-2 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 shrink-0" title="Clear date to">
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {telemetryLoading && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-12 text-center shadow-brand">
          <Loader2 className="size-8 text-brand-teal animate-spin mb-3" />
          <p className="text-base font-medium text-zinc-600">Loading telemetry...</p>
        </div>
      )}

      {!telemetryLoading && telemetryError && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-12 text-center shadow-brand">
          <AlertTriangle className="size-10 text-red-400 mb-3" />
          <p className="text-base font-medium text-red-600">{telemetryError}</p>
          <button onClick={loadTelemetry} className="mt-4 rounded-lg bg-brand-teal px-5 py-2 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors">Retry</button>
        </div>
      )}

      {!telemetryLoading && !telemetryError && telemetryResult && telemetryResult.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-12 text-center shadow-brand">
          <Navigation className="size-10 text-zinc-300 mb-3" />
          <p className="text-base font-medium text-zinc-600">No telemetry data</p>
          <p className="mt-1 text-sm text-zinc-400">Telemetry records will appear here as the scheduler runs (every 120s).</p>
          <button onClick={loadTelemetry} className="mt-4 rounded-lg bg-brand-teal px-5 py-2 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors">Refresh</button>
        </div>
      )}

      {!telemetryLoading && !telemetryError && telemetryResult && telemetryResult.length > 0 && (
        <>
          <div className="hidden md:block rounded-xl bg-white shadow-brand overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-zinc-100 bg-brand-cream/50">
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Time</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Vehicle</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Event</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Location</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Speed</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Fuel</th>
                    <th className="px-4 py-3.5 text-center text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Ignition</th>
                  </tr>
                </thead>
                <tbody>
                  {telemetryResult.map((row, idx) => (
                    <tr key={row.id} className={cn('border-b border-zinc-50 transition-colors hover:bg-brand-cream/30', idx % 2 === 0 ? 'bg-white' : 'bg-zinc-50/30')}>
                      <td className="px-4 py-3 text-zinc-600 text-xs">{formatDateTime(row.recordedAt)}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 font-mono">{row.plateNumber}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium', row.eventType === 'LOCATION_UPDATE' ? 'bg-blue-50 text-blue-700 border-blue-200' : row.eventType === 'IDLING' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-700 border-slate-200')}>
                          {row.eventType.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-600 max-w-60 truncate" title={row.locationName ?? ''}>{row.locationName || '—'}</td>
                      <td className="px-4 py-3 text-right text-zinc-700 tabular-nums">{formatNumber(row.speedKmh, 0)} km/h</td>
                      <td className="px-4 py-3 text-right text-zinc-700 tabular-nums">{row.fuelLiters != null ? `${formatNumber(row.fuelLiters, 1)} L` : '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium', row.ignition ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-700 border-slate-200')}>
                          {row.ignition ? 'ON' : 'OFF'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-zinc-100 px-5 py-3">
              <p className="text-xs text-zinc-400">
                Showing {Math.min((telemetryPage - 1) * telemetryPageSize + 1, telemetryTotal)}–{Math.min(telemetryPage * telemetryPageSize, telemetryTotal)} of {telemetryTotal}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setTelemetryPage((p) => Math.max(1, p - 1))} disabled={telemetryPage <= 1} className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none">Previous</button>
                <span className="text-xs text-zinc-400">Page {telemetryPage} of {Math.ceil(telemetryTotal / telemetryPageSize)}</span>
                <button onClick={() => setTelemetryPage((p) => Math.min(Math.ceil(telemetryTotal / telemetryPageSize), p + 1))} disabled={telemetryPage >= Math.ceil(telemetryTotal / telemetryPageSize)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none">Next</button>
              </div>
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {telemetryResult.map((row) => (
              <div key={row.id} className="rounded-xl bg-white shadow-brand overflow-hidden">
                <div className="flex items-center justify-between bg-brand-cream/60 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-mono font-bold text-brand-teal truncate">{row.plateNumber}</p>
                    <p className="text-[10px] text-zinc-400 mt-0.5">{formatDateTime(row.recordedAt)}</p>
                  </div>
                  <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium', row.eventType === 'LOCATION_UPDATE' ? 'bg-blue-50 text-blue-700 border-blue-200' : row.eventType === 'IDLING' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-700 border-slate-200')}>
                    {row.eventType.replace('_', ' ')}
                  </span>
                </div>
                <div className="px-4 py-3 space-y-2">
                  <p className="text-xs text-zinc-700 truncate" title={row.locationName ?? ''}>{row.locationName || 'Location unavailable'}</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Speed</p>
                      <p className="text-xs font-mono text-zinc-700">{formatNumber(row.speedKmh, 0)} km/h</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Fuel</p>
                      <p className="text-xs font-mono text-zinc-700">{row.fuelLiters != null ? `${formatNumber(row.fuelLiters, 1)} L` : '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Ignition</p>
                      <p className="text-xs font-mono text-zinc-700">{row.ignition ? 'ON' : 'OFF'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">TO No.</p>
                      <p className="text-xs font-mono text-zinc-700">{row.toNumber || '—'}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-brand">
              <p className="text-xs text-zinc-400">
                {Math.min((telemetryPage - 1) * telemetryPageSize + 1, telemetryTotal)}–{Math.min(telemetryPage * telemetryPageSize, telemetryTotal)} of {telemetryTotal}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setTelemetryPage((p) => Math.max(1, p - 1))} disabled={telemetryPage <= 1} className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none min-h-11">Previous</button>
                <span className="text-xs text-zinc-400">{telemetryPage}/{Math.ceil(telemetryTotal / telemetryPageSize)}</span>
                <button onClick={() => setTelemetryPage((p) => Math.min(Math.ceil(telemetryTotal / telemetryPageSize), p + 1))} disabled={telemetryPage >= Math.ceil(telemetryTotal / telemetryPageSize)} className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none min-h-11">Next</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );

  // ── Main Render ─────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <EditGpsLogModal
        isOpen={editModalOpen}
        onClose={() => {
          setEditModalOpen(false);
          setEditLog(null);
        }}
        onSuccess={handleEditSuccess}
        log={editLog}
        isSuperadmin={user?.userType === 'SUPERADMIN'}
      />

      <div className="flex items-center gap-1 border-b border-zinc-200">
        <button
          onClick={() => setActiveTab('logs')}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
            activeTab === 'logs' ? 'border-brand-teal text-brand-teal' : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-200',
          )}
        >
          <History className="size-4" /> Logs
        </button>
        <button
          onClick={() => setActiveTab('reports')}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
            activeTab === 'reports' ? 'border-brand-teal text-brand-teal' : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-200',
          )}
        >
          <Navigation className="size-4" /> Reports
        </button>
        <button
          onClick={() => setActiveTab('alerts')}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
            activeTab === 'alerts' ? 'border-brand-teal text-brand-teal' : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-200',
          )}
        >
          <AlertTriangle className="size-4" /> Alerts
        </button>
        <button
          onClick={() => setActiveTab('telemetry')}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
            activeTab === 'telemetry' ? 'border-brand-teal text-brand-teal' : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-200',
          )}
        >
          <Navigation className="size-4" /> Telemetry
        </button>
      </div>

      {activeTab === 'logs' && renderLogsContent()}
      {activeTab === 'reports' && renderReportsContent()}
      {activeTab === 'alerts' && renderAlertsContent()}
      {activeTab === 'telemetry' && (
        <div className="space-y-4">
          <div className="rounded-xl bg-white px-6 py-8 text-center shadow-brand">
            <p className="text-base font-medium text-zinc-600">Telemetry tab loaded</p>
            <p className="mt-2 text-sm text-zinc-400">If you see this, the tab renders. Check console for errors.</p>
          </div>
          {renderTelemetryContent()}
        </div>
      )}
    </div>
  );
}
import { useState, useEffect, useCallback } from 'react';
import { Loader2, Navigation, AlertTriangle, Calendar, X, Car, History, Pencil } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { useAuth } from '@/modules/auth/context/auth-context';
import { cn } from '@/shared/lib/utils';
import {
  fetchGpsLogs,
  fetchTrackedVehicles,
  fetchGpsAlerts,
  syncTrackingHistory,
  type GpsLogsResult,
  type SyncHistoryResult,
  type VehicleOption,
  type EnrichedGpsTripLog,
  type GpsAlertRow,
} from '../api/gps-logs-api';
import { EditGpsLogModal } from '../components/EditGpsLogModal';

// ── Types ──────────────────────────────────────────────────────

type TabKey = 'logs' | 'alerts';

// ── Formatting Helpers ─────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
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

  // Alerts state
  const [alertsResult, setAlertsResult] = useState<GpsAlertRow[] | null>(null);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [alertsTotal, setAlertsTotal] = useState(0);
  const [alertsPage, setAlertsPage] = useState(1);
  const [alertVehicleFilter, setAlertVehicleFilter] = useState('');
  const [alertTypeFilter, setAlertTypeFilter] = useState('');
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
      });
      setAlertsResult(data.data);
      setAlertsTotal(data.total);
    } catch {
      setAlertsError('Failed to load GPS alerts. Please try again.');
      toast('Failed to load GPS alerts', 'error');
    } finally {
      setAlertsLoading(false);
    }
  }, [alertsPage, alertsPageSize, alertVehicleFilter, alertTypeFilter, toast]);

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

      toast(
        `History sync completed — ${res.data.totalTripsCreated} trips created, ${res.data.totalTripsFailed} failed across ${res.data.totalVehiclesProcessed} vehicles`,
        'success',
      );

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

  const today = new Date().toISOString().split('T')[0];

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
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">GPS Record No.</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Trip Date</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Vehicle Plate No.</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Driver Name</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Origin (GPS Start)</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Destination (GPS End)</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Location</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Route / Road Taken</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Departure Time</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Arrival Time</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Distance (km)</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Engine Hours</th>
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
                        <td className="px-4 py-3 font-mono text-xs font-medium text-zinc-900">{log.gpsRecordNo}</td>
                        <td className="px-4 py-3 text-zinc-700">{formatDate(log.tripDate)}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 font-mono">{log.vehiclePlateNo}</span>
                        </td>
                        <td className="px-4 py-3 text-zinc-700">{log.driverName}</td>
                        <td className="px-4 py-3 text-zinc-600 max-w-[160px] truncate" title={log.originGpsStartPoint}>{log.originGpsStartPoint}</td>
                        <td className="px-4 py-3 text-zinc-600 max-w-[160px] truncate" title={log.destinationGpsEndPoint}>{log.destinationGpsEndPoint}</td>
                        <td className="px-4 py-3 text-zinc-600 max-w-[180px] truncate" title={log.locationName || undefined}>
                          {log.destinationVerified
                            ? <span className="text-brand-teal font-medium">{log.locationName || log.destinationGpsEndPoint}</span>
                            : <span className="text-zinc-500">{log.locationName || log.destinationGpsEndPoint}</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-zinc-600 max-w-[180px] truncate" title={log.actualRouteRoadTaken}>{log.actualRouteRoadTaken}</td>
                        <td className="px-4 py-3 text-zinc-600 text-xs">{formatDateTime(log.departureTimeGps)}</td>
                        <td className="px-4 py-3 text-zinc-600 text-xs">{formatDateTime(log.arrivalTimeGps)}</td>
                        <td className="px-4 py-3 text-right text-zinc-700 tabular-nums">{formatNumber(log.gpsDistanceKm, 1)}</td>
                        <td className="px-4 py-3 text-right text-zinc-700 tabular-nums">{formatNumber(log.engineHours, 1)}</td>
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
                        <td className="px-4 py-3 text-zinc-500 max-w-[180px] truncate text-xs" title={log.notesRemarks ?? ''}>{log.notesRemarks || <span className="text-zinc-300">—</span>}</td>
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
                      <p className="text-xs font-mono font-bold text-brand-teal truncate">{log.gpsRecordNo}</p>
                      <p className="text-xs text-zinc-400 mt-0.5">{formatDate(log.tripDate)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize', STATUS_COLORS[log.tripStatusGps] ?? 'bg-zinc-50 text-zinc-600')}>
                        {log.tripStatusGps.replace('-', ' ')}
                      </span>
                      <button onClick={() => handleEdit(log)} className="inline-flex items-center justify-center rounded-lg p-2 text-brand-teal hover:bg-brand-teal/5 min-h-[44px] min-w-[44px]">
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
                        <p className="text-xs text-zinc-700 truncate" title={log.originGpsStartPoint}>{log.originGpsStartPoint}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Destination</p>
                        <p className="text-xs text-zinc-700 truncate" title={log.destinationGpsEndPoint}>{log.destinationGpsEndPoint}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Location</p>
                        <p className={`text-xs truncate ${log.destinationVerified ? 'text-brand-teal font-medium' : 'text-zinc-700'}`} title={log.locationName || undefined}>
                          {log.locationName || log.destinationGpsEndPoint}
                        </p>
                      </div>
                      {log.actualRouteRoadTaken && (
                        <div className="col-span-2">
                          <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Route</p>
                          <p className="text-xs text-zinc-600 truncate">{log.actualRouteRoadTaken}</p>
                        </div>
                      )}
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
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none min-h-[44px]">Previous</button>
                <span className="text-xs text-zinc-400">{page}/{Math.ceil(result.total / pageSize)}</span>
                <button onClick={() => setPage((p) => Math.min(Math.ceil(result.total / pageSize), p + 1))} disabled={page >= Math.ceil(result.total / pageSize)} className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none min-h-[44px]">Next</button>
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
                <option value="IDLING">Idling</option>
              </select>
            </div>
            {alertTypeFilter && (
              <button onClick={clearAlertTypeFilter} className="rounded-lg bg-zinc-100 p-2 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 shrink-0" title="Clear alert type filter">
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
                        <td className="px-4 py-3 text-zinc-700 max-w-[240px] truncate" title={alert.alert_message}>{alert.alert_message}</td>
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
                <button onClick={() => setAlertsPage((p) => Math.max(1, p - 1))} disabled={alertsPage <= 1} className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none min-h-[44px]">Previous</button>
                <span className="text-xs text-zinc-400">{alertsPage}/{Math.ceil(alertsTotal / alertsPageSize)}</span>
                <button onClick={() => setAlertsPage((p) => Math.min(Math.ceil(alertsTotal / alertsPageSize), p + 1))} disabled={alertsPage >= Math.ceil(alertsTotal / alertsPageSize)} className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none min-h-[44px]">Next</button>
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
          onClick={() => setActiveTab('alerts')}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
            activeTab === 'alerts' ? 'border-brand-teal text-brand-teal' : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-200',
          )}
        >
          <AlertTriangle className="size-4" /> Alerts
        </button>
      </div>

      {activeTab === 'logs' && renderLogsContent()}
      {activeTab === 'alerts' && renderAlertsContent()}
    </div>
  );
}
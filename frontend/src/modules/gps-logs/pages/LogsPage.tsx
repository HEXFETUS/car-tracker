// ── GPS Logs Page ──────────────────────────────────────────────
//
// Dedicated page for GPS Logs functionality.

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Navigation, AlertTriangle, Eye, History, Calendar, X, Car } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { cn } from '@/shared/lib/utils';
import {
  fetchGpsLogs,
  fetchTrackedVehicles,
  syncTrackingHistory,
  type GpsLogsResult,
  type SyncHistoryResult,
  type VehicleOption,
  type EnrichedGpsTripLog,
} from '../api/gps-logs-api';
import { TripDetailsModal } from '../components/TripDetailsModal';

// ── Formatting Helpers ─────────────────────────────────────────

function formatDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  // Handle full ISO timestamp (e.g. "2026-06-30T00:00:00.000Z") or date-only (e.g. "2026-06-30")
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_COLORS: Record<string, string> = {
  not_synced: 'bg-zinc-50 text-zinc-500 border-zinc-200',
  pending: 'bg-zinc-50 text-zinc-500 border-zinc-200',
  tracking_started: 'bg-blue-50 text-blue-700 border-blue-200',
  ongoing: 'bg-amber-50 text-amber-700 border-amber-200',
  departed: 'bg-amber-50 text-amber-700 border-amber-200',
  'en-route': 'bg-blue-50 text-blue-700 border-blue-200',
  arrived: 'bg-green-50 text-green-700 border-green-200',
  cancelled: 'bg-zinc-50 text-zinc-500 border-zinc-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const pageSize = 25;

export function LogsPage() {
  const { toast } = useNotification();

  // State
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
  const [tripDetailLogId, setTripDetailLogId] = useState<string | null>(null);
  const [tripDetailOpen, setTripDetailOpen] = useState(false);

  // Load tracked vehicles
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
    return () => { cancelled = true; };
  }, [toast]);

  // Load GPS logs
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
    loadLogs();
  }, [loadLogs]);

  // Debug: log first row when data loads
  useEffect(() => {
    if (result && result.data.length > 0) {
      console.log('[LogsPage] First row data:', result.data[0]);
    }
  }, [result]);

  // Handlers
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

  const today = new Date().toISOString().split('T')[0];

  function handleViewDetails(log: EnrichedGpsTripLog) {
    setTripDetailLogId(log.id);
    setTripDetailOpen(true);
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <TripDetailsModal
        isOpen={tripDetailOpen}
        onClose={() => {
          setTripDetailOpen(false);
          setTripDetailLogId(null);
        }}
        logId={tripDetailLogId}
      />

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
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Date</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">TO Status</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Linked TO Number</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Vehicle</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Driver</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Trip Status</th>
                    <th className="px-4 py-3.5 text-center text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Anomaly</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((log, idx) => {
                    const hasAnomaly = log.anomalyFlag && !log.toNumber;
                    const isCompleted = log.tripStatusGps === 'completed' || log.tripStatusGps === 'arrived' || (log.departureTimeGps && log.arrivalTimeGps);
                    const isOngoing = log.tripStatusGps === 'en-route' || log.tripStatusGps === 'departed' || log.tripStatusGps === 'ongoing' || log.tripStatusGps === 'tracking_started';
                    const tripStatus = isCompleted
                      ? 'Completed'
                      : isOngoing
                        ? 'Ongoing'
                        : log.tripStatusGps === 'cancelled'
                          ? 'Cancelled'
                          : log.tripStatusGps === 'pending'
                            ? 'Not Synced'
                            : 'No GPS';
                    return (
                      <tr key={log.id} className={cn('border-b border-zinc-50 transition-colors hover:bg-brand-cream/30', idx % 2 === 0 ? 'bg-white' : 'bg-zinc-50/30', hasAnomaly && 'bg-red-50/40 hover:bg-red-50/60')}>
                        <td className="px-4 py-3 text-zinc-600 text-xs">{formatDate(log.toDate || log.tripDate || log.createdAt || log.departureTimeGps)}</td>
                        <td className="px-4 py-3">
                          {log.toStatusAuto ? <span className="text-xs text-zinc-500">{log.toStatusAuto}</span> : <span className="text-zinc-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {log.toNumber ? <span className="font-mono text-xs text-brand-teal font-medium">{log.toNumber}</span> : <span className="text-zinc-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 font-mono">{log.vehiclePlateNo}</span>
                        </td>
                        <td className="px-4 py-3 text-zinc-700 max-w-32 truncate" title={log.driverName}>{log.driverName}</td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize',
                            STATUS_COLORS[log.tripStatusGps] ?? 'bg-zinc-50 text-zinc-600',
                          )}>
                            {tripStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {hasAnomaly ? (
                            <span className="inline-flex items-center rounded-md bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700">⚠ ANOMALY</span>
                          ) : (
                            <span className="text-zinc-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleViewDetails(log)}
                              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-brand-teal hover:bg-brand-teal/5 transition-colors"
                              title="View Details"
                            >
                              <Eye className="size-3.5" />
                              <span className="hidden sm:inline">View Details</span>
                            </button>
                          </div>
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
              const isCompleted = log.tripStatusGps === 'completed' || log.tripStatusGps === 'arrived' || (log.departureTimeGps && log.arrivalTimeGps);
              const isOngoing = log.tripStatusGps === 'en-route' || log.tripStatusGps === 'departed' || log.tripStatusGps === 'ongoing' || log.tripStatusGps === 'tracking_started';
              const tripStatus = isCompleted
                ? 'Completed'
                : isOngoing
                  ? 'Ongoing'
                  : log.tripStatusGps === 'cancelled'
                    ? 'Cancelled'
                    : log.tripStatusGps === 'pending'
                      ? 'Not Synced'
                      : 'No GPS';
              return (
                <div key={log.id} className={cn('rounded-xl bg-white shadow-brand overflow-hidden', hasAnomaly && 'ring-1 ring-red-200')}>
                  <div className="flex items-center justify-between bg-brand-cream/60 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-zinc-500">{formatDate(log.toDate || log.tripDate || log.createdAt || log.departureTimeGps)}</p>
                      {log.toNumber && (
                        <p className="text-xs font-mono text-brand-teal font-medium mt-0.5">{log.toNumber}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize',
                        STATUS_COLORS[log.tripStatusGps] ?? 'bg-zinc-50 text-zinc-600',
                      )}>
                        {tripStatus}
                      </span>
                    </div>
                  </div>
                  <div className="px-4 py-3 space-y-2.5">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 font-mono">{log.vehiclePlateNo}</span>
                      <span className="text-sm text-zinc-700 truncate">{log.driverName}</span>
                    </div>
                    {hasAnomaly && (
                      <div className="flex items-center gap-1 rounded-md bg-orange-50 px-3 py-1.5">
                        <span className="text-xs font-semibold text-orange-700">⚠ ANOMALY</span>
                      </div>
                    )}
                    {log.notesRemarks && (
                      <p className="text-xs text-zinc-500 bg-zinc-50 rounded-lg px-3 py-2 leading-relaxed">{log.notesRemarks}</p>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => handleViewDetails(log)}
                        className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-xs font-medium text-brand-teal hover:bg-brand-teal/5 transition-colors min-h-10"
                      >
                        <Eye className="size-3.5" /> View Details
                      </button>
                    </div>
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
}
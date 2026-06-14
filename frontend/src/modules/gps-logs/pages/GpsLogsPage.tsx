import { useState, useEffect, useCallback } from 'react';
import { Loader2, Navigation, AlertTriangle, RefreshCw, Calendar, X } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { cn } from '@/shared/lib/utils';
import { fetchGpsLogs, syncGpsLogs } from '../api/gps-logs-api';
import type { GpsLogsResult, SyncResult } from '../api/gps-logs-api';

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

export function GpsLogsPage() {
  const { toast } = useNotification();
  const [result, setResult] = useState<GpsLogsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [page, setPage] = useState(1);
  const [dateFilter, setDateFilter] = useState('');
  const pageSize = 25;

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchGpsLogs({ page, pageSize, tripDate: dateFilter || undefined });
      setResult(data);
    } catch {
      setError('Failed to load GPS logs. Please try again.');
      toast('Failed to load GPS logs', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, dateFilter, toast]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const handleSync = async () => {
    try {
      setSyncing(true);
      setSyncResult(null);
      const res = await syncGpsLogs();
      setSyncResult(res);
      toast(
        `Sync complete — ${res.gps_logs_saved ?? 0} GPS logs saved`,
        'success',
      );
      // Reload logs after sync
      await loadLogs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
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

  const totalPages = result ? Math.ceil(result.total / pageSize) : 1;

  return (
    <div className="space-y-8">
      {/* Action Bar: Date Filter + Sync */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {/* Date Filter */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400 pointer-events-none" />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => handleDateChange(e.target.value)}
              className="rounded-lg border-0 bg-white pl-10 pr-3 py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow shadow-sm"
            />
          </div>
          {dateFilter && (
            <button
              onClick={clearDateFilter}
              className="rounded-lg bg-zinc-100 p-2 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700"
              title="Clear date filter"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* Sync Button */}
        <button
          onClick={handleSync}
          disabled={syncing}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all active:scale-[0.97]',
            syncing
              ? 'bg-brand-teal/60 cursor-not-allowed'
              : 'bg-brand-teal hover:bg-brand-teal/80',
          )}
        >
          {syncing ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Syncing…
            </>
          ) : (
            <>
              <RefreshCw className="size-4" />
              Sync GPS Logs
            </>
          )}
        </button>
      </div>

      {/* Sync Result Summary */}
      {syncResult && syncResult.success !== undefined && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
          <span className="font-medium">Last sync:</span>{' '}
          {syncResult.gps_logs_saved ?? 0} logs saved
          {syncResult.gps_logs_failed ? `, ${syncResult.gps_logs_failed} failed` : ''}
          {syncResult.elapsed_seconds ? ` (${syncResult.elapsed_seconds}s)` : ''}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
          <Loader2 className="size-8 text-brand-teal animate-spin mb-3" />
          <p className="text-base font-medium text-zinc-600">Loading GPS logs...</p>
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
          <AlertTriangle className="size-10 text-red-400 mb-3" />
          <p className="text-base font-medium text-red-600">{error}</p>
          <button
            onClick={loadLogs}
            className="mt-4 rounded-lg bg-brand-teal px-5 py-2 text-sm font-medium text-white hover:bg-brand-teal/80"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && result && result.logs.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
          <Navigation className="size-10 text-zinc-300 mb-3" />
          <p className="text-base font-medium text-zinc-600">No GPS logs found</p>
          <p className="mt-1 text-sm text-zinc-400">
            {dateFilter
              ? `No logs for ${dateFilter}. Try a different date or sync new data.`
              : 'Click "Sync GPS Logs" to fetch the latest tracking data.'}
          </p>
        </div>
      )}

      {/* Data Table */}
      {!loading && !error && result && result.logs.length > 0 && (
        <div className="rounded-xl bg-white shadow-brand overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-zinc-100 bg-brand-cream/50">
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    GPS Record No.
                  </th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Trip Date
                  </th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Vehicle Plate No.
                  </th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Driver Name
                  </th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Origin (GPS Start Point)
                  </th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Destination (GPS End Point)
                  </th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Actual Route / Road Taken
                  </th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Departure Time (GPS)
                  </th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Arrival Time (GPS)
                  </th>
                  <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    GPS Distance (km)
                  </th>
                  <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Engine Hours
                  </th>
                  <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Max Speed (kph)
                  </th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Trip Status (GPS)
                  </th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Linked TO No.
                  </th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    TO Status (auto)
                  </th>
                  <th className="px-4 py-3.5 text-center text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Anomaly Flag
                  </th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Notes / Remarks
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.logs.map((log, idx) => (
                  <tr
                    key={log.id}
                    className={cn(
                      'border-b border-zinc-50 transition-colors hover:bg-brand-cream/30',
                      idx % 2 === 0 ? 'bg-white' : 'bg-zinc-50/30',
                      log.anomalyFlag && 'bg-red-50/40 hover:bg-red-50/60'
                    )}
                  >
                    <td className="px-4 py-3 font-mono text-xs font-medium text-zinc-900">
                      {log.gpsRecordNo}
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      {formatDate(log.tripDate)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 font-mono">
                        {log.vehiclePlateNo}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      {log.driverName}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 max-w-[160px] truncate" title={log.originGpsStartPoint}>
                      {log.originGpsStartPoint}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 max-w-[160px] truncate" title={log.destinationGpsEndPoint}>
                      {log.destinationGpsEndPoint}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 max-w-[180px] truncate" title={log.actualRouteRoadTaken}>
                      {log.actualRouteRoadTaken}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 text-xs">
                      {formatDateTime(log.departureTimeGps)}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 text-xs">
                      {formatDateTime(log.arrivalTimeGps)}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-700 tabular-nums">
                      {formatNumber(log.gpsDistanceKm, 1)}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-700 tabular-nums">
                      {formatNumber(log.engineHours, 1)}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-700 tabular-nums">
                      {formatNumber(log.maxSpeedKph, 0)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize',
                          STATUS_COLORS[log.tripStatusGps] ?? 'bg-zinc-50 text-zinc-600'
                        )}
                      >
                        {log.tripStatusGps.replace('-', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {log.toNumber ? (
                        <span className="font-mono text-xs text-brand-teal font-medium">
                          {log.toNumber}
                        </span>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {log.toStatusAuto ? (
                        <span className="text-xs text-zinc-500">{log.toStatusAuto}</span>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {log.anomalyFlag ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                          <AlertTriangle className="size-3" />
                          Yes
                        </span>
                      ) : (
                        <span className="text-zinc-300 text-xs">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 max-w-[180px] truncate text-xs" title={log.notesRemarks ?? ''}>
                      {log.notesRemarks || <span className="text-zinc-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination footer */}
          <div className="flex items-center justify-between border-t border-zinc-100 px-5 py-3">
            <p className="text-xs text-zinc-400">
              Showing {Math.min((page - 1) * pageSize + 1, result.total)}–{Math.min(page * pageSize, result.total)} of{' '}
              {result.total}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none"
              >
                Previous
              </button>
              <span className="text-xs text-zinc-400">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
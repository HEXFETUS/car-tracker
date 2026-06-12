import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, Navigation, AlertTriangle } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { cn } from '@/shared/lib/utils';
import { AddGpsLogModal } from '../components/AddGpsLogModal';
import { fetchGpsLogs } from '../api/gps-logs-api';
import type { GpsLogsResult } from '../api/gps-logs-api';

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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchGpsLogs({ page, pageSize });
      setResult(data);
    } catch {
      setError('Failed to load GPS logs. Please try again.');
      toast('Failed to load GPS logs', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, toast]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const totalPages = result ? Math.ceil(result.total / pageSize) : 1;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
            GPS Logs
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {result ? `${result.total} GPS log${result.total !== 1 ? 's' : ''} recorded.` : 'Loading...'}
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-teal/80 active:scale-[0.97]"
        >
          <Plus className="size-4" />
          Import / Add GPS Log
        </button>
      </div>

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
            Click "Import / Add GPS Log" to record your first trip.
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

      {/* Add GPS Log Modal */}
      <AddGpsLogModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => {
          setIsModalOpen(false);
          loadLogs();
        }}
      />
    </div>
  );
}
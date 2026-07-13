// ── GPS Logs Page ──────────────────────────────────────────────
//
// Dedicated page for GPS Logs functionality.

import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Navigation, AlertTriangle, Eye, History, Calendar, X, Car, RefreshCw } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { apiFetch } from '@/shared/api-client';
import { cn } from '@/shared/lib/utils';
import { formatDateManila } from '@/shared/lib/date-utils';
import {
  tableContainerClass,
  tableClass,
  tableHeaderClass,
  tableHeaderCellClass,
  tableRowClass,
  tableCellClass,
} from '@/shared/styles/table-constants';
import { Pagination } from '@/shared/components/Pagination';
import {
  fetchGpsLogs,
  fetchTrackedVehicles,
  type GpsLogsResult,
  type SyncHistoryResult,
  type VehicleOption,
  type EnrichedGpsTripLog,
} from '../api/gps-logs-api';
import { TripDetailsModal } from '../components/TripDetailsModal';
import { GpsLogsToolbar, type TabKey } from '../components/GpsLogsToolbar';

// ── Helpers ────────────────────────────────────────────────────

function getMissionDisplay(log: EnrichedGpsTripLog): string {
  const tripType = String(log.tripType ?? '').toUpperCase() === 'RETURN' ? 'RETURN' : 'OUTBOUND';
  if (tripType === 'RETURN') {
    return log.parentGpsRecordNo ? `${log.parentGpsRecordNo} (Outbound)` : 'Standalone';
  }
  if (log.pairedReturnGpsRecordNo) {
    return `${log.pairedReturnGpsRecordNo} (Return)`;
  }
  return 'Standalone';
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

function getTOStatusBadgeClass(status: string | null | undefined): string {
  const colorMap: Record<string, string> = {
    APPROVED: 'bg-green-50 text-green-700 border-green-200',
    PENDING: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    'FOR REQUEST': 'bg-blue-50 text-blue-700 border-blue-200',
    REJECTED: 'bg-red-50 text-red-700 border-red-200',
    CANCELLED: 'bg-gray-50 text-gray-500 border-gray-200',
    COMPLETED: 'bg-green-50 text-green-700 border-green-200',
  };
  return colorMap[status ?? ''] ?? 'bg-gray-50 text-gray-500 border-gray-200';
}

const pageSize = 25;

interface LogsPageProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  vehicleFilter: string;
  onVehicleFilterChange: (v: string) => void;
  dateFilter: string;
  onDateFilterChange: (d: string) => void;
}

export function LogsPage({ activeTab, onTabChange, vehicleFilter, onVehicleFilterChange, dateFilter, onDateFilterChange }: LogsPageProps) {
  const { toast } = useNotification();

  const syncTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [result, setResult] = useState<GpsLogsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncHistoryResult, setSyncHistoryResult] = useState<SyncHistoryResult | null>(null);
  const [page, setPage] = useState(1);
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [tripDetailLogId, setTripDetailLogId] = useState<string | null>(null);
  const [tripDetailOpen, setTripDetailOpen] = useState(false);

  const handleOpenTripDetails = (id: string) => {
    setTripDetailLogId(id);
    setTripDetailOpen(true);
  };

  // Load tracked vehicles
  useEffect(() => {
    let cancelled = false;
    setVehiclesLoading(true);
    fetchTrackedVehicles()
      .then((list) => { if (!cancelled) setVehicles(list); })
      .catch(() => { if (!cancelled) toast('Failed to load vehicles', 'error'); })
      .finally(() => { if (!cancelled) setVehiclesLoading(false); });
    return () => { cancelled = true; };
  }, [toast]);

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchGpsLogs({
        page, pageSize,
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

  useEffect(() => { loadLogs(); }, [loadLogs]);

  // Clear sync banner timer on unmount
  useEffect(() => {
    return () => clearTimeout(syncTimerRef.current);
  }, []);

  const handleSyncFromTelemetry = async () => {
    if (!dateFilter) { toast('Please select a date first', 'info'); return; }
    try {
      setSyncing(true);
      clearTimeout(syncTimerRef.current);
      setSyncHistoryResult(null);
      const res = await apiFetch('/api/gps-logs/sync-from-telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Sync from telemetry failed');
      const data = await res.json();
      setSyncHistoryResult({
        success: data.success, synced: true,
        gps_logs_saved: data.created + data.updated,
        gps_logs_failed: data.failed,
        message: `Synced GPS trip logs from telemetry. ${data.created} created, ${data.updated} updated, ${data.skipped} skipped, ${data.failed} failed.`,
        timestamp: new Date().toISOString(),
      } as any);
      // Show toast notification (auto-dismisses via NotificationContext)
      toast(data.created + data.updated > 0
        ? `Sync complete — ${data.created} created, ${data.updated} updated`
        : 'No telemetry records found to sync.',
        data.created + data.updated > 0 ? 'success' : 'info');
      // Auto-dismiss sync banner after 5 seconds
      syncTimerRef.current = setTimeout(() => {
        setSyncHistoryResult(null);
      }, 5000);
      await loadLogs();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Sync from telemetry failed', 'error');
    } finally { setSyncing(false); }
  };

  const handleRefresh = () => { loadLogs(); };

  const today = new Date().toISOString().split('T')[0];
  const displayLogs = result?.data ?? [];

  function handleViewDetails(log: EnrichedGpsTripLog) {
    setTripDetailLogId(log.id);
    setTripDetailOpen(true);
  }

  // ── Filters ──
  const filters = (
    <>
      <div className="relative w-full sm:w-auto">
        <Car className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-brand-teal pointer-events-none" />
        <select
          value={vehicleFilter}
          onChange={(e) => { onVehicleFilterChange(e.target.value); setPage(1); }}
          className="h-11 w-full rounded-lg border-0 bg-white py-2 pl-8 pr-7 text-sm font-medium text-zinc-700 shadow-sm ring-1 ring-brand-sage transition-shadow hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 sm:h-auto sm:w-[170px]"
        >
          <option value="">All Vehicles</option>
          {vehiclesLoading && <option disabled>Loading…</option>}
          {!vehiclesLoading && vehicles.map((v) => (
            <option key={v.id} value={v.id}>{v.plateNumber}</option>
          ))}
        </select>
        {vehicleFilter && (
          <button onClick={() => { onVehicleFilterChange(''); setPage(1); }} className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600" title="Clear">
            <X className="size-3" />
          </button>
        )}
      </div>
      <div className="relative w-full sm:w-auto">
        <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-brand-teal pointer-events-none" />
        <input
          type="date"
          value={dateFilter}
          max={today}
          onChange={(e) => { onDateFilterChange(e.target.value); setPage(1); }}
          className="gps-log-date-filter h-11 w-full rounded-lg border-0 bg-white py-2 pl-8 pr-7 text-sm font-medium text-zinc-700 shadow-sm ring-1 ring-brand-sage transition-shadow hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 sm:h-auto sm:w-[168px]"
        />
        {dateFilter && (
          <button onClick={() => { onDateFilterChange(''); setPage(1); }} className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600" title="Clear">
            <X className="size-3" />
          </button>
        )}
      </div>
    </>
  );

  // ── Actions (filters + refresh/sync, right-aligned) ──
  const actions = (
    <>
      {filters}
      <button
        onClick={handleRefresh}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-lg border border-brand-teal/30 px-3 py-2 text-sm font-medium text-brand-teal hover:bg-brand-teal/5 transition-colors h-10"
        title="Refresh data"
      >
        <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
        <span className="hidden sm:inline">Refresh</span>
      </button>
      <button
        onClick={handleSyncFromTelemetry}
        disabled={syncing || !dateFilter}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-all active:scale-[0.97] h-10',
          syncing || !dateFilter ? 'bg-brand-teal/50 cursor-not-allowed' : 'bg-brand-teal hover:bg-brand-teal/80',
        )}
      >
        {syncing ? <Loader2 className="size-4 animate-spin" /> : <History className="size-4" />}
        <span className="hidden sm:inline">{syncing ? 'Syncing…' : 'Sync'}</span>
      </button>
    </>
  );

  return (
    <div className="space-y-4">
      <TripDetailsModal
        isOpen={tripDetailOpen}
        onClose={() => { setTripDetailOpen(false); setTripDetailLogId(null); }}
        onOpenTrip={handleOpenTripDetails}
        onDeleted={loadLogs}
        logId={tripDetailLogId}
      />

      {/* Sticky Toolbar */}
      <div className="sticky top-0 z-20">
        <GpsLogsToolbar
          activeTab={activeTab}
          onTabChange={onTabChange}
          actions={actions}
          variant="card"
        />
      </div>

      {/* Sync banner — auto-dismisses after 5 seconds */}
      {syncHistoryResult && (
        <div className={cn('relative rounded-lg border px-4 py-2.5 pr-10 text-sm', syncHistoryResult.synced ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800')}>
          <span className="font-medium">Last sync:</span> {syncHistoryResult.message ?? 'Completed'}
          {syncHistoryResult.gps_logs_saved != null && <> — {syncHistoryResult.gps_logs_saved} logs saved</>}
          {syncHistoryResult.gps_logs_failed ? `, ${syncHistoryResult.gps_logs_failed} failed` : ''}
          {syncHistoryResult.elapsed_seconds ? ` (${syncHistoryResult.elapsed_seconds}s)` : ''}
          {syncHistoryResult.travel_order_status && (
            <span className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-brand-teal/10 text-brand-teal">
              {syncHistoryResult.travel_order_status}
            </span>
          )}
          <button
            onClick={() => {
              clearTimeout(syncTimerRef.current);
              setSyncHistoryResult(null);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-zinc-400 transition-colors hover:bg-white/60 hover:text-zinc-600"
            aria-label="Dismiss sync banner"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-12 text-center shadow-brand border border-zinc-100 min-h-[400px]">
          <Loader2 className="size-8 text-brand-teal animate-spin mb-3" />
          <p className="text-base font-medium text-zinc-600">Loading GPS logs...</p>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-12 text-center shadow-brand border border-zinc-100 min-h-[400px]">
          <AlertTriangle className="size-10 text-red-400 mb-3" />
          <p className="text-base font-medium text-red-600">{error}</p>
          <button onClick={loadLogs} className="mt-4 rounded-lg bg-brand-teal px-5 py-2 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors">Retry</button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && result && result.data.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand border border-zinc-100 min-h-[400px]">
          <Navigation className="size-12 text-zinc-300 mb-4" />
          <p className="text-lg font-semibold text-zinc-600 mb-1">📋 No GPS logs found</p>
          <p className="text-sm text-zinc-400 max-w-sm">
            {dateFilter || vehicleFilter
              ? 'Try changing your filters or select a different date.'
              : 'Select a vehicle and date, then click "Sync from Telemetry" to generate trip logs.'}
          </p>
        </div>
      )}

      {/* Table */}
      {!loading && !error && result && result.data.length > 0 && (
        <>
          {/* Desktop table */}
          <div className={cn(tableContainerClass, 'hidden md:block')}>
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead>
                  <tr className={tableHeaderClass}>
                    <th className={tableHeaderCellClass}>Date</th>
                    <th className={tableHeaderCellClass}>GPS Number</th>
                    <th className={tableHeaderCellClass}>TO Status</th>
                    <th className={tableHeaderCellClass}>Linked TO Number</th>
                    <th className={tableHeaderCellClass}>Vehicle</th>
                    <th className={tableHeaderCellClass}>Driver</th>
                    <th className={tableHeaderCellClass}>Trip Status</th>
                    <th className={cn(tableHeaderCellClass, 'text-center')}>Anomaly</th>
                    <th className={cn(tableHeaderCellClass, 'text-right')}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {displayLogs.map((log) => {
                    // Anomaly logic:
                    // - No travel order linked → "NO TO"
                    // - Linked but travel order status != APPROVED → "No Approved TO"
                    // - Linked and status == APPROVED → no anomaly
                    const noTravelOrder = !log.travelOrderId;
                    const hasAnomaly = noTravelOrder || (log.travelOrderStatus && log.travelOrderStatus !== 'APPROVED');
                    const anomalyReason = noTravelOrder ? 'NO TO' : (log.travelOrderStatus && log.travelOrderStatus !== 'APPROVED' ? 'No Approved TO' : null);
                    const isCompleted = log.tripStatusGps === 'completed' || log.tripStatusGps === 'arrived' || (log.departureTimeGps && log.arrivalTimeGps);
                    const isOngoing = log.tripStatusGps === 'en-route' || log.tripStatusGps === 'departed' || log.tripStatusGps === 'ongoing' || log.tripStatusGps === 'tracking_started';
                    const tripStatus = isCompleted ? 'Completed' : isOngoing ? 'Ongoing' : log.tripStatusGps === 'cancelled' ? 'Cancelled' : log.tripStatusGps === 'pending' ? 'Not Synced' : 'No GPS';
                    return (
                      <tr key={log.id} className={cn(tableRowClass, hasAnomaly && 'bg-red-50/40 hover:bg-red-50/60')}>
                        <td className={tableCellClass}>{formatDateManila(log.toDate || log.tripDate || log.createdAt || log.departureTimeGps)}</td>
                        <td className={tableCellClass}>
                          <span className="font-mono text-xs text-brand-teal font-medium">
                            {log.gpsRecordNo || '—'}
                          </span>
                        </td>
                        <td className={tableCellClass}>
                          {log.travelOrderStatus ? (
                            <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase', getTOStatusBadgeClass(log.travelOrderStatus))}>
                              {log.travelOrderStatus}
                            </span>
                          ) : noTravelOrder ? (
                            <span className="text-xs text-orange-600 font-medium">NO TO</span>
                          ) : (
                            <span className="text-zinc-300">—</span>
                          )}
                        </td>
                        <td className={tableCellClass}>
                          {log.toNumber ? <span className="font-mono text-xs text-brand-teal font-medium">{log.toNumber}</span> : hasAnomaly ? <span className="inline-flex items-center rounded-md bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700">ANOMALY - {anomalyReason}</span> : <span className="text-zinc-300">—</span>}
                        </td>
                        <td className={tableCellClass}>
                          <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 font-mono">
                            <Car className="size-3 text-zinc-400" />
                            {log.vehiclePlateNo}
                          </span>
                        </td>
                        <td className={cn(tableCellClass, 'max-w-32 truncate')} title={log.driverName}>{log.driverName}</td>
                        <td className={tableCellClass}>
                          <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize', STATUS_COLORS[log.tripStatusGps] ?? 'bg-zinc-50 text-zinc-600')}>
                            {tripStatus}
                          </span>
                        </td>
                        <td className={cn(tableCellClass, 'text-center')}>
                          {hasAnomaly ? <span className="inline-flex items-center rounded-md bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700">⚠ {anomalyReason}</span> : <span className="text-zinc-300 text-xs">—</span>}
                        </td>
                        <td className={cn(tableCellClass, 'text-right')}>
                          <button
                            onClick={() => handleViewDetails(log)}
                            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-brand-teal hover:bg-brand-teal/5 transition-colors"
                            title="View Details"
                          >
                            <Eye className="size-3.5" />
                            <span className="hidden sm:inline">View</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={page}
              totalPages={Math.ceil(result.total / pageSize)}
              totalItems={result.total}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {displayLogs.map((log) => {
              const noTravelOrder = !log.travelOrderId;
              const hasAnomaly = noTravelOrder || (log.travelOrderStatus && log.travelOrderStatus !== 'APPROVED');
              const isCompleted = log.tripStatusGps === 'completed' || log.tripStatusGps === 'arrived' || (log.departureTimeGps && log.arrivalTimeGps);
              const isOngoing = log.tripStatusGps === 'en-route' || log.tripStatusGps === 'departed' || log.tripStatusGps === 'ongoing' || log.tripStatusGps === 'tracking_started';
              const tripStatus = isCompleted ? 'Completed' : isOngoing ? 'Ongoing' : log.tripStatusGps === 'cancelled' ? 'Cancelled' : log.tripStatusGps === 'pending' ? 'Not Synced' : 'No GPS';
              return (
                <div key={log.id} className={cn('rounded-xl bg-white shadow-brand border border-zinc-100 overflow-hidden', hasAnomaly && 'ring-1 ring-red-200')}>
                <div className="flex items-center justify-between bg-brand-cream/60 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-zinc-500">{formatDateManila(log.toDate || log.tripDate || log.createdAt || log.departureTimeGps)}</p>
                      <p className="text-xs font-mono text-brand-teal font-medium mt-0.5">
                        GPS Number: {log.gpsRecordNo || '—'}
                      </p>
                      {log.toNumber && <p className="text-xs font-mono text-brand-teal font-medium mt-0.5">{log.toNumber}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize', STATUS_COLORS[log.tripStatusGps] ?? 'bg-zinc-50 text-zinc-600')}>
                        {tripStatus}
                      </span>
                    </div>
                  </div>
                  <div className="px-3 py-2.5 space-y-2">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 font-mono">
                          <Car className="size-3 text-zinc-400" />
                          {log.vehiclePlateNo}
                        </span>
                        <span className="text-sm text-zinc-700 truncate">{log.driverName}</span>
                      </div>
                      <div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
                        {log.missionDisplay ?? getMissionDisplay(log)}
                      </div>
                    </div>
                    {hasAnomaly && (
                      <div className="flex items-center gap-1 rounded-md bg-orange-50 px-3 py-1.5">
                        <span className="text-xs font-semibold text-orange-700">⚠ ANOMALY</span>
                      </div>
                    )}
                    {log.notesRemarks && <p className="text-xs text-zinc-500 bg-zinc-50 rounded-lg px-3 py-2 leading-relaxed">{log.notesRemarks}</p>}
                    <button
                      onClick={() => handleViewDetails(log)}
                  className="inline-flex min-h-11 items-center gap-1 rounded-md px-3 py-2 text-xs font-medium text-brand-teal transition-colors hover:bg-brand-teal/5"
                    >
                      <Eye className="size-3.5" /> View Details
                    </button>
                  </div>
                </div>
              );
            })}
            <Pagination
              currentPage={page}
              totalPages={Math.ceil(result.total / pageSize)}
              totalItems={result.total}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </div>
        </>
      )}
    </div>
  );
}

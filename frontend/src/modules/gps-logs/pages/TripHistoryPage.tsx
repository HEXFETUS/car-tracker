// ── Trip History Page ─────────────────────────────────────────
//
// Dedicated page for Fleet Trip History with:
// - Unified toolbar: Vehicle filter + Filter Date + Sync + Clear Filters
// - Filter Date doubles as Sync Date (no separate sync date picker)
// - Auto Sync (on mount + every 60s)
// - Table + Pagination + Detail Modal
// - Filtering is automatic

import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, AlertTriangle, MapPin, Eye, Car, Calendar, RefreshCw } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { cn } from '@/shared/lib/utils';
import {
  fetchFleetTripHistory,
  fetchTrackedVehicles,
  autoSyncFleetTripHistory,
  syncFleetTripHistoryByDate,
  type FleetTripHistoryRow,
  type FleetTripHistoryResult,
  type FleetTripHistorySyncResponse,
  type VehicleOption,
} from '../api/gps-logs-api';
import { TripHistoryDetailModal } from '../components/TripHistoryDetailModal';

// ── Formatting Helpers ─────────────────────────────────────────

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

const TRIP_HISTORY_STATUS_COLORS: Record<string, string> = {
  Moving: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Idling: 'bg-amber-50 text-amber-700 border-amber-200',
};

const tripHistoryPageSize = 20;

export function TripHistoryPage() {
  const { toast } = useNotification();

  // ── Vehicles ────────────────────────────────────────────────
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);

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

  // ── Unified Toolbar State ───────────────────────────────────
  // Filter Date doubles as Sync Date - single date state for both purposes
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');

  // ── Data ────────────────────────────────────────────────────
  const [result, setResult] = useState<FleetTripHistoryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // ── Sync ────────────────────────────────────────────────────
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [syncResult, setSyncResult] = useState<FleetTripHistorySyncResponse | null>(null);
  const [manualSyncing, setManualSyncing] = useState(false);

  // ── Detail Modal ────────────────────────────────────────────
  const [detailRecord, setDetailRecord] = useState<FleetTripHistoryRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // ── Load Data ───────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchFleetTripHistory({
        page,
        pageSize: tripHistoryPageSize,
        vehicleId: vehicleFilter || undefined,
        dateFrom: dateFilter || undefined,
        dateTo: dateFilter || undefined,
      });
      setResult(data);
    } catch {
      setError('Failed to load trip history. Please try again.');
      toast('Failed to load trip history', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, tripHistoryPageSize, vehicleFilter, dateFilter, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Auto Sync ───────────────────────────────────────────────
  const autoSyncIntervalRef = useRef<number | null>(null);

  const handleAutoSync = useCallback(async () => {
    if (autoSyncing) return;
    try {
      setAutoSyncing(true);
      await autoSyncFleetTripHistory();
      setLastSyncTime(new Date());
    } catch {
      // Silently fail for auto-sync
    } finally {
      setAutoSyncing(false);
    }
  }, [autoSyncing]);

  // Auto-sync on mount
  useEffect(() => {
    handleAutoSync();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Set up 60-second auto-sync interval
  useEffect(() => {
    autoSyncIntervalRef.current = window.setInterval(() => {
      handleAutoSync();
    }, 60000);

    return () => {
      if (autoSyncIntervalRef.current) {
        clearInterval(autoSyncIntervalRef.current);
        autoSyncIntervalRef.current = null;
      }
    };
  }, [handleAutoSync]);

  // ── Manual Sync ─────────────────────────────────────────────
  // Uses the Filter Date for synchronization (or today if none selected)
  const handleManualSync = async () => {
    const syncTargetDate = dateFilter || new Date().toISOString().split('T')[0];

    try {
      setManualSyncing(true);
      setSyncResult(null);
      const res = await syncFleetTripHistoryByDate(syncTargetDate);
      setSyncResult({
        success: res.success,
        fetched: res.totalFetched,
        saved: res.totalSaved,
        stationarySkipped: res.totalStationarySkipped,
        duplicateSkipped: res.totalDuplicateSkipped,
        movingSkippedNoLocationChange: res.totalMovingSkipped,
        idleSkippedNotMilestone: res.totalIdleSkipped,
        invalidData: res.totalInvalidData ?? 0,
        errors: res.totalErrors ?? 0,
        message: res.message,
        timestamp: res.timestamp,
      });
      setLastSyncTime(new Date());
      toast(
        `Manual sync complete for ${syncTargetDate} — Fetched: ${res.totalFetched}, Saved: ${res.totalSaved}, Stationary skipped: ${res.totalStationarySkipped}, Duplicates skipped: ${res.totalDuplicateSkipped}`,
        'success',
      );
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Manual sync failed';
      toast(msg, 'error');
    } finally {
      setManualSyncing(false);
    }
  };

  // ── Filter Handlers ─────────────────────────────────────────
  const handleVehicleChange = (value: string) => {
    setVehicleFilter(value);
    setPage(1);
  };

  const handleDateChange = (value: string) => {
    setDateFilter(value);
    setPage(1);
  };

  const handleClearFilters = () => {
    setVehicleFilter('');
    setDateFilter('');
    setPage(1);
  };

  const today = new Date().toISOString().split('T')[0];
  const hasActiveFilters = vehicleFilter !== '' || dateFilter !== '';

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <TripHistoryDetailModal
        record={detailRecord}
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setDetailRecord(null);
        }}
      />

      {/* ── Unified Toolbar ────────────────────────────────── */}
      <div className="rounded-xl bg-white shadow-brand p-4 sm:p-5 space-y-4">
        {/* Row 1: Filters + Sync Controls */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
          {/* Vehicle Filter */}
          <div className="flex flex-col gap-1.5 w-full sm:w-auto">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Vehicle</label>
            <div className="relative flex-1 sm:flex-initial">
              <Car className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-teal pointer-events-none" />
              <select
                value={vehicleFilter}
                onChange={(e) => handleVehicleChange(e.target.value)}
                className="w-full rounded-lg border-0 bg-white pl-10 pr-8 py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm appearance-none cursor-pointer"
              >
                <option value="">All Vehicles</option>
                {vehiclesLoading && <option value="" disabled>Loading…</option>}
                {!vehiclesLoading && vehicles.map((v) => (
                  <option key={v.id} value={v.id}>{v.plateNumber}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Filter Date (also used as Sync Date) */}
          <div className="flex flex-col gap-1.5 w-full sm:w-auto">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Date</label>
            <div className="relative flex-1 sm:flex-initial">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-teal pointer-events-none" />
              <input
                type="date"
                value={dateFilter}
                max={today}
                onChange={(e) => handleDateChange(e.target.value)}
                className="w-full rounded-lg border-0 bg-white pl-10 pr-3 py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-end gap-2">
            <button
              onClick={handleManualSync}
              disabled={manualSyncing}
              className={cn(
                'inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all active:scale-[0.97]',
                manualSyncing ? 'bg-brand-teal/50 cursor-not-allowed' : 'bg-brand-teal hover:bg-brand-teal/80',
              )}
            >
              {manualSyncing ? (
                <><Loader2 className="size-4 animate-spin" /> Syncing…</>
              ) : (
                <><RefreshCw className="size-4" /> Sync{dateFilter ? ` (${dateFilter})` : ' (Today)'}</>
              )}
            </button>

            {hasActiveFilters && (
              <button
                onClick={handleClearFilters}
                className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-zinc-600 bg-zinc-100 hover:bg-zinc-200 transition-colors"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Sync Status */}
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          {autoSyncing ? (
            <span className="inline-flex items-center gap-1.5 text-brand-teal">
              <Loader2 className="size-3 animate-spin" />
              Synchronizing...
            </span>
          ) : lastSyncTime ? (
            <span>
              Last synchronized:{' '}
              {lastSyncTime.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          ) : (
            <span>No synchronization yet</span>
          )}
        </div>
      </div>

      {/* Sync Summary */}
      {syncResult && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span className="font-medium">Synchronization Complete</span>
          <div className="mt-1 text-xs text-emerald-600 space-x-4">
            <span>Fetched: {syncResult.fetched}</span>
            <span>Saved: {syncResult.saved}</span>
            <span>Skipped (Stationary): {syncResult.stationarySkipped}</span>
            <span>Skipped (Duplicate): {syncResult.duplicateSkipped}</span>
            <span>Skipped (No Location Change): {syncResult.movingSkippedNoLocationChange}</span>
            <span>Skipped (Idle Not Milestone): {syncResult.idleSkippedNotMilestone}</span>
            {(syncResult.invalidData ?? 0) > 0 && <span>Invalid Data: {syncResult.invalidData}</span>}
            {(syncResult.errors ?? 0) > 0 && <span>Errors: {syncResult.errors}</span>}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
          <Loader2 className="size-8 text-brand-teal animate-spin mb-3" />
          <p className="text-base font-medium text-zinc-600">Loading trip history...</p>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
          <AlertTriangle className="size-10 text-red-400 mb-3" />
          <p className="text-base font-medium text-red-600">{error}</p>
          <button onClick={loadData} className="mt-4 rounded-lg bg-brand-teal px-5 py-2 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors">Retry</button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && result && result.data.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
          <MapPin className="size-10 text-zinc-300 mb-3" />
          <p className="text-base font-medium text-zinc-600">No trip history records found</p>
          <p className="mt-1 text-sm text-zinc-400">
            {vehicleFilter || dateFilter
              ? 'No records for the selected filters. Try a different vehicle or date.'
              : 'Click "Sync" to fetch trip history data.'}
          </p>
        </div>
      )}

      {/* Table */}
      {!loading && !error && result && result.data.length > 0 && (
        <>
          <div className="hidden md:block rounded-xl bg-white shadow-brand overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-zinc-100 bg-brand-cream/50">
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Time</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Status</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Event</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Road Speed</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Location</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Latitude</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Longitude</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Fuel</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Linked TO</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((row, idx) => (
                    <tr
                      key={row.id}
                      className={cn(
                        'border-b border-zinc-50 transition-colors hover:bg-brand-cream/30 cursor-pointer',
                        idx % 2 === 0 ? 'bg-white' : 'bg-zinc-50/30',
                      )}
                      onClick={() => {
                        setDetailRecord(row);
                        setDetailOpen(true);
                      }}
                    >
                      <td className="px-4 py-3 text-zinc-600 text-xs">{formatDateTime(row.event_time)}</td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
                          TRIP_HISTORY_STATUS_COLORS[row.status] || 'bg-zinc-50 text-zinc-600',
                        )}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-600 text-xs max-w-32 truncate" title={row.event ?? ''}>{row.event || '—'}</td>
                      <td className="px-4 py-3 text-right text-zinc-700 tabular-nums text-xs">{row.road_speed != null ? `${row.road_speed} km/h` : '—'}</td>
                      <td className="px-4 py-3 text-zinc-600 max-w-40 truncate text-xs" title={row.location ?? ''}>{row.location || '—'}</td>
                      <td className="px-4 py-3 text-zinc-500 text-xs font-mono">{row.latitude != null ? formatNumber(row.latitude, 5) : '—'}</td>
                      <td className="px-4 py-3 text-zinc-500 text-xs font-mono">{row.longitude != null ? formatNumber(row.longitude, 5) : '—'}</td>
                      <td className="px-4 py-3 text-right text-zinc-700 tabular-nums text-xs">{row.fuel != null ? `${formatNumber(row.fuel, 1)} L` : '—'}</td>
                      <td className="px-4 py-3">
                        {row.travel_order_to_number ? (
                          <span className="font-mono text-xs text-brand-teal font-medium">{row.travel_order_to_number}</span>
                        ) : (
                          <span className="text-zinc-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDetailRecord(row);
                            setDetailOpen(true);
                          }}
                          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-brand-teal hover:bg-brand-teal/5 transition-colors"
                        >
                          <Eye className="size-3.5" />
                          <span className="hidden sm:inline">View</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-zinc-100 px-5 py-3">
              <p className="text-xs text-zinc-400">
                Showing {Math.min((page - 1) * tripHistoryPageSize + 1, result.total)}–{Math.min(page * tripHistoryPageSize, result.total)} of {result.total}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none">Previous</button>
                <span className="text-xs text-zinc-400">Page {page} of {Math.ceil(result.total / tripHistoryPageSize)}</span>
                <button onClick={() => setPage((p) => Math.min(Math.ceil(result.total / tripHistoryPageSize), p + 1))} disabled={page >= Math.ceil(result.total / tripHistoryPageSize)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none">Next</button>
              </div>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {result.data.map((row) => (
              <div
                key={row.id}
                className="rounded-xl bg-white shadow-brand overflow-hidden cursor-pointer"
                onClick={() => {
                  setDetailRecord(row);
                  setDetailOpen(true);
                }}
              >
                <div className="flex items-center justify-between bg-brand-cream/60 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-zinc-500">{formatDateTime(row.event_time)}</p>
                    {row.travel_order_to_number && (
                      <p className="text-xs font-mono text-brand-teal font-medium mt-0.5">{row.travel_order_to_number}</p>
                    )}
                  </div>
                  <span className={cn(
                    'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
                    TRIP_HISTORY_STATUS_COLORS[row.status] || 'bg-zinc-50 text-zinc-600',
                  )}>
                    {row.status}
                  </span>
                </div>
                <div className="px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    {row.plate_number && (
                      <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 font-mono">{row.plate_number}</span>
                    )}
                    {row.event && (
                      <span className="text-xs text-zinc-500 truncate">{row.event}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Speed</p>
                      <p className="text-xs font-mono text-zinc-700">{row.road_speed != null ? `${row.road_speed} km/h` : '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Fuel</p>
                      <p className="text-xs font-mono text-zinc-700">{row.fuel != null ? `${formatNumber(row.fuel, 1)} L` : '—'}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Location</p>
                      <p className="text-xs text-zinc-700 truncate" title={row.location ?? ''}>{row.location || '—'}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-brand">
              <p className="text-xs text-zinc-400">
                {Math.min((page - 1) * tripHistoryPageSize + 1, result.total)}–{Math.min(page * tripHistoryPageSize, result.total)} of {result.total}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none min-h-11">Previous</button>
                <span className="text-xs text-zinc-400">{page}/{Math.ceil(result.total / tripHistoryPageSize)}</span>
                <button onClick={() => setPage((p) => Math.min(Math.ceil(result.total / tripHistoryPageSize), p + 1))} disabled={page >= Math.ceil(result.total / tripHistoryPageSize)} className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none min-h-11">Next</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
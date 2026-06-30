// ── Telemetry Page ────────────────────────────────────────────
//
// Displays GPS telemetry data with filtering by vehicle, event type, and date range.

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Navigation, AlertTriangle, Calendar, X, Car } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { cn } from '@/shared/lib/utils';
import {
  fetchTelemetry,
  fetchTrackedVehicles,
  type TelemetryRow,
  type VehicleOption,
} from '../api/gps-logs-api';

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

const telemetryPageSize = 20;

export function TelemetryPage() {
  const { toast } = useNotification();

  const [result, setResult] = useState<TelemetryRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [eventFilter, setEventFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
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

  const loadTelemetry = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchTelemetry({
        page,
        pageSize: telemetryPageSize,
        vehicleId: vehicleFilter || undefined,
        plateNumber: undefined,
        eventType: eventFilter || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setResult(data.data);
      setTotal(data.total);
    } catch {
      setError('Failed to load telemetry data. Please try again.');
      toast('Failed to load telemetry', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, telemetryPageSize, vehicleFilter, eventFilter, dateFrom, dateTo, toast]);

  useEffect(() => {
    loadTelemetry();
  }, [loadTelemetry]);

  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
        <div className="flex flex-col gap-1.5 w-full sm:w-auto">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Vehicle</label>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <Car className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-teal pointer-events-none" />
              <select
                value={vehicleFilter}
                onChange={(e) => { setVehicleFilter(e.target.value); setPage(1); }}
                className="w-full rounded-lg border-0 bg-white pl-10 pr-8 py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm appearance-none cursor-pointer"
              >
                <option value="">All Vehicles</option>
                {vehiclesLoading && <option value="" disabled>Loading…</option>}
                {!vehiclesLoading && vehicles.map((v) => (
                  <option key={v.id} value={v.id}>{v.plateNumber}</option>
                ))}
              </select>
            </div>
            {vehicleFilter && (
              <button onClick={() => { setVehicleFilter(''); setPage(1); }} className="rounded-lg bg-zinc-100 p-2 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 shrink-0" title="Clear vehicle filter">
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
                value={eventFilter}
                onChange={(e) => { setEventFilter(e.target.value); setPage(1); }}
                className="w-full rounded-lg border-0 bg-white pl-10 pr-8 py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm appearance-none cursor-pointer"
              >
                <option value="">All Events</option>
                <option value="LOCATION_UPDATE">Location Update</option>
                <option value="IDLING">Idling</option>
                <option value="IGNITION_OFF">Ignition Off</option>
              </select>
            </div>
            {eventFilter && (
              <button onClick={() => { setEventFilter(''); setPage(1); }} className="rounded-lg bg-zinc-100 p-2 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 shrink-0" title="Clear event filter">
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
                value={dateFrom}
                max={today}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                className="w-full rounded-lg border-0 bg-white pl-10 pr-3 py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm"
              />
            </div>
            {dateFrom && (
              <button onClick={() => { setDateFrom(''); setPage(1); }} className="rounded-lg bg-zinc-100 p-2 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 shrink-0" title="Clear date from">
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
                value={dateTo}
                max={today}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                className="w-full rounded-lg border-0 bg-white pl-10 pr-3 py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm"
              />
            </div>
            {dateTo && (
              <button onClick={() => { setDateTo(''); setPage(1); }} className="rounded-lg bg-zinc-100 p-2 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 shrink-0" title="Clear date to">
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-12 text-center shadow-brand">
          <Loader2 className="size-8 text-brand-teal animate-spin mb-3" />
          <p className="text-base font-medium text-zinc-600">Loading telemetry...</p>
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-12 text-center shadow-brand">
          <AlertTriangle className="size-10 text-red-400 mb-3" />
          <p className="text-base font-medium text-red-600">{error}</p>
          <button onClick={loadTelemetry} className="mt-4 rounded-lg bg-brand-teal px-5 py-2 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors">Retry</button>
        </div>
      )}

      {!loading && !error && result && result.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-12 text-center shadow-brand">
          <Navigation className="size-10 text-zinc-300 mb-3" />
          <p className="text-base font-medium text-zinc-600">No telemetry data</p>
          <p className="mt-1 text-sm text-zinc-400">Telemetry records will appear here as the scheduler runs (every 120s).</p>
          <button onClick={loadTelemetry} className="mt-4 rounded-lg bg-brand-teal px-5 py-2 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors">Refresh</button>
        </div>
      )}

      {!loading && !error && result && result.length > 0 && (
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
                  {result.map((row, idx) => (
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
                Showing {Math.min((page - 1) * telemetryPageSize + 1, total)}–{Math.min(page * telemetryPageSize, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none">Previous</button>
                <span className="text-xs text-zinc-400">Page {page} of {Math.ceil(total / telemetryPageSize)}</span>
                <button onClick={() => setPage((p) => Math.min(Math.ceil(total / telemetryPageSize), p + 1))} disabled={page >= Math.ceil(total / telemetryPageSize)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none">Next</button>
              </div>
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {result.map((row) => (
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
                {Math.min((page - 1) * telemetryPageSize + 1, total)}–{Math.min(page * telemetryPageSize, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none min-h-11">Previous</button>
                <span className="text-xs text-zinc-400">{page}/{Math.ceil(total / telemetryPageSize)}</span>
                <button onClick={() => setPage((p) => Math.min(Math.ceil(total / telemetryPageSize), p + 1))} disabled={page >= Math.ceil(total / telemetryPageSize)} className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none min-h-11">Next</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
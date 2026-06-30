// ── Reports Page ──────────────────────────────────────────────
//
// Displays travel reports with vehicle and date filtering, pagination.

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Navigation, AlertTriangle, Calendar, X, Car } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { cn } from '@/shared/lib/utils';
import {
  fetchTravelReports,
  fetchTrackedVehicles,
  type TravelReportRow,
  type VehicleOption,
} from '../api/gps-logs-api';

function formatDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const [year, month, day] = iso.split('-').map(Number);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return '—';
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const reportsPageSize = 20;

export function ReportsPage() {
  const { toast } = useNotification();

  const [result, setResult] = useState<TravelReportRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
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

  const loadReports = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchTravelReports({
        vehicleId: vehicleFilter || undefined,
        tripDate: dateFilter || undefined,
        page,
        pageSize: reportsPageSize,
      });
      setResult(data.data);
      setTotal(data.total);
    } catch {
      setError('Failed to load travel reports. Please try again.');
      toast('Failed to load travel reports', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, reportsPageSize, vehicleFilter, dateFilter, toast]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

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
          <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Date</label>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-teal pointer-events-none" />
              <input
                type="date"
                value={dateFilter}
                max={today}
                onChange={(e) => { setDateFilter(e.target.value); setPage(1); }}
                className="w-full rounded-lg border-0 bg-white pl-10 pr-3 py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm"
              />
            </div>
            {dateFilter && (
              <button onClick={() => { setDateFilter(''); setPage(1); }} className="rounded-lg bg-zinc-100 p-2 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 shrink-0" title="Clear date filter">
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-12 text-center shadow-brand">
          <Loader2 className="size-8 text-brand-teal animate-spin mb-3" />
          <p className="text-base font-medium text-zinc-600">Loading travel reports...</p>
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-12 text-center shadow-brand">
          <AlertTriangle className="size-10 text-red-400 mb-3" />
          <p className="text-base font-medium text-red-600">{error}</p>
          <button onClick={loadReports} className="mt-4 rounded-lg bg-brand-teal px-5 py-2 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors">Retry</button>
        </div>
      )}

      {!loading && !error && result && result.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-12 text-center shadow-brand">
          <Navigation className="size-10 text-zinc-300 mb-3" />
          <p className="text-base font-medium text-zinc-600">No travel reports found</p>
          <p className="mt-1 text-sm text-zinc-400">Create a travel order and sync GPS data to see it here.</p>
          <button onClick={loadReports} className="mt-4 rounded-lg bg-brand-teal px-5 py-2 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors">Refresh</button>
        </div>
      )}

      {!loading && !error && result && result.length > 0 && (
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
                  {result.map((row, idx) => (
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
                Showing {Math.min((page - 1) * reportsPageSize + 1, total)}–{Math.min(page * reportsPageSize, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none">Previous</button>
                <span className="text-xs text-zinc-400">Page {page} of {Math.ceil(total / reportsPageSize)}</span>
                <button onClick={() => setPage((p) => Math.min(Math.ceil(total / reportsPageSize), p + 1))} disabled={page >= Math.ceil(total / reportsPageSize)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none">Next</button>
              </div>
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {result.map((row) => (
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
                {Math.min((page - 1) * reportsPageSize + 1, total)}–{Math.min(page * reportsPageSize, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none min-h-11">Previous</button>
                <span className="text-xs text-zinc-400">{page}/{Math.ceil(total / reportsPageSize)}</span>
                <button onClick={() => setPage((p) => Math.min(Math.ceil(total / reportsPageSize), p + 1))} disabled={page >= Math.ceil(total / reportsPageSize)} className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none min-h-11">Next</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
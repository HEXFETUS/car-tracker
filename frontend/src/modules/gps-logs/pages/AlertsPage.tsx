// ── Alerts Page ───────────────────────────────────────────────
//
// Displays GPS alerts with filtering by vehicle, alert type, and date.

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { Loader2, AlertTriangle, Calendar, X, Car } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { cn } from '@/shared/lib/utils';
import {
  fetchGpsAlerts,
  fetchTrackedVehicles,
  type GpsAlertRow,
  type VehicleOption,
} from '../api/gps-logs-api';

// ── Formatting Helpers ─────────────────────────────────────────

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

const ALERT_TYPE_COLORS: Record<string, string> = {
  IGNITION_ON: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  IGNITION_OFF: 'bg-slate-50 text-slate-700 border-slate-200',
  IDLING: 'bg-amber-50 text-amber-700 border-amber-200',
  NO_APPROVED_TRAVEL_ORDER: 'bg-red-50 text-red-700 border-red-200',
};

const alertsPageSize = 25;

export function AlertsPage() {
  const { toast } = useNotification();
  const [searchParams] = useSearchParams();
  const highlightedEntityId = searchParams.get('entityId');

  const [result, setResult] = useState<GpsAlertRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [alertTypeFilter, setAlertTypeFilter] = useState('');
  const [alertDate, setAlertDate] = useState('');
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

  const loadAlerts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchGpsAlerts({
        page,
        pageSize: alertsPageSize,
        vehicleId: vehicleFilter || undefined,
        alertType: alertTypeFilter || undefined,
        alertDate: alertDate || undefined,
      });
      setResult(data.data);
      setTotal(data.total);
    } catch {
      setError('Failed to load GPS alerts. Please try again.');
      toast('Failed to load GPS alerts', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, alertsPageSize, vehicleFilter, alertTypeFilter, alertDate, toast]);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  useEffect(() => {
    if (!highlightedEntityId || !result?.length) return;
    const element = document.getElementById(`gps-alert-${highlightedEntityId}`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [result, highlightedEntityId]);

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
          <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Alert Type</label>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <AlertTriangle className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-teal pointer-events-none" />
              <select
                value={alertTypeFilter}
                onChange={(e) => { setAlertTypeFilter(e.target.value); setPage(1); }}
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
              <button onClick={() => { setAlertTypeFilter(''); setPage(1); }} className="rounded-lg bg-zinc-100 p-2 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 shrink-0" title="Clear alert type filter">
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
                onChange={(e) => { setAlertDate(e.target.value); setPage(1); }}
                className="w-full rounded-lg border-0 bg-white pl-10 pr-3 py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm"
              />
            </div>
            {alertDate && (
              <button onClick={() => { setAlertDate(''); setPage(1); }} className="rounded-lg bg-zinc-100 p-2 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 shrink-0" title="Clear alert date">
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-12 text-center shadow-brand">
          <Loader2 className="size-8 text-brand-teal animate-spin mb-3" />
          <p className="text-base font-medium text-zinc-600">Loading alerts...</p>
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-12 text-center shadow-brand">
          <AlertTriangle className="size-10 text-red-400 mb-3" />
          <p className="text-base font-medium text-red-600">{error}</p>
          <button onClick={loadAlerts} className="mt-4 rounded-lg bg-brand-teal px-5 py-2 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors">Retry</button>
        </div>
      )}

      {!loading && !error && result && result.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-12 text-center shadow-brand">
          <AlertTriangle className="size-10 text-zinc-300 mb-3" />
          <p className="text-base font-medium text-zinc-600">No alerts found</p>
          <p className="mt-1 text-sm text-zinc-400">
            {vehicleFilter || alertTypeFilter ? 'No alerts match the selected filters.' : 'Alerts will appear here when generated from fleet telemetry.'}
          </p>
        </div>
      )}

      {!loading && !error && result && result.length > 0 && (
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
                  {result.map((alert, idx) => {
                    const plate = alert.vehiclePlate ?? 'Unknown';
                    return (
                      <tr
                        id={`gps-alert-${alert.id}`}
                        key={alert.id}
                        className={cn(
                          'border-b border-zinc-50 transition-colors hover:bg-brand-cream/30',
                          idx % 2 === 0 ? 'bg-white' : 'bg-zinc-50/30',
                          highlightedEntityId === alert.id && 'bg-amber-50 ring-2 ring-inset ring-amber-300',
                        )}
                      >
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
                Showing {Math.min((page - 1) * alertsPageSize + 1, total)}–{Math.min(page * alertsPageSize, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none">Previous</button>
                <span className="text-xs text-zinc-400">Page {page} of {Math.ceil(total / alertsPageSize)}</span>
                <button onClick={() => setPage((p) => Math.min(Math.ceil(total / alertsPageSize), p + 1))} disabled={page >= Math.ceil(total / alertsPageSize)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none">Next</button>
              </div>
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {result.map((alert) => {
              const plate = alert.vehiclePlate ?? 'Unknown';
              return (
                <div
                  id={`gps-alert-${alert.id}`}
                  key={alert.id}
                  className={cn(
                    'rounded-xl bg-white shadow-brand overflow-hidden',
                    highlightedEntityId === alert.id && 'ring-2 ring-amber-300',
                  )}
                >
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
                {Math.min((page - 1) * alertsPageSize + 1, total)}–{Math.min(page * alertsPageSize, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none min-h-11">Previous</button>
                <span className="text-xs text-zinc-400">{page}/{Math.ceil(total / alertsPageSize)}</span>
                <button onClick={() => setPage((p) => Math.min(Math.ceil(total / alertsPageSize), p + 1))} disabled={page >= Math.ceil(total / alertsPageSize)} className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:pointer-events-none min-h-11">Next</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
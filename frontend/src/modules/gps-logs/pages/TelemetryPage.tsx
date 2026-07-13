// ── Telemetry Page ────────────────────────────────────────────
//
// Displays GPS telemetry data with filtering by vehicle, event type, and date range.
// Follows the exact same layout and styling as LogsPage.

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, Navigation, AlertTriangle, Calendar, X, Car, RefreshCw,
  User, MapPin, Zap, Timer, Power, PowerOff, Activity, Fuel, AlertCircle,
} from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { cn } from '@/shared/lib/utils';
import { formatDateTimeManila } from '@/shared/lib/date-utils';
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
  fetchTelemetry,
  fetchTrackedVehicles,
  type TelemetryRow,
  type VehicleOption,
} from '../api/gps-logs-api';
import { GpsLogsToolbar, type TabKey } from '../components/GpsLogsToolbar';

// ── Helpers ────────────────────────────────────────────────────

const PLATE_COLORS = [
  "bg-teal-100 text-teal-700 border-teal-200",
  "bg-indigo-100 text-indigo-700 border-indigo-200",
  "bg-cyan-100 text-cyan-700 border-cyan-200",
  "bg-rose-100 text-rose-700 border-rose-200",
  "bg-lime-100 text-lime-700 border-lime-200",
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function getPlateColor(plate: string) {
  if (plate === 'KAR6412') {
    return 'bg-teal-100 text-teal-700 border-teal-200';
  }
  const index = Math.abs(hashString(plate)) % PLATE_COLORS.length;
  return PLATE_COLORS[index];
}

function formatNumber(val: number | null | undefined, decimals = 2): string {
  if (val == null) return '—';
  return Number(val).toFixed(decimals);
}

// ── Event Badge Colors & Icons ─────────────────────────────────

const EVENT_CONFIG: Record<string, { color: string; icon: React.ReactNode }> = {
  IGNITION_ON: {
    color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    icon: <Power className="size-3" />,
  },
  IGNITION_OFF: {
    color: 'bg-zinc-100 text-zinc-600 border-zinc-300',
    icon: <PowerOff className="size-3" />,
  },
  MOTION_STARTED: {
    color: 'bg-blue-50 text-blue-700 border-blue-200',
    icon: <Activity className="size-3" />,
  },
  IDLING_TOO_LONG: {
    color: 'bg-orange-50 text-orange-700 border-orange-200',
    icon: <Timer className="size-3" />,
  },
  LOCATION_UPDATE: {
    color: 'bg-purple-50 text-purple-700 border-purple-200',
    icon: <MapPin className="size-3" />,
  },
  SPEEDING: {
    color: 'bg-red-50 text-red-700 border-red-200',
    icon: <Zap className="size-3" />,
  },
  LOW_FUEL: {
    color: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    icon: <Fuel className="size-3" />,
  },
};

function getEventConfig(eventType: string) {
  return EVENT_CONFIG[eventType] ?? {
    color: 'bg-slate-50 text-slate-700 border-slate-200',
    icon: <AlertCircle className="size-3" />,
  };
}

const telemetryPageSize = 20;

interface TelemetryPageProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  vehicleFilter: string;
  onVehicleFilterChange: (v: string) => void;
}

export function TelemetryPage({ activeTab, onTabChange, vehicleFilter, onVehicleFilterChange }: TelemetryPageProps) {
  const { toast } = useNotification();

  const [result, setResult] = useState<TelemetryRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [eventFilter, setEventFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);

  // Helper: format idling duration in minutes (e.g. "10m") if available
  function formatIdlingDuration(row: TelemetryRow): string | null {
    if (row.eventType !== 'IDLING_TOO_LONG') return null;
    const raw = (row as any).idlingDurationMinutes;
    if (raw != null) return `${Number(raw)}m`;
    if (row.recordedAt) {
      const t1 = new Date(row.recordedAt).getTime();
      const prev = row.ignition != null || row.speedKmh != null || row.fuelLiters != null
        ? new Date((row as any).previousRecordedAt || row.recordedAt).getTime()
        : NaN;
      if (!isNaN(prev) && t1 > prev) {
        const minutes = Math.max(1, Math.round((t1 - prev) / 60000));
        return `${minutes}m`;
      }
    }
    return null;
  }

  // Badge label helper
  function getEventLabel(row: TelemetryRow): string {
    if (row.eventType === 'IDLING_TOO_LONG') {
      const dur = formatIdlingDuration(row);
      return dur ? `IDLING TOO LONG • ${dur}` : 'IDLING TOO LONG';
    }
    return row.eventType.replace(/_/g, ' ');
  }

  const loadTelemetry = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchTelemetry({
        page, pageSize: telemetryPageSize,
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
    } finally { setLoading(false); }
  }, [page, telemetryPageSize, vehicleFilter, eventFilter, dateFrom, dateTo, toast]);

  useEffect(() => {
    loadTelemetry();
    const interval = setInterval(loadTelemetry, 120000);
    return () => clearInterval(interval);
  }, [loadTelemetry]);

  const today = new Date().toISOString().split('T')[0];

  const handleRefresh = () => { loadTelemetry(); };

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

  // ── Filters ──
  const filters = (
    <>
      <div className="relative w-full sm:w-auto">
        <Car className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-brand-teal pointer-events-none" />
        <select
          value={vehicleFilter}
          onChange={(e) => { onVehicleFilterChange(e.target.value); setPage(1); }}
          className="h-11 w-full appearance-none rounded-lg border-0 bg-white py-2 pl-8 pr-7 text-sm font-medium text-zinc-700 shadow-sm ring-1 ring-brand-sage transition-shadow hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 sm:h-auto sm:w-[170px]"
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
        <AlertTriangle className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-brand-teal pointer-events-none" />
        <select
          value={eventFilter}
          onChange={(e) => { setEventFilter(e.target.value); setPage(1); }}
          className="h-11 w-full appearance-none rounded-lg border-0 bg-white py-2 pl-8 pr-7 text-sm font-medium text-zinc-700 shadow-sm ring-1 ring-brand-sage transition-shadow hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 sm:h-auto sm:w-[170px]"
        >
          <option value="">All Events</option>
          <option value="IGNITION_ON">Ignition On</option>
          <option value="IGNITION_OFF">Ignition Off</option>
          <option value="MOTION_STARTED">Motion Started</option>
          <option value="IDLING_TOO_LONG">Idling Too Long</option>
          <option value="LOCATION_UPDATE">Location Update</option>
          <option value="SPEEDING">Speeding</option>
          <option value="LOW_FUEL">Low Fuel</option>
        </select>
        {eventFilter && (
          <button onClick={() => { setEventFilter(''); setPage(1); }} className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600" title="Clear">
            <X className="size-3" />
          </button>
        )}
      </div>
      <div className="relative w-full sm:w-auto">
        <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-brand-teal pointer-events-none" />
        <input
          type="date"
          value={dateFrom}
          max={today}
          onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          className="gps-log-date-filter h-11 w-full rounded-lg border-0 bg-white py-2 pl-8 pr-7 text-sm font-medium text-zinc-700 shadow-sm ring-1 ring-brand-sage transition-shadow hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 sm:h-auto sm:w-[168px]"
        />
        {dateFrom && (
          <button onClick={() => { setDateFrom(''); setPage(1); }} className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600" title="Clear">
            <X className="size-3" />
          </button>
        )}
      </div>
      <div className="relative w-full sm:w-auto">
        <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-brand-teal pointer-events-none" />
        <input
          type="date"
          value={dateTo}
          max={today}
          onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          className="gps-log-date-filter h-11 w-full rounded-lg border-0 bg-white py-2 pl-8 pr-7 text-sm font-medium text-zinc-700 shadow-sm ring-1 ring-brand-sage transition-shadow hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 sm:h-auto sm:w-[168px]"
        />
        {dateTo && (
          <button onClick={() => { setDateTo(''); setPage(1); }} className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600" title="Clear">
            <X className="size-3" />
          </button>
        )}
      </div>
    </>
  );

  // ── Actions (filters + refresh, right-aligned) ──
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
    </>
  );

  return (
    <div className="space-y-4">
      {/* Sticky Toolbar */}
      <div className="sticky top-0 z-20">
        <GpsLogsToolbar
          activeTab={activeTab}
          onTabChange={onTabChange}
          actions={actions}
          variant="card"
        />
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-12 text-center shadow-brand border border-zinc-100 min-h-[400px]">
          <Loader2 className="size-8 text-brand-teal animate-spin mb-3" />
          <p className="text-base font-medium text-zinc-600">Loading telemetry...</p>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-12 text-center shadow-brand border border-zinc-100 min-h-[400px]">
          <AlertTriangle className="size-10 text-red-400 mb-3" />
          <p className="text-base font-medium text-red-600">{error}</p>
          <button onClick={loadTelemetry} className="mt-4 rounded-lg bg-brand-teal px-5 py-2 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors">Retry</button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && result && result.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand border border-zinc-100 min-h-[400px]">
          <Navigation className="size-12 text-zinc-300 mb-4" />
          <p className="text-lg font-semibold text-zinc-600 mb-1">📡 No telemetry events available</p>
          <p className="text-sm text-zinc-400 max-w-sm">
            {vehicleFilter || eventFilter || dateFrom || dateTo
              ? 'Try changing your filters or select a different date range.'
              : 'Telemetry records will appear here as the scheduler runs (every 120s).'}
          </p>
          <button onClick={loadTelemetry} className="mt-4 rounded-lg bg-brand-teal px-5 py-2 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors">Refresh</button>
        </div>
      )}

      {/* Table + Cards */}
      {!loading && !error && result && result.length > 0 && (
        <>
          {/* Desktop table */}
          <div className={cn(tableContainerClass, 'hidden md:block')}>
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead>
                  <tr className={tableHeaderClass}>
                    <th className={tableHeaderCellClass}>Time</th>
                    <th className={tableHeaderCellClass}>Vehicle</th>
                    <th className={tableHeaderCellClass}>Event</th>
                    <th className={tableHeaderCellClass}>Location</th>
                    <th className={cn(tableHeaderCellClass, 'text-right')}>Speed</th>
                    <th className={cn(tableHeaderCellClass, 'text-right')}>Fuel</th>
                    <th className={cn(tableHeaderCellClass, 'text-center')}>Ignition</th>
                    <th className={tableHeaderCellClass}>TO</th>
                    <th className={tableHeaderCellClass}>Driver</th>
                  </tr>
                </thead>
                <tbody>
                  {result.map((row) => {
                    const evt = getEventConfig(row.eventType);
                    return (
                      <tr key={row.id} className={tableRowClass}>
                        <td className={tableCellClass}>{formatDateTimeManila(row.recordedAt)}</td>
                        <td className={tableCellClass}>
                          <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium font-mono", getPlateColor(row.plateNumber))}>
                            <Car className="size-3" />
                            {row.plateNumber}
                          </span>
                        </td>
                        <td className={tableCellClass}>
                          <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', evt.color)}>
                            {evt.icon}
                            {getEventLabel(row)}
                          </span>
                        </td>
                        <td className={cn(tableCellClass, 'max-w-48 truncate')} title={row.locationName ?? ''}>
                          <div className="flex items-center gap-1">
                            <MapPin className="size-3 text-zinc-400 shrink-0" />
                            <span className="truncate">{row.locationName || '—'}</span>
                          </div>
                        </td>
                        <td className={cn(tableCellClass, 'text-right tabular-nums')}>{formatNumber(row.speedKmh, 0)} km/h</td>
                        <td className={cn(tableCellClass, 'text-right tabular-nums')}>{row.fuelLiters != null ? `${formatNumber(row.fuelLiters, 1)} L` : '—'}</td>
                        <td className={cn(tableCellClass, 'text-center')}>
                          <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', row.ignition ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-300')}>
                            {row.ignition ? <Power className="size-3" /> : <PowerOff className="size-3" />}
                            {row.ignition ? 'ON' : 'OFF'}
                          </span>
                        </td>
                        <td className={tableCellClass}>{row.toNumber || '—'}</td>
                        <td className={cn(tableCellClass, 'max-w-28 truncate')} title={row.driverName ?? ''}>
                          <div className="flex items-center gap-1">
                            <User className="size-3 text-zinc-400 shrink-0" />
                            <span className="truncate">{row.driverName || 'Unassigned'}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={page}
              totalPages={Math.ceil(total / telemetryPageSize)}
              totalItems={total}
              pageSize={telemetryPageSize}
              onPageChange={setPage}
            />
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {result.map((row) => {
              const evt = getEventConfig(row.eventType);
              return (
                <div key={row.id} className="rounded-xl bg-white shadow-brand border border-zinc-100 overflow-hidden">
                  <div className="flex items-center justify-between bg-brand-cream/60 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium font-mono mb-0.5", getPlateColor(row.plateNumber))}>
                        <Car className="size-2.5" />
                        {row.plateNumber}
                      </span>
                      <p className="text-[10px] text-zinc-400 mt-0.5">{formatDateTimeManila(row.recordedAt)}</p>
                    </div>
                    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium', evt.color)}>
                      {evt.icon}
                      {getEventLabel(row)}
                    </span>
                  </div>
                  <div className="px-3 py-2.5 space-y-2">
                    <p className="text-xs text-zinc-700 truncate" title={row.locationName ?? ''}>
                      <MapPin className="size-3 text-zinc-400 inline mr-1" />
                      {row.locationName || 'Location unavailable'}
                    </p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
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
                        <p className="text-xs font-mono text-brand-teal">{row.toNumber || '—'}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Driver</p>
                        <p className="text-xs text-zinc-700">{row.driverName || 'Unassigned'}</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <Pagination
              currentPage={page}
              totalPages={Math.ceil(total / telemetryPageSize)}
              totalItems={total}
              pageSize={telemetryPageSize}
              onPageChange={setPage}
            />
          </div>
        </>
      )}
    </div>
  );
}

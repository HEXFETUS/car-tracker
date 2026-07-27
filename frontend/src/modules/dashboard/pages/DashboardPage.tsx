import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';
import {
  Car, CheckCircle2, Wrench, AlertTriangle,
  Route, Radio, Navigation, RefreshCw,
  Users, FileText, BarChart3,
  ShieldCheck, Gauge, Activity,
  ChevronRight,
} from 'lucide-react';
import { formatDateTimeManila } from '@/shared/lib/date-utils';
import {
  PieChart, Pie, Cell, Tooltip as ReTooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line, AreaChart, Area,
} from 'recharts';
import { cn } from '@/shared/lib/utils';
import {
  tableContainerClass,
  tableClass,
  tableHeaderClass,
  tableHeaderCellClass,
  tableRowClass,
  tableCellClass,
} from '@/shared/styles/table-constants';
import {
  emptyDashboardData,
  fetchDashboardCharts,
  fetchDashboardLive,
  fetchDashboardSummary,
  fetchDashboardTables,
} from '../api/dashboard-api';

const FleetMapPanel = lazy(() => import('../components/FleetMapPanel').then((mod) => ({ default: mod.FleetMapPanel })));

// ── Brand Palette ─────────────────────────────────────────────
const COLORS = {
  teal: '#35858E',
  sage: '#7DA78C',
  moss: '#C2D099',
  cream: '#E6EEC9',
  pastel: '#C8E3E6',
  red: '#EF4444',
  orange: '#F97316',
  amber: '#F59E0B',
  blue: '#3B82F6',
  purple: '#8B5CF6',
  pink: '#EC4899',
  zinc: '#71717A',
};

const TO_STATUS_COLORS: Record<string, string> = {
  Pending: COLORS.orange,
  'For Request': COLORS.amber,
  'For Approval': COLORS.blue,
  Approved: COLORS.teal,
  Active: COLORS.sage,
  Completed: COLORS.moss,
  Cancelled: COLORS.zinc,
};

const DOUGHNUT_COLORS = [COLORS.teal, COLORS.blue, COLORS.red, COLORS.orange, COLORS.zinc];

const VEHICLE_STATUS_COLORS: Record<string, string> = {
  Moving: COLORS.teal,
  Idling: COLORS.amber,
  Parked: COLORS.blue,
  Offline: COLORS.zinc,
  'Under Repair': COLORS.red,
};

// Fix Leaflet default marker icon issue
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

// ── Formatting Helpers ────────────────────────────────────────
function fmtKm(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K km';
  return n.toFixed(0) + ' km';
}

function fmtPct(n: number): string {
  return n.toFixed(1) + '%';
}

function fmtSpeed(n: number): string {
  return n.toFixed(0) + ' km/h';
}

function fmtCost(n: number): string {
  return '₱' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDuration(isoStart: string | null, isoEnd: string | null): string {
  if (!isoStart) return '—';
  const start = new Date(isoStart).getTime();
  const end = isoEnd ? new Date(isoEnd).getTime() : Date.now();
  const diffMs = Math.max(0, end - start);
  const h = Math.floor(diffMs / 3600000);
  const m = Math.floor((diffMs % 3600000) / 60000);
  return `${h}h ${m}m`;
}

// ── Hero Section ──────────────────────────────────────────────
function DashboardHero({ lastUpdated, onRefresh }: {
  lastUpdated: string;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl bg-white/80 p-6 shadow-brand backdrop-blur-sm border border-white/60">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900">
          Fleet Operations Command Center
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Real-time vehicle, trip, GPS, and maintenance overview
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-zinc-400">Last updated: {lastUpdated}</span>
        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-teal px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-teal/90 hover:shadow-md active:scale-95"
        >
          <RefreshCw className="size-4" />
          Refresh
        </button>
        <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-brand-teal/10 px-3 py-1.5 text-xs font-semibold text-brand-teal ring-1 ring-brand-teal/20">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-teal opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-brand-teal" />
          </span>
          Auto-refresh
        </span>
      </div>
    </div>
  );
}

// ── KPI Card ───────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, status, gradient, iconColor, onClick }: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  status?: string;
  gradient: string;
  iconColor: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-2xl p-5 shadow-sm border border-white/60 transition-all hover:shadow-md hover:-translate-y-0.5',
        gradient,
        onClick && 'cursor-pointer',
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{label}</p>
          <p className="mt-2 text-4xl font-extrabold text-zinc-900 tabular-nums">{value}</p>
          {status && <p className="mt-1 text-xs text-zinc-500">{status}</p>}
        </div>
        <div className={cn('flex size-12 items-center justify-center rounded-full shadow-sm', iconColor)}>
          <Icon className="size-6 text-white" />
        </div>
      </div>
    </div>
  );
}

// ── Dashboard Card ─────────────────────────────────────────────
function DashboardCard({ title, icon: Icon, children, className, actions }: {
  title: string;
  icon?: React.ElementType;
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className={cn('rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm sm:p-6', className)}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-base font-bold text-zinc-900">
          {Icon && <Icon className="size-5 text-brand-teal" />}
          {title}
        </h3>
        {actions}
      </div>
      {children}
    </div>
  );
}

// ── Metric Row ────────────────────────────────────────────────
function MetricRow({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between rounded-xl px-4 py-3', className)}>
      <span className="text-sm text-zinc-600">{label}</span>
      <span className="text-base font-bold text-zinc-900">{value}</span>
    </div>
  );
}

// ── Progress Metric ───────────────────────────────────────────
function ProgressMetric({ label, value, color, max = 100 }: { label: string; value: number; color: string; max?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="text-zinc-600">{label}</span>
        <span className="font-bold text-zinc-900">{fmtPct(value)}</span>
      </div>
      <div className="h-2.5 rounded-full bg-brand-cream">
        <div className={cn('h-2.5 rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────
function EmptyState({ message, icon: Icon = AlertTriangle }: { message: string; icon?: React.ElementType }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 px-6 py-10 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-zinc-100">
        <Icon className="size-6 text-zinc-400" />
      </div>
      <p className="text-sm font-semibold text-zinc-600">{message}</p>
      <p className="mt-1 text-xs text-zinc-400">The view will update as more operational activity appears.</p>
    </div>
  );
}

// ── Status Badge ──────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    APPROVED: 'bg-blue-100 text-blue-700 ring-blue-200',
    COMPLETED: 'bg-green-100 text-green-700 ring-green-200',
    CANCELLED: 'bg-red-100 text-red-700 ring-red-200',
    PENDING: 'bg-amber-100 text-amber-700 ring-amber-200',
    FOR_APPROVAL: 'bg-purple-100 text-purple-700 ring-purple-200',
    FOR_REQUEST: 'bg-zinc-100 text-zinc-700 ring-zinc-200',
  };
  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ring-1', colors[status] || 'bg-zinc-100 text-zinc-700 ring-zinc-200')}>
      {status}
    </span>
  );
}

// ── Live Fleet Card ───────────────────────────────────────────
function LiveFleetCard({ moving, idling }: { moving: number; idling: number }) {
  return (
    <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-full bg-brand-teal/10 ring-4 ring-brand-teal/5">
            <Radio className="size-6 text-brand-teal" />
          </div>
          <div>
            <p className="text-sm font-bold text-zinc-500">Live Fleet Status</p>
            <p className="text-lg font-extrabold text-zinc-900">Real-time Operations</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700 ring-1 ring-emerald-200">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
            </span>
            {moving} Moving
          </span>
          <span className="flex items-center gap-2 rounded-full bg-amber-50 px-4 py-2 text-sm font-bold text-amber-700 ring-1 ring-amber-200">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-amber-500" />
            </span>
            {idling} Idling
          </span>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
        <RefreshCw className="size-3 animate-spin" />
        Auto-refreshes every 60s
      </div>
    </div>
  );
}

// ── Charts ─────────────────────────────────────────────────────
function DoughnutChart({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex flex-col items-center">
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={70}
            outerRadius={100}
            dataKey="value"
            nameKey="name"
            stroke="none"
          >
            {data.map((item, i) => (
              <Cell key={item.name} fill={VEHICLE_STATUS_COLORS[item.name] || DOUGHNUT_COLORS[i % DOUGHNUT_COLORS.length]} />
            ))}
          </Pie>
          <ReTooltip formatter={(value: any, name: any) => [`${value} (${total > 0 ? ((Number(value) / total) * 100).toFixed(1) : 0}%)`, name]} />
        </PieChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        {data.map((d, i) => (
          <div key={d.name} className="flex items-center gap-1.5">
            <div className="size-3 rounded-sm" style={{ backgroundColor: VEHICLE_STATUS_COLORS[d.name] || DOUGHNUT_COLORS[i % DOUGHNUT_COLORS.length] }} />
            <span className="text-xs text-zinc-600">{d.name}: {d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBarChart({ data, colorMap }: {
  data: { name: string; value: number }[];
  colorMap: Record<string, string>;
}) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E6EEC9" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <ReTooltip />
        <Bar dataKey="value" radius={[6, 6, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={colorMap[d.name] || COLORS.teal} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function DistanceLineChart({ data }: { data: { date: string; total_distance: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E6EEC9" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(0) + 'km'} />
        <ReTooltip formatter={(value: any) => [Number(value).toFixed(1) + ' km', 'Distance']} />
        <Line type="monotone" dataKey="total_distance" stroke={COLORS.teal} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: COLORS.teal }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function TripsAreaChart({ data }: { data: { date: string; trips: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E6EEC9" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
        <YAxis tick={{ fontSize: 11 }} />
        <ReTooltip formatter={(value: any) => [Number(value), 'Trips']} />
        <Area type="monotone" dataKey="trips" stroke={COLORS.sage} fill={COLORS.moss} fillOpacity={0.6} strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Loading Skeleton ──────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-36 rounded-2xl bg-white/60 shadow-brand" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-32 rounded-2xl bg-white/60 shadow-sm" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[2fr,1fr]">
        <div className="h-[420px] rounded-2xl bg-white/60 shadow-sm" />
        <div className="h-[420px] rounded-2xl bg-white/60 shadow-sm" />
      </div>
    </div>
  );
}

// ====================================================================
//  MAIN DASHBOARD PAGE — Fleet Operations Command Center
// ====================================================================

export function DashboardPage() {
  const navigate = useNavigate();
  const [lastUpdated, setLastUpdated] = useState<string>(formatDateTimeManila(new Date().toISOString()));
  const [realtimeData, setRealtimeData] = useState<{ moving: number; idling: number } | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);

  const queryOptions = {
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  };

  const summaryQuery = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: fetchDashboardSummary,
    ...queryOptions,
  });

  const chartsQuery = useQuery({
    queryKey: ['dashboard', 'charts'],
    queryFn: fetchDashboardCharts,
    enabled: !!summaryQuery.data,
    ...queryOptions,
  });

  const liveQuery = useQuery({
    queryKey: ['dashboard', 'live'],
    queryFn: fetchDashboardLive,
    enabled: !!summaryQuery.data,
    ...queryOptions,
  });

  const tablesQuery = useQuery({
    queryKey: ['dashboard', 'tables'],
    queryFn: fetchDashboardTables,
    enabled: !!summaryQuery.data,
    ...queryOptions,
  });

  console.log('Dashboard render', { summary: summaryQuery.status, charts: chartsQuery.status, live: liveQuery.status, tables: tablesQuery.status });

  useEffect(() => {
    if (!summaryQuery.data?.realTime) return;
    const { vehiclesMoving, vehiclesIdling } = summaryQuery.data.realTime;
    setRealtimeData({ moving: vehiclesMoving, idling: vehiclesIdling });
    setLastUpdated(formatDateTimeManila(new Date().toISOString()));
  }, [summaryQuery.data?.realTime?.vehiclesMoving, summaryQuery.data?.realTime?.vehiclesIdling]);

  const summary = summaryQuery.data ?? { kpis: emptyDashboardData().kpis, realTime: emptyDashboardData().realTime };
  const charts = chartsQuery.data ?? { charts: emptyDashboardData().charts };
  const live = liveQuery.data ?? { tables: { liveMonitoring: [], activeTrips: [] } };
  const tables = tablesQuery.data ?? { leaderboard: { driverPerformance: [] }, maintenance: { overview: emptyDashboardData().maintenance.overview, trends: [] }, admin: { matchingAccuracy: emptyDashboardData().admin.matchingAccuracy, fleetUtilization: emptyDashboardData().admin.fleetUtilization }, tables: { recentAlerts: [], recentlyCompleted: [] } };

  const liveMonitoring = live.tables.liveMonitoring ?? [];
  const activeTrips = live.tables.activeTrips ?? [];

  console.log('live response', liveQuery.data);
  console.log('liveMonitoring count', liveMonitoring.length);

  const d = {
    kpis: summary.kpis,
    charts: charts.charts,
    tables: {
      liveMonitoring,
      recentlyCompleted: tables.tables.recentlyCompleted ?? [],
      activeTrips,
    },
    leaderboard: tables.leaderboard,
    maintenance: tables.maintenance,
    admin: tables.admin,
    realTime: summary.realTime,
  };
  const k = d.kpis;

  const quickStats = useMemo(() => ({
    totalDistanceToday: k.gps.total_distance_today,
    averageSpeed: k.gps.average_speed_today,
    engineHoursToday: k.gps.engine_hours_today,
    movingHoursToday: k.gps.moving_hours_today,
    fuelAlerts: k.gps.fuel_alerts_today,
  }), [
    k.gps.average_speed_today,
    k.gps.engine_hours_today,
    k.gps.fuel_alerts_today,
    k.gps.moving_hours_today,
    k.gps.total_distance_today,
  ]);

  const vehicleStatusDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    const add = (status: string, amount = 1) => counts.set(status, (counts.get(status) ?? 0) + amount);

    for (const vehicle of liveMonitoring) {
      if (vehicle.under_repair) {
        add('Under Repair');
      } else if (Number(vehicle.speed_kmh ?? vehicle.speed ?? 0) > 0) {
        add('Moving');
      } else if (vehicle.ignition === true) {
        add('Idling');
      } else {
        add('Parked');
      }
    }

    // A registered vehicle absent from the current tracker snapshot is offline.
    const offline = Math.max(0, k.fleet.total_vehicles - liveMonitoring.length);
    if (offline > 0) add('Offline', offline);

    return ['Moving', 'Idling', 'Parked', 'Offline', 'Under Repair']
      .map((name) => ({ name, value: counts.get(name) ?? 0 }))
      .filter((item) => item.value > 0);
  }, [k.fleet.total_vehicles, liveMonitoring]);

  const activeTripCards = useMemo(() => d.tables.activeTrips.slice(0, 6), [d.tables.activeTrips]);

  if (summaryQuery.isLoading) return <LoadingSkeleton />;

  if (summaryQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
        <AlertTriangle className="size-12 text-red-400 mb-4" />
        <p className="text-lg font-bold">Failed to load dashboard</p>
        <p className="text-sm text-zinc-400 mt-1">{(summaryQuery.error as Error)?.message || 'Network error'}</p>
        <button onClick={() => summaryQuery.refetch()} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90">
          <RefreshCw className="size-4" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Hero Section ─────────────────────────────── */}
      <DashboardHero
        lastUpdated={lastUpdated}
        onRefresh={() => {
          summaryQuery.refetch();
          chartsQuery.refetch();
          liveQuery.refetch();
          tablesQuery.refetch();
        }}
      />

      {/* ── Live Fleet Status ────────────────────────── */}
      <LiveFleetCard
        moving={realtimeData?.moving ?? d.realTime.vehiclesMoving}
        idling={realtimeData?.idling ?? d.realTime.vehiclesIdling}
      />

      {/* ── Live Fleet Map ───────────────────────────── */}
      {liveQuery.data ? (
        <Suspense fallback={<div className="h-[520px] rounded-2xl border border-zinc-100 bg-white/80 shadow-sm" />}>
          <FleetMapPanel
            vehicles={d.tables.liveMonitoring}
            selectedVehicleId={selectedVehicleId}
            onSelectVehicle={setSelectedVehicleId}
            onOpenTripDetails={(tripId) => tripId ? navigate(`/gps-logs?tripId=${tripId}`) : undefined}
          />
        </Suspense>
      ) : (
        <div className="h-[520px] rounded-2xl border border-zinc-100 bg-white/80 shadow-sm" />
      )}

      {/* ── Today's Operations KPIs ──────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Car} label="Active Vehicles" value={k.fleet.total_vehicles} status={`${k.fleet.available_vehicles} available`} gradient="bg-gradient-to-br from-brand-pastel/40 to-white" iconColor="bg-brand-teal" onClick={() => navigate('/list?tab=vehicles&filter=active')} />
        <KpiCard icon={Gauge} label="Vehicles Moving" value={realtimeData?.moving ?? d.realTime.vehiclesMoving} status="Currently on the road" gradient="bg-gradient-to-br from-emerald-50 to-white" iconColor="bg-emerald-500" onClick={() => navigate('/gps-logs?tab=tracking&filter=moving')} />
        <KpiCard icon={Radio} label="Vehicles Idling" value={realtimeData?.idling ?? d.realTime.vehiclesIdling} status="Engine running" gradient="bg-gradient-to-br from-amber-50 to-white" iconColor="bg-amber-500" onClick={() => navigate('/gps-logs?tab=tracking&filter=idling')} />
        <KpiCard icon={FileText} label="Travel Orders Today" value={k.travelOrders.completed_today} status={`${k.travelOrders.active_travel_orders} active`} gradient="bg-gradient-to-br from-brand-moss/40 to-white" iconColor="bg-brand-sage" onClick={() => navigate('/travel-orders')} />
      </div>

      <div className="grid gap-4 rounded-2xl border border-zinc-100 bg-white/80 p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl bg-brand-pastel/20 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Total Distance Today</p>
          <p className="mt-1 text-lg font-extrabold text-zinc-900">{fmtKm(quickStats.totalDistanceToday)}</p>
        </div>
        <div className="rounded-xl bg-emerald-50/70 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Average Speed</p>
          <p className="mt-1 text-lg font-extrabold text-zinc-900">{fmtSpeed(quickStats.averageSpeed)}</p>
        </div>
        <div className="rounded-xl bg-amber-50/70 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Engine Hours Today</p>
          <p className="mt-1 text-lg font-extrabold text-zinc-900">{quickStats.engineHoursToday.toFixed(1)}h</p>
        </div>
        <div className="rounded-xl bg-brand-cream/70 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Moving Hours Today</p>
          <p className="mt-1 text-lg font-extrabold text-zinc-900">{quickStats.movingHoursToday.toFixed(1)}h</p>
        </div>
        <div className="rounded-xl bg-red-50/70 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Fuel Alerts</p>
          <p className="mt-1 text-lg font-extrabold text-zinc-900">{quickStats.fuelAlerts}</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
        <DashboardCard title="Active Trip Panel" icon={Navigation}>
          <div className="space-y-3">
            {activeTripCards.length > 0 ? activeTripCards.map((trip) => (
              <div key={trip.id} className="rounded-2xl border border-zinc-100 bg-zinc-50/70 p-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-zinc-900">{trip.plate_number}</p>
                    <p className="text-xs text-zinc-500">Driver: {trip.driver_name}</p>
                  </div>
                  <span className="rounded-full bg-brand-teal/10 px-2.5 py-1 text-[11px] font-semibold text-brand-teal">{trip.status}</span>
                </div>
                <div className="mt-3 grid gap-2 text-sm text-zinc-600 sm:grid-cols-2">
                  <div><span className="font-semibold text-zinc-700">Origin:</span> {trip.origin_location || '—'}</div>
                  <div><span className="font-semibold text-zinc-700">Destination:</span> {trip.destination_target || '—'}</div>
                  <div><span className="font-semibold text-zinc-700">Current Location:</span> {trip.origin_location || '—'}</div>
                  <div><span className="font-semibold text-zinc-700">Elapsed Time:</span> {fmtDuration(trip.scheduled_departure, trip.scheduled_arrival)}</div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="h-2 flex-1 rounded-full bg-brand-cream">
                    <div className="h-2 rounded-full bg-brand-teal transition-all" style={{ width: `${Math.min(100, Math.max(0, (Date.now() - new Date(trip.scheduled_departure || Date.now()).getTime()) / Math.max(1, new Date(trip.scheduled_arrival || Date.now()).getTime() - new Date(trip.scheduled_departure || Date.now()).getTime()) * 100))}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-zinc-500">Progress</span>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
                  <span>GPS: {trip.to_number || '—'}</span>
                  <button onClick={() => navigate(`/gps-logs?tripId=${trip.id}`)} className="inline-flex items-center gap-1 font-semibold text-brand-teal transition hover:text-brand-teal/80">View Details <ChevronRight className="size-3.5" /></button>
                </div>
              </div>
            )) : <EmptyState message="No active trips at the moment" />}
          </div>
        </DashboardCard>

      </div>

      {/* ── Charts Section ───────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <DashboardCard title="Vehicle Status Distribution" icon={Car}>
          {vehicleStatusDistribution.length > 0 ? (
            <DoughnutChart data={vehicleStatusDistribution} />
          ) : (
            <EmptyState message="No vehicle status data" />
          )}
        </DashboardCard>

        <DashboardCard title="Travel Orders by Status" icon={FileText}>
          {d.charts.travelOrdersByStatus.length > 0 ? (
            <StatusBarChart data={d.charts.travelOrdersByStatus} colorMap={TO_STATUS_COLORS} />
          ) : (
            <EmptyState message="No travel order data" />
          )}
        </DashboardCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <DashboardCard title="Total Distance Last 30 Days" icon={Route}>
          {d.charts.distanceLast30Days.length > 0 ? (
            <DistanceLineChart data={d.charts.distanceLast30Days as any} />
          ) : (
            <EmptyState message="No distance data" />
          )}
        </DashboardCard>

        <DashboardCard title="Trips Per Day Last 30 Days" icon={Activity}>
          {d.charts.tripsPerDay.length > 0 ? (
            <TripsAreaChart data={d.charts.tripsPerDay as any} />
          ) : (
            <EmptyState message="No trip data" />
          )}
        </DashboardCard>
      </div>

      {/* ── Operations Tables ────────────────────────── */}
      <div className="grid gap-6">

        <DashboardCard title="Live Vehicle Monitoring" icon={Radio}>
          {d.tables.liveMonitoring.length > 0 ? (
            <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-brand-cream text-xs font-bold uppercase tracking-wider text-zinc-500">
                    <th className="pb-2 pr-3">Plate #</th>
                    <th className="pb-2 pr-3">Driver</th>
                    <th className="pb-2 pr-3">TO #</th>
                    <th className="pb-2 pr-3">Origin</th>
                    <th className="pb-2 pr-3">Destination</th>
                    <th className="pb-2 pr-3">Departure</th>
                    <th className="pb-2 pr-3">Arrival</th>
                    <th className="pb-2 pr-3">Status</th>
                    <th className="pb-2 text-right">Distance</th>
                  </tr>
                </thead>
                <tbody>
                  {d.tables.liveMonitoring.map((row) => (
                    <tr key={row.vehicle_id} className="border-b border-brand-cream/60 hover:bg-brand-cream/20">
                      <td className="py-2.5 pr-3 font-bold text-zinc-900">{row.plate_number}</td>
                      <td className="py-2.5 pr-3 text-zinc-600">{row.driver_name}</td>
                      <td className="py-2.5 pr-3 text-zinc-600">{row.current_travel_order || '—'}</td>
                      <td className="py-2.5 pr-3 text-zinc-600">{row.origin || '—'}</td>
                      <td className="py-2.5 pr-3 text-zinc-600">{row.destination || '—'}</td>
                      <td className="py-2.5 pr-3 text-zinc-600">{formatDateTimeManila(row.departure_time)}</td>
                      <td className="py-2.5 pr-3 text-zinc-600">{formatDateTimeManila(row.arrival_time)}</td>
                      <td className="py-2.5 pr-3"><StatusBadge status={row.trip_status || 'N/A'} /></td>
                      <td className="py-2.5 text-right text-zinc-600">{fmtKm(row.distance_traveled)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 md:hidden">
              {d.tables.liveMonitoring.map((row) => (
                <article key={row.vehicle_id} className="overflow-hidden rounded-xl border border-zinc-100 bg-zinc-50/60">
                  <div className="flex items-start justify-between gap-3 border-b border-zinc-100 bg-brand-cream/50 px-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-base font-extrabold text-zinc-900">{row.plate_number}</p>
                      <p className="mt-0.5 truncate text-xs text-zinc-500">{row.driver_name || 'Unassigned driver'}</p>
                    </div>
                    <StatusBadge status={row.trip_status || 'N/A'} />
                  </div>
                  <dl className="space-y-3 px-3 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="shrink-0 text-xs text-zinc-400">Travel order</dt>
                      <dd className="min-w-0 truncate font-medium text-brand-teal">{row.current_travel_order || '—'}</dd>
                    </div>
                    <div className="grid grid-cols-[auto,minmax(0,1fr)] gap-x-3 gap-y-2">
                      <dt className="text-xs text-zinc-400">From</dt>
                      <dd className="min-w-0 break-words text-right text-zinc-700">{row.origin || '—'}</dd>
                      <dt className="text-xs text-zinc-400">To</dt>
                      <dd className="min-w-0 break-words text-right text-zinc-700">{row.destination || '—'}</dd>
                    </div>
                    <div className="grid grid-cols-2 gap-3 border-t border-zinc-100 pt-3">
                      <div><dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Departure</dt><dd className="mt-1 text-xs text-zinc-700">{formatDateTimeManila(row.departure_time)}</dd></div>
                      <div><dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Arrival</dt><dd className="mt-1 text-xs text-zinc-700">{formatDateTimeManila(row.arrival_time)}</dd></div>
                    </div>
                    <div className="flex items-center justify-between border-t border-zinc-100 pt-3">
                      <dt className="text-xs font-medium text-zinc-500">Distance traveled</dt>
                      <dd className="font-mono font-bold text-zinc-900">{fmtKm(row.distance_traveled)}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
            </>
          ) : (
            <EmptyState message="No active vehicles currently being monitored" />
          )}
        </DashboardCard>


        <DashboardCard title="Recently Completed Trips" icon={CheckCircle2}>
          {d.tables.recentlyCompleted.length > 0 ? (
            <>
            <div className={cn(tableContainerClass, 'hidden md:block')}>
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <thead>
                    <tr className={tableHeaderClass}>
                      <th className={tableHeaderCellClass}>Record No.</th>
                      <th className={tableHeaderCellClass}>Vehicle</th>
                      <th className={tableHeaderCellClass}>Driver</th>
                      <th className={tableHeaderCellClass}>Type</th>
                      <th className={tableHeaderCellClass}>Distance</th>
                      <th className={tableHeaderCellClass}>Engine Hrs</th>
                      <th className={tableHeaderCellClass}>Moving Hrs</th>
                      <th className={tableHeaderCellClass}>Arrival</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.tables.recentlyCompleted.map((trip) => (
                      <tr key={trip.id} className={tableRowClass}>
                        <td className={tableCellClass}>{trip.record_no}</td>
                        <td className={tableCellClass}>{trip.plate_number || 'Unknown vehicle'}</td>
                        <td className={tableCellClass}>{trip.driver_name || 'Unassigned driver'}</td>
                        <td className={tableCellClass}>
                          <span className={cn(
                            'rounded-full px-2 py-0.5 text-xs font-bold',
                            trip.trip_type === 'travel_order'
                              ? 'bg-brand-moss/30 text-brand-teal'
                              : 'bg-amber-100 text-amber-700',
                          )}>
                            {trip.trip_type === 'travel_order' ? 'Travel Order' : 'No Travel Order'}
                          </span>
                        </td>
                        <td className={tableCellClass}>{trip.gps_distance_km !== null ? fmtKm(trip.gps_distance_km) : '—'}</td>
                        <td className={tableCellClass}>{trip.engine_hours !== null ? `${trip.engine_hours.toFixed(1)}h` : '—'}</td>
                        <td className={tableCellClass}>{trip.moving_hours !== null ? `${trip.moving_hours.toFixed(1)}h` : '—'}</td>
                        <td className={tableCellClass}>{formatDateTimeManila(trip.arrival_time_gps)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="space-y-3 md:hidden">
              {d.tables.recentlyCompleted.map((trip) => (
                <article key={trip.id} className="rounded-xl border border-zinc-100 bg-zinc-50/60 p-3">
                  <div className="flex items-start justify-between gap-3 border-b border-zinc-100 pb-3">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-bold text-brand-teal">{trip.record_no}</p>
                      <p className="mt-0.5 truncate text-xs text-zinc-500">{trip.driver_name || 'Unassigned driver'}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-mono text-sm font-bold text-zinc-900">{trip.plate_number || 'Unknown vehicle'}</p>
                      <span className={cn(
                        'mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold',
                        trip.trip_type === 'travel_order'
                          ? 'bg-brand-moss/30 text-brand-teal'
                          : 'bg-amber-100 text-amber-700',
                      )}>
                        {trip.trip_type === 'travel_order' ? 'Travel Order' : 'No Travel Order'}
                      </span>
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
                    <div><dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Distance</dt><dd className="mt-0.5 font-medium text-zinc-800">{trip.gps_distance_km !== null ? fmtKm(trip.gps_distance_km) : '—'}</dd></div>
                    <div><dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Engine hours</dt><dd className="mt-0.5 font-medium text-zinc-800">{trip.engine_hours !== null ? `${trip.engine_hours.toFixed(1)}h` : '—'}</dd></div>
                    <div><dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Moving hours</dt><dd className="mt-0.5 font-medium text-zinc-800">{trip.moving_hours !== null ? `${trip.moving_hours.toFixed(1)}h` : '—'}</dd></div>
                    <div><dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Arrival</dt><dd className="mt-0.5 text-xs text-zinc-700">{formatDateTimeManila(trip.arrival_time_gps)}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
            </>
          ) : (
            <EmptyState message="No recently completed trips" />
          )}
        </DashboardCard>

        <DashboardCard title="Driver Performance Leaderboard" icon={Users}>
          {d.leaderboard.driverPerformance.length > 0 ? (
            <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-brand-cream text-xs font-bold uppercase tracking-wider text-zinc-500">
                    <th className="pb-2 pr-3">#</th>
                    <th className="pb-2 pr-3">Driver</th>
                    <th className="pb-2 pr-3">Trips</th>
                    <th className="pb-2 pr-3">Distance</th>
                    <th className="pb-2 pr-3">Avg Speed</th>
                    <th className="pb-2 pr-3">On-Time</th>
                    <th className="pb-2">Violations</th>
                  </tr>
                </thead>
                <tbody>
                  {d.leaderboard.driverPerformance.map((driver, idx) => (
                    <tr key={driver.driver_id} className={cn('border-b border-brand-cream/60 hover:bg-brand-cream/20', idx < 3 && 'bg-amber-50/20')}>
                      <td className="py-2.5 pr-3">
                        <span className={cn('inline-flex size-7 items-center justify-center rounded-full text-xs font-bold', idx === 0 ? 'bg-yellow-100 text-yellow-700' : idx === 1 ? 'bg-zinc-100 text-zinc-600' : idx === 2 ? 'bg-orange-100 text-orange-700' : 'text-zinc-400')}>
                          {idx + 1}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 font-bold text-zinc-900">{driver.driver_name}</td>
                      <td className="py-2.5 pr-3 text-zinc-600">{driver.total_trips}</td>
                      <td className="py-2.5 pr-3 text-zinc-600">{fmtKm(driver.total_distance)}</td>
                      <td className="py-2.5 pr-3 text-zinc-600">{fmtSpeed(driver.avg_speed)}</td>
                      <td className="py-2.5 pr-3 text-zinc-600">{driver.on_time_arrivals}</td>
                      <td className="py-2.5 pr-3">
                        <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold', driver.gps_violations > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700')}>
                          {driver.gps_violations}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 md:hidden">
              {d.leaderboard.driverPerformance.map((driver, idx) => (
                <article key={driver.driver_id} className={cn('rounded-xl border border-zinc-100 p-3', idx < 3 ? 'bg-amber-50/40' : 'bg-zinc-50/60')}>
                  <div className="flex items-center gap-3 border-b border-zinc-100 pb-3">
                    <span className={cn('inline-flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold', idx === 0 ? 'bg-yellow-100 text-yellow-700' : idx === 1 ? 'bg-zinc-200 text-zinc-700' : idx === 2 ? 'bg-orange-100 text-orange-700' : 'bg-white text-zinc-500 ring-1 ring-zinc-200')}>
                      {idx + 1}
                    </span>
                    <p className="min-w-0 flex-1 truncate font-bold text-zinc-900">{driver.driver_name}</p>
                    <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold', driver.gps_violations > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700')}>
                      {driver.gps_violations} violations
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div><dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Trips</dt><dd className="mt-0.5 font-bold text-zinc-800">{driver.total_trips}</dd></div>
                    <div><dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Distance</dt><dd className="mt-0.5 font-bold text-zinc-800">{fmtKm(driver.total_distance)}</dd></div>
                    <div><dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Average speed</dt><dd className="mt-0.5 font-bold text-zinc-800">{fmtSpeed(driver.avg_speed)}</dd></div>
                    <div><dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">On-time arrivals</dt><dd className="mt-0.5 font-bold text-zinc-800">{driver.on_time_arrivals}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
            </>
          ) : (
            <EmptyState message="No driver performance data" />
          )}
        </DashboardCard>
      </div>

      {/* ── Maintenance + Admin Section ─────────────── */}
      <div className="grid gap-6 lg:grid-cols-3">
        <DashboardCard title="Maintenance Overview" icon={Wrench} className="lg:col-span-1">
          <div className="space-y-3">
            <MetricRow label="Scheduled" value={d.maintenance.overview.scheduled_maintenance} />
            <MetricRow label="Overdue" value={<span className="text-red-600">{d.maintenance.overview.overdue_maintenance}</span>} className="bg-red-50/60" />
            <MetricRow label="This Month" value={<span className="text-blue-600">{d.maintenance.overview.maintenance_this_month}</span>} className="bg-blue-50/60" />
            <MetricRow label="Total Cost (Month)" value={<span className="text-brand-teal">{fmtCost(d.maintenance.overview.maintenance_cost)}</span>} className="bg-brand-teal/5" />
          </div>
        </DashboardCard>

        <DashboardCard title="Maintenance Trends by Month" icon={BarChart3} className="lg:col-span-2">
          {d.maintenance.trends.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={d.maintenance.trends} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E6EEC9" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtCost(v)} />
                <ReTooltip formatter={(value: any, name: any) => [name === 'count' ? Number(value) : fmtCost(Number(value)), name === 'count' ? 'Records' : 'Cost']} />
                <Bar yAxisId="left" dataKey="count" fill={COLORS.moss} radius={[4, 4, 0, 0]} name="count" />
                <Bar yAxisId="right" dataKey="total_cost" fill={COLORS.teal} radius={[4, 4, 0, 0]} name="total_cost" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No maintenance trend data" />
          )}
        </DashboardCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <DashboardCard title="Travel Order Matching Accuracy" icon={ShieldCheck}>
          <div className="space-y-3">
            <MetricRow label="GPS Logs Linked to TO" value={<span className="font-bold text-brand-teal">{d.admin.matchingAccuracy.gps_logs_linked_to_to}</span>} />
            <MetricRow label="GPS Logs Without TO" value={<span className="font-bold text-amber-600">{d.admin.matchingAccuracy.gps_logs_without_to}</span>} className="bg-amber-50/60" />
            <MetricRow label="Auto-Matched Trips" value={<span className="font-bold text-green-600">{d.admin.matchingAccuracy.auto_matched_trips}</span>} className="bg-green-50/60" />
            <MetricRow label="Manual Corrections" value={<span className="font-bold text-blue-600">{d.admin.matchingAccuracy.manual_corrections}</span>} className="bg-blue-50/60" />
          </div>
        </DashboardCard>

        <DashboardCard title="Fleet Utilization" icon={BarChart3}>
          <div className="space-y-5">
            <ProgressMetric label="Daily Utilization" value={d.admin.fleetUtilization.daily_utilization} color="bg-brand-teal" />
            <ProgressMetric label="Weekly Utilization" value={d.admin.fleetUtilization.weekly_utilization} color="bg-brand-sage" />
            <ProgressMetric label="Monthly Utilization" value={d.admin.fleetUtilization.monthly_utilization} color="bg-brand-moss" />
          </div>
        </DashboardCard>
      </div>

      {/* ── Footer Note ─────────────────────────────── */}
      <div className="text-center text-xs text-zinc-400">
        Data refreshes every 60 seconds · Last updated: {lastUpdated}
      </div>
    </div>
  );
}

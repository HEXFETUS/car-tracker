import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Car, CheckCircle2, Wrench, AlertTriangle,
  Route, Radio,
  Navigation, RefreshCw,
  Users, FileText, BarChart3, Bell,
  PlusCircle, UserPlus, Activity, Download,
  ShieldCheck, Sparkles,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip as ReTooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line, AreaChart, Area,
} from 'recharts';
import { cn } from '@/shared/lib/utils';
import { fetchDashboardData } from '../api/dashboard-api';

// ── Color Palette ─────────────────────────────────────────────
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

// ── Formatting Helpers ────────────────────────────────────────
function fmtKm(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K km';
  return n.toFixed(0) + ' km';
}

function fmtPct(n: number): string {
  return n.toFixed(1) + '%';
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtSpeed(n: number): string {
  return n.toFixed(0) + ' km/h';
}

function fmtCost(n: number): string {
  return '₱' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Section Card Wrapper ──────────────────────────────────────
function SectionCard({ title, icon: Icon, children, className }: {
  title: string;
  icon?: React.ElementType;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl bg-white p-5 shadow-brand', className)}>
      {title && (
        <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-zinc-900">
          {Icon && <Icon className="size-4.5 text-brand-teal" />}
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}

// ── Doughnut Chart ────────────────────────────────────────────
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
            {data.map((_, i) => (
              <Cell key={i} fill={DOUGHNUT_COLORS[i % DOUGHNUT_COLORS.length]} />
            ))}
          </Pie>
          <ReTooltip formatter={(value: any, name: any) => [`${value} (${total > 0 ? ((Number(value) / total) * 100).toFixed(1) : 0}%)`, name]} />
        </PieChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        {data.map((d, i) => (
          <div key={d.name} className="flex items-center gap-1.5">
            <div
              className="size-3 rounded-sm"
              style={{ backgroundColor: DOUGHNUT_COLORS[i % DOUGHNUT_COLORS.length] }}
            />
            <span className="text-xs text-zinc-600">{d.name}: {d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Bar Chart ─────────────────────────────────────────────────
function StatusBarChart({ data, colorMap }: {
  data: { name: string; value: number }[];
  colorMap: Record<string, string>;
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
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

// ── Line Chart ────────────────────────────────────────────────
function DistanceLineChart({ data }: { data: { date: string; total_distance: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E6EEC9" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11 }}
          tickFormatter={(d: string) => d.slice(5)}
        />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(0) + 'km'} />
        <ReTooltip formatter={(value: any) => [Number(value).toFixed(1) + ' km', 'Distance']} />
        <Line
          type="monotone"
          dataKey="total_distance"
          stroke={COLORS.teal}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: COLORS.teal }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Area Chart ────────────────────────────────────────────────
function TripsAreaChart({ data }: { data: { date: string; trips: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E6EEC9" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11 }}
          tickFormatter={(d: string) => d.slice(5)}
        />
        <YAxis tick={{ fontSize: 11 }} />
        <ReTooltip formatter={(value: any) => [Number(value), 'Trips']} />
        <Area
          type="monotone"
          dataKey="trips"
          stroke={COLORS.sage}
          fill={COLORS.moss}
          fillOpacity={0.6}
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Alert Color Badge ─────────────────────────────────────────
function AlertBadge({ type }: { type: string }) {
  const colorMap: Record<string, string> = {
    IGNITION_ON: 'bg-blue-100 text-blue-700',
    IGNITION_OFF: 'bg-orange-100 text-orange-700',
    IDLING: 'bg-red-100 text-red-700',
    NO_APPROVED_TRAVEL_ORDER: 'bg-purple-100 text-purple-700',
  };
  const severity: Record<string, string> = {
    IGNITION_ON: 'bg-blue-500',
    IGNITION_OFF: 'bg-orange-500',
    IDLING: 'bg-red-500',
    NO_APPROVED_TRAVEL_ORDER: 'bg-purple-500',
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block size-2 rounded-full', severity[type] || 'bg-zinc-400')} />
      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', colorMap[type] || 'bg-zinc-100 text-zinc-700')}>
        {type.replace(/_/g, ' ')}
      </span>
    </span>
  );
}

// ── Quick Action Button ───────────────────────────────────────
function QuickAction({ icon: Icon, label, onClick }: {
  icon: React.ElementType;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg border border-brand-moss/50 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-all hover:bg-brand-cream hover:text-brand-teal hover:border-brand-teal/30"
    >
      <Icon className="size-4 text-brand-teal" />
      {label}
    </button>
  );
}

// ── Real-Time Indicator ───────────────────────────────────────
function RealtimeBadge({ moving, idling }: { moving: number; idling: number }) {
  return (
    <div className="flex items-center gap-4 rounded-lg bg-brand-cream px-4 py-2 text-sm">
      <span className="flex items-center gap-1.5">
        <span className="relative flex size-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex size-3 rounded-full bg-emerald-500" />
        </span>
        <span className="font-medium text-emerald-700">{moving} Moving</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="relative flex size-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex size-3 rounded-full bg-amber-500" />
        </span>
        <span className="font-medium text-amber-700">{idling} Idling</span>
      </span>
    </div>
  );
}

// ── Status Badge ──────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: 'bg-emerald-100 text-emerald-700',
    APPROVED: 'bg-blue-100 text-blue-700',
    COMPLETED: 'bg-green-100 text-green-700',
    CANCELLED: 'bg-red-100 text-red-700',
    PENDING: 'bg-amber-100 text-amber-700',
    FOR_APPROVAL: 'bg-purple-100 text-purple-700',
    FOR_REQUEST: 'bg-zinc-100 text-zinc-700',
  };
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', colors[status] || 'bg-zinc-100 text-zinc-700')}>
      {status}
    </span>
  );
}

// ── Loading Skeleton ──────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-white/60 shadow-brand" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-80 rounded-xl bg-white/60 shadow-brand" />
        <div className="h-80 rounded-xl bg-white/60 shadow-brand" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-72 rounded-xl bg-white/60 shadow-brand" />
        <div className="h-72 rounded-xl bg-white/60 shadow-brand" />
      </div>
      <div className="h-96 rounded-xl bg-white/60 shadow-brand" />
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-8 text-sm text-zinc-400">
      <AlertTriangle className="mr-2 size-4" />
      {message}
    </div>
  );
}

// ====================================================================
//  MAIN DASHBOARD PAGE
// ====================================================================

export function DashboardPage() {
  const navigate = useNavigate();
  const [realtimeData, setRealtimeData] = useState<{ moving: number; idling: number } | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboardData,
    refetchInterval: 60_000, // auto-refresh every 60s
  });

  // Real-time section separate refetch every 30s
  useEffect(() => {
    if (!data) return;
    setRealtimeData({
      moving: data.realTime.vehiclesMoving,
      idling: data.realTime.vehiclesIdling,
    });
  }, [data]);

  if (isLoading) return <LoadingSkeleton />;
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
        <AlertTriangle className="size-12 text-red-400 mb-4" />
        <p className="text-lg font-medium">Failed to load dashboard</p>
        <p className="text-sm text-zinc-400 mt-1">{(error as Error)?.message || 'Network error'}</p>
        <button
          onClick={() => refetch()}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-teal px-4 py-2 text-sm text-white hover:bg-brand-teal/80"
        >
          <RefreshCw className="size-4" />
          Retry
        </button>
      </div>
    );
  }

  const d = data!;

  return (
    <div className="space-y-6">

      {/* ── Real-Time Status Banner ─────────────────────── */}
      <div className="flex items-center justify-between rounded-xl bg-white p-4 shadow-brand">
        <div className="flex items-center gap-3">
          <Radio className="size-5 text-brand-teal" />
          <span className="text-sm font-medium text-zinc-900">Live Fleet Status</span>
          <RealtimeBadge
            moving={realtimeData?.moving ?? d.realTime.vehiclesMoving}
            idling={realtimeData?.idling ?? d.realTime.vehiclesIdling}
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <RefreshCw className="size-3 animate-spin" />
          Auto-refreshes every 60s
        </div>
      </div>

      {/* ── Row 2: Fleet Status Distribution + Row 3: Travel Order Bar ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Fleet Status Distribution" icon={Car}>
          {d.charts.vehicleStatusDistribution.length > 0 ? (
            <DoughnutChart data={d.charts.vehicleStatusDistribution} />
          ) : (
            <EmptyState message="No vehicle status data available" />
          )}
        </SectionCard>

        <SectionCard title="Travel Orders by Status" icon={FileText}>
          {d.charts.travelOrdersByStatus.length > 0 ? (
            <StatusBarChart data={d.charts.travelOrdersByStatus} colorMap={TO_STATUS_COLORS} />
          ) : (
            <EmptyState message="No travel order data available" />
          )}
        </SectionCard>
      </div>

      {/* ── Row 4: GPS Operations — Distance & Trips ──── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Total Distance Traveled (Last 30 Days)" icon={Route}>
          {d.charts.distanceLast30Days.length > 0 ? (
            <DistanceLineChart data={d.charts.distanceLast30Days as any} />
          ) : (
            <EmptyState message="No distance data available" />
          )}
        </SectionCard>

        <SectionCard title="Trips Per Day (Last 30 Days)" icon={Activity}>
          {d.charts.tripsPerDay.length > 0 ? (
            <TripsAreaChart data={d.charts.tripsPerDay as any} />
          ) : (
            <EmptyState message="No trip data available" />
          )}
        </SectionCard>
      </div>

      {/* ── Active Trips (Real-Time) ──────────────────── */}
      <SectionCard title="Active Trips" icon={Navigation}>
        {d.tables.activeTrips.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-brand-cream text-xs font-medium uppercase text-zinc-400">
                  <th className="pb-2 pr-3">TO #</th>
                  <th className="pb-2 pr-3">Vehicle</th>
                  <th className="pb-2 pr-3">Driver</th>
                  <th className="pb-2 pr-3">Origin</th>
                  <th className="pb-2 pr-3">Destination</th>
                  <th className="pb-2 pr-3">Departure</th>
                  <th className="pb-2 pr-3">Arrival</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {d.tables.activeTrips.map((trip) => (
                  <tr key={trip.id} className="border-b border-brand-cream/60 hover:bg-brand-cream/30">
                    <td className="py-2.5 pr-3 font-medium text-zinc-900">{trip.to_number}</td>
                    <td className="py-2.5 pr-3 text-zinc-600">{trip.plate_number}</td>
                    <td className="py-2.5 pr-3 text-zinc-600">{trip.driver_name}</td>
                    <td className="py-2.5 pr-3 text-zinc-600">{trip.origin_location}</td>
                    <td className="py-2.5 pr-3 text-zinc-600">{trip.destination_target}</td>
                    <td className="py-2.5 pr-3 text-zinc-600">{fmtTime(trip.scheduled_departure)}</td>
                    <td className="py-2.5 pr-3 text-zinc-600">{fmtTime(trip.scheduled_arrival)}</td>
                    <td className="py-2.5"><StatusBadge status={trip.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="No active trips at the moment" />
        )}
      </SectionCard>

      {/* ── Row 5: Live Vehicle Monitoring ────────────── */}
      <SectionCard title="Live Vehicle Monitoring" icon={Radio}>
        {d.tables.liveMonitoring.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-brand-cream text-xs font-medium uppercase text-zinc-400">
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
                  <tr key={row.vehicle_id} className="border-b border-brand-cream/60 hover:bg-brand-cream/30">
                    <td className="py-2.5 pr-3 font-medium text-zinc-900">{row.plate_number}</td>
                    <td className="py-2.5 pr-3 text-zinc-600">{row.driver_name}</td>
                    <td className="py-2.5 pr-3 text-zinc-600">{row.current_travel_order || '—'}</td>
                    <td className="py-2.5 pr-3 text-zinc-600">{row.origin || '—'}</td>
                    <td className="py-2.5 pr-3 text-zinc-600">{row.destination || '—'}</td>
                    <td className="py-2.5 pr-3 text-zinc-600">{fmtTime(row.departure_time)}</td>
                    <td className="py-2.5 pr-3 text-zinc-600">{fmtTime(row.arrival_time)}</td>
                    <td className="py-2.5 pr-3"><StatusBadge status={row.trip_status || 'N/A'} /></td>
                    <td className="py-2.5 text-right text-zinc-600">{fmtKm(row.distance_traveled)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="No active vehicles currently being monitored" />
        )}
      </SectionCard>

      {/* ── Row 6: GPS Alert Center ───────────────────── */}
      <SectionCard title="GPS Alert Center" icon={Bell}>
        {d.tables.recentAlerts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-brand-cream text-xs font-medium uppercase text-zinc-400">
                  <th className="pb-2 pr-3">Time</th>
                  <th className="pb-2 pr-3">Vehicle</th>
                  <th className="pb-2 pr-3">Alert Type</th>
                  <th className="pb-2 pr-3">Message</th>
                  <th className="pb-2 pr-3">Location</th>
                  <th className="pb-2">GPS Record</th>
                </tr>
              </thead>
              <tbody>
                {d.tables.recentAlerts.map((alert) => (
                  <tr key={alert.id} className="border-b border-brand-cream/60 hover:bg-brand-cream/30">
                    <td className="py-2.5 pr-3 text-xs text-zinc-500">{fmtTime(alert.time)}</td>
                    <td className="py-2.5 pr-3 font-medium text-zinc-900">{alert.vehicle}</td>
                    <td className="py-2.5 pr-3"><AlertBadge type={alert.alert_type} /></td>
                    <td className="py-2.5 pr-3 max-w-xs truncate text-zinc-600">{alert.alert_message}</td>
                    <td className="py-2.5 pr-3 text-xs text-zinc-500">{alert.location}</td>
                    <td className="py-2.5 text-xs text-zinc-500">{alert.gps_record_no || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="No recent GPS alerts" />
        )}
      </SectionCard>

      {/* ── Recently Completed Trips ───────────────────── */}
      <SectionCard title="Recently Completed Trips" icon={CheckCircle2}>
        {d.tables.recentlyCompleted.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-brand-cream text-xs font-medium uppercase text-zinc-400">
                  <th className="pb-2 pr-3">Date</th>
                  <th className="pb-2 pr-3">Vehicle</th>
                  <th className="pb-2 pr-3">Driver</th>
                  <th className="pb-2 pr-3">Origin</th>
                  <th className="pb-2 pr-3">Destination</th>
                  <th className="pb-2 pr-3">Arrival</th>
                  <th className="pb-2 pr-3">Distance</th>
                  <th className="pb-2">Max Speed</th>
                </tr>
              </thead>
              <tbody>
                {d.tables.recentlyCompleted.map((trip) => (
                  <tr key={trip.id} className="border-b border-brand-cream/60 hover:bg-brand-cream/30">
                    <td className="py-2.5 pr-3 text-zinc-600">{trip.trip_date}</td>
                    <td className="py-2.5 pr-3 font-medium text-zinc-900">{trip.plate_number}</td>
                    <td className="py-2.5 pr-3 text-zinc-600">{trip.driver_name}</td>
                    <td className="py-2.5 pr-3 max-w-[120px] truncate text-zinc-600">{trip.origin}</td>
                    <td className="py-2.5 pr-3 max-w-[120px] truncate text-zinc-600">{trip.destination}</td>
                    <td className="py-2.5 pr-3 text-zinc-600 text-xs">{fmtTime(trip.arrival_time_gps)}</td>
                    <td className="py-2.5 pr-3 text-zinc-600">{trip.gps_distance_km ? fmtKm(trip.gps_distance_km) : '—'}</td>
                    <td className="py-2.5 text-zinc-600">{trip.max_speed_kph ? fmtSpeed(trip.max_speed_kph) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="No recently completed trips in the last 24 hours" />
        )}
      </SectionCard>

      {/* ── Row 7: Driver Performance Leaderboard ──────── */}
      <SectionCard title="Driver Performance Leaderboard" icon={Users}>
        {d.leaderboard.driverPerformance.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-brand-cream text-xs font-medium uppercase text-zinc-400">
                  <th className="pb-2 pr-3">#</th>
                  <th className="pb-2 pr-3">Driver</th>
                  <th className="pb-2 pr-3">Total Trips</th>
                  <th className="pb-2 pr-3">Total Distance</th>
                  <th className="pb-2 pr-3">Avg Speed</th>
                  <th className="pb-2 pr-3">On-Time Arrivals</th>
                  <th className="pb-2">GPS Violations</th>
                </tr>
              </thead>
              <tbody>
                {d.leaderboard.driverPerformance.map((driver, idx) => (
                  <tr key={driver.driver_id} className={cn(
                    'border-b border-brand-cream/60 hover:bg-brand-cream/30',
                    idx < 3 && 'bg-amber-50/50'
                  )}>
                    <td className="py-2.5 pr-3">
                      <span className={cn(
                        'inline-flex size-6 items-center justify-center rounded-full text-xs font-bold',
                        idx === 0 ? 'bg-yellow-100 text-yellow-700' :
                          idx === 1 ? 'bg-zinc-100 text-zinc-600' :
                            idx === 2 ? 'bg-orange-100 text-orange-700' :
                              'text-zinc-400'
                      )}>
                        {idx + 1}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 font-medium text-zinc-900">{driver.driver_name}</td>
                    <td className="py-2.5 pr-3 text-zinc-600">{driver.total_trips}</td>
                    <td className="py-2.5 pr-3 text-zinc-600">{fmtKm(driver.total_distance)}</td>
                    <td className="py-2.5 pr-3 text-zinc-600">{fmtSpeed(driver.avg_speed)}</td>
                    <td className="py-2.5 pr-3 text-zinc-600">{driver.on_time_arrivals}</td>
                    <td className="py-2.5">
                      <span className={cn(
                        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                        driver.gps_violations > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                      )}>
                        {driver.gps_violations}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="No driver performance data available" />
        )}
      </SectionCard>

      {/* ── Row 8: Maintenance Overview ───────────────── */}
      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard title="Maintenance Overview" icon={Wrench} className="lg:col-span-1">
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg bg-brand-cream/60 px-4 py-3">
              <span className="text-sm text-zinc-600">Scheduled</span>
              <span className="text-lg font-bold text-zinc-900">{d.maintenance.overview.scheduled_maintenance}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-red-50 px-4 py-3">
              <span className="text-sm text-red-600">Overdue</span>
              <span className="text-lg font-bold text-red-600">{d.maintenance.overview.overdue_maintenance}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-blue-50 px-4 py-3">
              <span className="text-sm text-blue-600">This Month</span>
              <span className="text-lg font-bold text-blue-600">{d.maintenance.overview.maintenance_this_month}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-brand-teal/10 px-4 py-3">
              <span className="text-sm text-brand-teal">Total Cost (Month)</span>
              <span className="text-lg font-bold text-brand-teal">{fmtCost(d.maintenance.overview.maintenance_cost)}</span>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Maintenance Trends by Month" icon={BarChart3} className="lg:col-span-2">
          {d.maintenance.trends.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={d.maintenance.trends} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E6EEC9" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtCost(v)} />
                <ReTooltip formatter={(value: any, name: any) => [
                  name === 'count' ? Number(value) : fmtCost(Number(value)),
                  name === 'count' ? 'Records' : 'Cost'
                ]} />
                <Bar yAxisId="left" dataKey="count" fill={COLORS.moss} radius={[4, 4, 0, 0]} name="count" />
                <Bar yAxisId="right" dataKey="total_cost" fill={COLORS.teal} radius={[4, 4, 0, 0]} name="total_cost" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No maintenance trend data available" />
          )}
        </SectionCard>
      </div>

      {/* ── Quick Actions ─────────────────────────────── */}
      <SectionCard title="Quick Actions" icon={Sparkles}>
        <div className="flex flex-wrap gap-3">
          <QuickAction icon={PlusCircle} label="Create Travel Order" onClick={() => navigate('/travel-orders')} />
          <QuickAction icon={UserPlus} label="Assign Driver" onClick={() => navigate('/travel-orders')} />
          <QuickAction icon={PlusCircle} label="Register Vehicle" onClick={() => navigate('/list')} />
          <QuickAction icon={RefreshCw} label="Sync GPS History" onClick={() => navigate('/gps-logs')} />
          <QuickAction icon={Navigation} label="View Active Trips" />
          <QuickAction icon={Download} label="Generate Reports" onClick={() => navigate('/reports')} />
        </div>
      </SectionCard>

      {/* ── Admin Widgets ─────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Travel Order Matching Accuracy" icon={ShieldCheck}>
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-brand-cream/60 px-4 py-2.5">
              <span className="text-sm text-zinc-600">GPS Logs Linked to TO</span>
              <span className="font-semibold text-brand-teal">{d.admin.matchingAccuracy.gps_logs_linked_to_to}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-amber-50 px-4 py-2.5">
              <span className="text-sm text-amber-600">GPS Logs Without TO</span>
              <span className="font-semibold text-amber-600">{d.admin.matchingAccuracy.gps_logs_without_to}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-green-50 px-4 py-2.5">
              <span className="text-sm text-green-600">Auto-Matched Trips</span>
              <span className="font-semibold text-green-600">{d.admin.matchingAccuracy.auto_matched_trips}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-blue-50 px-4 py-2.5">
              <span className="text-sm text-blue-600">Manual Corrections</span>
              <span className="font-semibold text-blue-600">{d.admin.matchingAccuracy.manual_corrections}</span>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Fleet Utilization" icon={BarChart3}>
          <div className="space-y-4">
            <div>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-zinc-600">Daily Utilization</span>
                <span className="font-semibold text-zinc-900">{fmtPct(d.admin.fleetUtilization.daily_utilization)}</span>
              </div>
              <div className="h-2.5 rounded-full bg-brand-cream">
                <div
                  className="h-2.5 rounded-full bg-brand-teal transition-all"
                  style={{ width: `${Math.min(d.admin.fleetUtilization.daily_utilization, 100)}%` }}
                />
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-zinc-600">Weekly Utilization</span>
                <span className="font-semibold text-zinc-900">{fmtPct(d.admin.fleetUtilization.weekly_utilization)}</span>
              </div>
              <div className="h-2.5 rounded-full bg-brand-cream">
                <div
                  className="h-2.5 rounded-full bg-brand-sage transition-all"
                  style={{ width: `${Math.min(d.admin.fleetUtilization.weekly_utilization, 100)}%` }}
                />
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-zinc-600">Monthly Utilization</span>
                <span className="font-semibold text-zinc-900">{fmtPct(d.admin.fleetUtilization.monthly_utilization)}</span>
              </div>
              <div className="h-2.5 rounded-full bg-brand-cream">
                <div
                  className="h-2.5 rounded-full bg-brand-moss transition-all"
                  style={{ width: `${Math.min(d.admin.fleetUtilization.monthly_utilization, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* ── Footer Note ───────────────────────────────── */}
      <div className="text-center text-xs text-zinc-400">
        Data refreshes every 60 seconds &middot; Last updated: {new Date().toLocaleString()}
      </div>
    </div>
  );
}

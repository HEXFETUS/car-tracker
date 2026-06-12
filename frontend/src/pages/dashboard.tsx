import { Car, Wrench, TrendingUp, CheckCircle2 } from 'lucide-react';
import { MOCK_CARS, MOCK_MAINTENANCE, MOCK_ACTIVITIES } from '@/lib/mock-data';
import { cn } from '@/lib/utils';

const KPI_CARDS = [
  {
    label: 'Total Fleet',
    value: MOCK_CARS.length,
    icon: Car,
    color: 'bg-blue-50 text-blue-700 border-blue-200',
    fill: 'fill-blue-500',
  },
  {
    label: 'Active Vehicles',
    value: MOCK_CARS.filter((c) => c.status === 'available').length,
    icon: CheckCircle2,
    color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    fill: 'fill-emerald-500',
  },
  {
    label: 'In Service',
    value: MOCK_CARS.filter((c) => c.status === 'in-service').length,
    icon: Wrench,
    color: 'bg-amber-50 text-amber-700 border-amber-200',
    fill: 'fill-amber-500',
  },
  {
    label: 'Sold',
    value: MOCK_CARS.filter((c) => c.status === 'sold').length,
    icon: TrendingUp,
    color: 'bg-zinc-50 text-zinc-700 border-zinc-200',
    fill: 'fill-zinc-500',
  },
];

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function DashboardPage() {
  return (
    <div className="space-y-8">
      {/* Page heading */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Real-time overview of your fleet operations.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {KPI_CARDS.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-xl border bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <div className={cn('rounded-lg border p-2.5', kpi.color)}>
                <kpi.icon className="size-5" />
              </div>
            </div>
            <p className="mt-4 text-2xl font-bold text-zinc-900">{kpi.value}</p>
            <p className="mt-0.5 text-sm text-zinc-500">{kpi.label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Maintenance Summary */}
        <div className="rounded-xl border bg-white p-6 shadow-sm lg:col-span-2">
          <h3 className="mb-4 text-base font-semibold text-zinc-900">
            Recent Maintenance
          </h3>
          <div className="space-y-3">
            {MOCK_MAINTENANCE.slice(0, 5).map((record) => (
              <div
                key={record.id}
                className="flex items-center justify-between rounded-lg border border-zinc-100 px-4 py-3 transition-colors hover:bg-zinc-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-900">
                    {record.carName}
                  </p>
                  <p className="text-xs text-zinc-400">{record.serviceType}</p>
                </div>
                <div className="ml-4 text-right text-sm">
                  <p className="font-medium text-zinc-900">
                    ${record.cost.toFixed(2)}
                  </p>
                  <p className="text-xs text-zinc-400">{record.date}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Activity Feed */}
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-base font-semibold text-zinc-900">
            Recent Activity
          </h3>
          <div className="space-y-0">
            {MOCK_ACTIVITIES.slice(0, 6).map((activity, idx) => (
              <div key={activity.id} className="relative flex gap-4 pb-6">
                {/* Timeline line */}
                {idx < 5 && (
                  <div className="absolute bottom-0 left-[11px] top-8 w-px bg-zinc-200" />
                )}
                {/* Dot */}
                <div
                  className={cn(
                    'mt-1.5 flex size-5 shrink-0 items-center justify-center rounded-full ring-2 ring-white',
                    activity.type === 'created' && 'bg-emerald-500',
                    activity.type === 'serviced' && 'bg-amber-500',
                    activity.type === 'updated' && 'bg-blue-500',
                    activity.type === 'sold' && 'bg-zinc-400'
                  )}
                >
                  <div className="size-1.5 rounded-full bg-white" />
                </div>
                {/* Content */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-700">
                    <span className="font-medium text-zinc-900">
                      {activity.carName}
                    </span>{' '}
                    {activity.message}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    {formatRelativeTime(activity.timestamp)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
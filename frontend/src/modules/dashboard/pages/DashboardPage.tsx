import { useNotification } from '@/shared/context/NotificationContext';
import { Car, Wrench, TrendingUp, CheckCircle2, Save, RefreshCw, Trash2 } from 'lucide-react';
import { MOCK_CARS, MOCK_MAINTENANCE, MOCK_ACTIVITIES } from '@/shared/lib/mock-data';
import { cn } from '@/shared/lib/utils';

const KPI_CARDS = [
  {
    label: 'Total Fleet',
    value: MOCK_CARS.length,
    icon: Car,
    color: 'bg-brand-teal/10 text-brand-teal',
  },
  {
    label: 'Active Vehicles',
    value: MOCK_CARS.filter((c) => c.status === 'available').length,
    icon: CheckCircle2,
    color: 'bg-brand-sage/20 text-brand-sage',
  },
  {
    label: 'In Service',
    value: MOCK_CARS.filter((c) => c.status === 'in-service').length,
    icon: Wrench,
    color: 'bg-brand-moss/40 text-brand-teal',
  },
  {
    label: 'Sold',
    value: MOCK_CARS.filter((c) => c.status === 'sold').length,
    icon: TrendingUp,
    color: 'bg-zinc-50 text-zinc-700',
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
  const { confirm, toast } = useNotification();

  async function handleSave() {
    const confirmed = await confirm({
      title: 'Save Vehicle?',
      message: 'This will create a new vehicle record in the system.',
      type: 'info',
    });
    if (confirmed) {
      toast('Vehicle saved successfully!', 'success');
    }
  }

  async function handleUpdate() {
    const confirmed = await confirm({
      title: 'Update Vehicle?',
      message: 'This will overwrite the existing vehicle data. You can undo this change.',
      type: 'warning',
    });
    if (confirmed) {
      toast('Vehicle updated successfully!', 'info');
    }
  }

  async function handleDelete() {
    const confirmed = await confirm({
      title: 'Delete Vehicle?',
      message: 'Are you sure you want to delete this vehicle? This action cannot be undone.',
      type: 'danger',
    });
    if (confirmed) {
      toast('Vehicle deleted.', 'error');
    }
  }

  return (
    <div className="space-y-8">
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
            className="rounded-xl bg-white p-5 shadow-brand transition-shadow hover:shadow-brand-lg"
          >
            <div className={cn('rounded-lg p-2.5', kpi.color)}>
              <kpi.icon className="size-5" />
            </div>
            <p className="mt-4 text-2xl font-bold text-zinc-900">{kpi.value}</p>
            <p className="mt-0.5 text-sm text-zinc-500">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* ── Global Notification Demo Panel ── */}
      <div className="rounded-xl bg-white p-6 shadow-brand">
        <h3 className="mb-1 text-base font-semibold text-zinc-900">
          Global Notification Demo
        </h3>
        <p className="mb-5 text-sm text-zinc-500">
          Click any button to see the confirmation modal and toast system in action.
        </p>

        <div className="flex flex-wrap gap-3">
          {/* Save / Create — info type */}
          <button
            onClick={handleSave}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-teal px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-teal/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2"
          >
            <Save className="size-4" />
            Save Vehicle
          </button>

          {/* Update — warning type */}
          <button
            onClick={handleUpdate}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
          >
            <RefreshCw className="size-4" />
            Update Vehicle
          </button>

          {/* Delete — danger type */}
          <button
            onClick={handleDelete}
            className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            <Trash2 className="size-4" />
            Delete Vehicle
          </button>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Maintenance Summary */}
        <div className="rounded-xl bg-white p-6 shadow-brand lg:col-span-2">
          <h3 className="mb-4 text-base font-semibold text-zinc-900">
            Recent Maintenance
          </h3>
          <div className="space-y-3">
            {MOCK_MAINTENANCE.slice(0, 5).map((record) => (
              <div
                key={record.id}
                className="flex items-center justify-between rounded-lg px-4 py-3 transition-colors hover:bg-brand-moss/20"
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
        <div className="rounded-xl bg-white p-6 shadow-brand">
          <h3 className="mb-4 text-base font-semibold text-zinc-900">
            Recent Activity
          </h3>
          <div className="space-y-0">
            {MOCK_ACTIVITIES.slice(0, 6).map((activity, idx) => (
              <div key={activity.id} className="relative flex gap-4 pb-6">
                {idx < 5 && (
                  <div className="absolute bottom-0 left-[11px] top-8 w-px bg-brand-moss/60" />
                )}
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
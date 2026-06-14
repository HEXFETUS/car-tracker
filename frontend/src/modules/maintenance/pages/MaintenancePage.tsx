import { MOCK_MAINTENANCE } from '@/shared/lib/mock-data';
import { Wrench } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

export function MaintenancePage() {
  const totalCost = MOCK_MAINTENANCE.reduce((sum, r) => sum + r.cost, 0);

  return (
    <div className="space-y-8">
      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-xl bg-white shadow-brand md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-brand-cream text-left text-xs font-medium uppercase tracking-wider text-brand-teal">
              <th className="px-5 py-4">Vehicle</th>
              <th className="px-5 py-4">Service Type</th>
              <th className="px-5 py-4">Cost</th>
              <th className="px-5 py-4">Date</th>
              <th className="px-5 py-4">Notes</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_MAINTENANCE.map((record, idx) => (
              <tr key={record.id} className={cn('transition-colors', idx % 2 === 0 ? 'bg-white' : 'bg-brand-cream/50', 'hover:bg-brand-moss/20')}>
                <td className="px-5 py-4 font-medium text-zinc-900">
                  {record.carName}
                </td>
                <td className="px-5 py-4 text-zinc-700">{record.serviceType}</td>
                <td className="px-5 py-4 font-medium text-zinc-900">
                  ${record.cost.toFixed(2)}
                </td>
                <td className="px-5 py-4 text-zinc-500">{record.date}</td>
                <td className="max-w-[200px] truncate px-5 py-4 text-zinc-400">
                  {record.notes || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-4 md:hidden">
        {MOCK_MAINTENANCE.map((record) => (
          <div key={record.id} className="rounded-xl bg-white p-5 shadow-brand">
            <div className="mb-3 flex items-center gap-2">
              <div className="rounded-lg bg-brand-moss/40 p-2 text-brand-teal">
                <Wrench className="size-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-900">{record.carName}</p>
                <p className="text-xs text-zinc-400">{record.serviceType}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-zinc-400">Cost</p>
                <p className="font-medium text-zinc-900">${record.cost.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-400">Date</p>
                <p className="text-zinc-700">{record.date}</p>
              </div>
            </div>
            {record.notes && (
              <p className="mt-3 rounded-lg bg-brand-cream px-3 py-2 text-xs text-zinc-500">
                {record.notes}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
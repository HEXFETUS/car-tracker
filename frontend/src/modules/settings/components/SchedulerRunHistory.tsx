import { History } from 'lucide-react';

export function SchedulerRunHistory() {
  return (
    <div className="rounded-xl border border-zinc-100 bg-white px-4 py-5 shadow-brand">
      <div className="flex items-start gap-3">
        <History className="mt-0.5 size-4 shrink-0 text-brand-teal" />
        <div>
          <p className="text-sm font-medium text-zinc-700">Run history disabled</p>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            Scheduler runs are not saved to the database to reduce usage. Check your cron
            provider or platform function logs for execution history.
          </p>
        </div>
      </div>
    </div>
  );
}

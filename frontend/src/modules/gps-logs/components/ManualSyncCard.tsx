// ── Manual Sync Card ──────────────────────────────────────────
//
// Allows the user to select a date and manually trigger synchronization.
// This date is separate from the filter date.

import { Calendar, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

interface ManualSyncCardProps {
  syncDate: string;
  syncing: boolean;
  onDateChange: (date: string) => void;
  onSync: () => void;
}

export function ManualSyncCard({ syncDate, syncing, onDateChange, onSync }: ManualSyncCardProps) {
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="rounded-xl bg-white shadow-brand p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex flex-col gap-1.5 w-full sm:w-auto">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Sync Date</label>
          <div className="relative flex-1 sm:flex-initial">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-teal pointer-events-none" />
            <input
              type="date"
              value={syncDate}
              max={today}
              onChange={(e) => onDateChange(e.target.value)}
              className="w-full rounded-lg border-0 bg-white pl-10 pr-3 py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm"
            />
          </div>
        </div>

        <button
          onClick={onSync}
          disabled={syncing || !syncDate}
          className={cn(
            'inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 sm:py-2.5 text-sm font-medium text-white shadow-sm transition-all active:scale-[0.97] w-full sm:w-auto',
            syncing || !syncDate ? 'bg-brand-teal/50 cursor-not-allowed' : 'bg-brand-teal hover:bg-brand-teal/80',
          )}
        >
          {syncing ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Syncing…
            </>
          ) : (
            <>
              <RefreshCw className="size-4" />
              Sync Selected Date
            </>
          )}
        </button>
      </div>
    </div>
  );
}
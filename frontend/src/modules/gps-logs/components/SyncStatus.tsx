// ── Sync Status ───────────────────────────────────────────────
//
// Displays the last synchronization time and a loading indicator for auto-sync.

import { Loader2 } from 'lucide-react';
import { formatDateTimeManila } from '@/shared/lib/date-utils';

interface SyncStatusProps {
  autoSyncing: boolean;
  lastSyncTime: Date | null;
}

export function SyncStatus({ autoSyncing, lastSyncTime }: SyncStatusProps) {
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-500">
      {autoSyncing ? (
        <span className="inline-flex items-center gap-1.5 text-brand-teal">
          <Loader2 className="size-3 animate-spin" />
          Synchronizing...
        </span>
      ) : lastSyncTime ? (
        <span>
          Last synchronized:{' '}
          {formatDateTimeManila(lastSyncTime.toISOString())}
        </span>
      ) : (
        <span>No synchronization yet</span>
      )}
    </div>
  );
}
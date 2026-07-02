// ── Scheduler Run Once Button ──────────────────────────────────
//
// Standalone button to trigger a single scheduler sync cycle.

import { useState } from 'react';
import { Play, Loader2 } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { triggerSchedulerRunOnce } from '../api/settings-api';

interface SchedulerRunOnceButtonProps {
  onComplete?: () => void;
  compact?: boolean;
}

export function SchedulerRunOnceButton({ onComplete }: SchedulerRunOnceButtonProps) {
  const { toast } = useNotification();
  const [running, setRunning] = useState(false);

  const handleRun = async () => {
    setRunning(true);
    try {
      await triggerSchedulerRunOnce();
      toast('Scheduler run completed successfully!', 'success');
      onComplete?.();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to run scheduler', 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <button
      onClick={handleRun}
      disabled={running}
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-teal/80 disabled:opacity-60"
    >
      {running && <Loader2 className="size-3 animate-spin" />}
      <Play className="size-3" />
      {running ? 'Running…' : 'Run Once'}
    </button>
  );
}
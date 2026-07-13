// ── Scheduler Run History Table ────────────────────────────────
//
// Redesigned compact table with sticky header, status badges,
// and expandable error text.

import { useState, useEffect, useCallback } from 'react';
import { History, Loader2, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { formatDateTimeManila } from '@/shared/lib/date-utils';
import {
  tableClass,
  tableHeaderClass,
  tableHeaderCellClass,
  tableRowClass,
  tableCellClass,
} from '@/shared/styles/table-constants';
import { fetchSchedulerRuns, type SchedulerRunData } from '../api/settings-api';
import { SchedulerRunOnceButton } from './SchedulerRunOnceButton';
import { SettingsStatusBadge, type StatusVariant } from './SettingsCard';

export function SchedulerRunHistory() {
  const [data, setData] = useState<SchedulerRunData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [expandedError, setExpandedError] = useState<number | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchSchedulerRuns();
      setData(result);
    } catch {
      // Silently fail — the table may not exist yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (expanded && !data) {
      loadHistory();
    }
  }, [expanded, data, loadHistory]);

  const getRunStatusVariant = (status: string): StatusVariant => {
    switch (status) {
      case 'success': return 'success';
      case 'error': return 'error';
      case 'running': return 'warning';
      default: return 'disabled';
    }
  };

  const formatDuration = (started: string, finished: string | null): string => {
    if (!finished) return '—';
    const start = new Date(started).getTime();
    const end = new Date(finished).getTime();
    const ms = end - start;
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  };

  return (
    <div className="rounded-xl border border-zinc-100 bg-white shadow-brand overflow-hidden">
      {/* Header toggle */}
      <button
        onClick={() => {
          setExpanded(!expanded);
          if (!expanded && !data) loadHistory();
        }}
        className="flex min-h-11 w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
      >
        <History className="size-4 text-brand-teal" />
        <span>Run History</span>
        {loading && <Loader2 className="size-3.5 animate-spin ml-1" />}
        <div className="flex-1" />
        {data && (
          <span className="text-xs text-zinc-400 mr-2">
            {data.summary.totalRuns} runs
          </span>
        )}
        {expanded ? (
          <ChevronDown className="size-4 text-zinc-400" />
        ) : (
          <ChevronRight className="size-4 text-zinc-400" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-zinc-100">
          {/* Summary stats */}
          {data && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 py-3 bg-brand-cream/30">
              <div>
                <p className="text-[11px] text-zinc-400">Total Runs</p>
                <p className="text-sm font-semibold text-zinc-800">{data.summary.totalRuns}</p>
              </div>
              <div>
                <p className="text-[11px] text-zinc-400">Cycles</p>
                <p className="text-sm font-semibold text-zinc-800">{data.summary.cyclesCompleted}</p>
              </div>
              <div>
                <p className="text-[11px] text-zinc-400">Errors</p>
                <p className="text-sm font-semibold text-zinc-800">{data.summary.totalErrors}</p>
              </div>
              <div>
                <p className="text-[11px] text-zinc-400">Last Status</p>
                {data.summary.lastStatus ? (
                  <SettingsStatusBadge status={getRunStatusVariant(data.summary.lastStatus)} />
                ) : (
                  <span className="text-xs text-zinc-400">—</span>
                )}
              </div>
              {data.summary.lastRunAt && (
                <div className="col-span-2">
                  <p className="text-[11px] text-zinc-400">Last Run</p>
                  <p className="text-xs font-medium text-zinc-700">
                    {formatDateTimeManila(data.summary.lastRunAt)}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Run history table */}
          {data && data.runs.length > 0 && (
            <>
            <div className="hidden overflow-x-auto md:block">
              <table className={tableClass}>
                <thead>
                  <tr className={tableHeaderClass}>
                    <th className={tableHeaderCellClass}>Run ID</th>
                    <th className={tableHeaderCellClass}>Started</th>
                    <th className={tableHeaderCellClass}>Finished</th>
                    <th className={tableHeaderCellClass}>Duration</th>
                    <th className={tableHeaderCellClass}>Status</th>
                    <th className={tableHeaderCellClass}>Cycles</th>
                    <th className={tableHeaderCellClass}>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {data.runs.slice(0, 20).map((run) => (
                    <tr key={run.id} className={tableRowClass}>
                      <td className={tableCellClass}>#{run.id}</td>
                      <td className={tableCellClass}>{formatDateTimeManila(run.started_at)}</td>
                      <td className={tableCellClass}>{run.finished_at ? formatDateTimeManila(run.finished_at) : '—'}</td>
                      <td className={tableCellClass}>{formatDuration(run.started_at, run.finished_at)}</td>
                      <td className={tableCellClass}>
                        <SettingsStatusBadge status={getRunStatusVariant(run.status)} />
                      </td>
                      <td className={tableCellClass}>{run.cycles_completed}</td>
                      <td className={cn(tableCellClass, 'max-w-[200px]')}>
                        {run.error_message ? (
                          <div>
                            <button
                              onClick={() => setExpandedError(expandedError === run.id ? null : run.id)}
                              className="text-red-500 hover:text-red-700 font-medium flex items-center gap-1"
                            >
                              <span className="truncate max-w-[120px]">{run.error_message}</span>
                              {expandedError === run.id ? (
                                <ChevronDown className="size-3 shrink-0" />
                              ) : (
                                <ChevronRight className="size-3 shrink-0" />
                              )}
                            </button>
                            {expandedError === run.id && (
                              <pre className="mt-1 p-2 bg-red-50 rounded text-[11px] text-red-700 whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
                                {run.error_message}
                              </pre>
                            )}
                          </div>
                        ) : (
                          <span className="text-zinc-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 p-3 md:hidden">
              {data.runs.slice(0, 20).map((run) => (
                <article key={run.id} className="rounded-xl border border-zinc-100 bg-zinc-50/60 p-3">
                  <div className="flex items-center justify-between gap-3 border-b border-zinc-100 pb-3">
                    <p className="font-mono text-sm font-bold text-brand-teal">Run #{run.id}</p>
                    <SettingsStatusBadge status={getRunStatusVariant(run.status)} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div><dt className="text-zinc-400">Started</dt><dd className="mt-0.5 break-words font-medium text-zinc-700">{formatDateTimeManila(run.started_at)}</dd></div>
                    <div><dt className="text-zinc-400">Finished</dt><dd className="mt-0.5 break-words font-medium text-zinc-700">{run.finished_at ? formatDateTimeManila(run.finished_at) : '—'}</dd></div>
                    <div><dt className="text-zinc-400">Duration</dt><dd className="mt-0.5 font-medium text-zinc-700">{formatDuration(run.started_at, run.finished_at)}</dd></div>
                    <div><dt className="text-zinc-400">Cycles</dt><dd className="mt-0.5 font-medium text-zinc-700">{run.cycles_completed}</dd></div>
                  </dl>
                  {run.error_message && (
                    <div className="mt-3 border-t border-zinc-100 pt-2">
                      <button
                        onClick={() => setExpandedError(expandedError === run.id ? null : run.id)}
                        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2 text-left text-xs font-medium text-red-600 hover:bg-red-50"
                      >
                        <span className="min-w-0 truncate">{run.error_message}</span>
                        {expandedError === run.id ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                      </button>
                      {expandedError === run.id && (
                        <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded bg-red-50 p-2 text-[11px] text-red-700">{run.error_message}</pre>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
            </>
          )}

          {/* Empty state */}
          {data && data.runs.length === 0 && (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-zinc-400">No scheduler runs yet</p>
              <p className="text-xs text-zinc-300 mt-1 mb-4">
                Run the scheduler once to verify connection.
              </p>
              <SchedulerRunOnceButton onComplete={loadHistory} />
            </div>
          )}

          {/* Loading state */}
          {loading && !data && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-4 animate-spin text-brand-teal" />
              <span className="ml-2 text-xs text-zinc-400">Loading history…</span>
            </div>
          )}

          {/* Refresh button for existing data */}
          {data && (
            <div className="flex justify-center border-t border-zinc-100 px-4 py-2">
              <button
                onClick={loadHistory}
                disabled={loading}
                className="inline-flex min-h-11 items-center gap-1 px-3 text-xs text-zinc-400 transition-colors hover:text-zinc-600"
              >
                <RefreshCw className={cn('size-3', loading && 'animate-spin')} />
                Refresh
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

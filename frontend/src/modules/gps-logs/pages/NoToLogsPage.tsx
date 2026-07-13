import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Calendar, Car, Eye, Link2, Loader2, RefreshCw, X } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { cn } from '@/shared/lib/utils';
import { formatDateManila } from '@/shared/lib/date-utils';
import {
  tableCellClass,
  tableClass,
  tableContainerClass,
  tableHeaderCellClass,
  tableHeaderClass,
  tableRowClass,
} from '@/shared/styles/table-constants';
import { Pagination } from '@/shared/components/Pagination';
import { GpsLogsToolbar, type TabKey } from '../components/GpsLogsToolbar';
import { TripDetailsModal } from '../components/TripDetailsModal';
import {
  fetchNoToGpsLogs,
  fetchNoToLinkOptions,
  fetchTrackedVehicles,
  linkNoToGpsLog,
  syncNoToLogs,
  type NoToGpsLog,
  type NoToGpsLogsResult,
  type NoToLinkOption,
  type VehicleOption,
} from '../api/gps-logs-api';

const pageSize = 25;

interface NoToLogsPageProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  vehicleFilter: string;
  onVehicleFilterChange: (v: string) => void;
  dateFilter: string;
  onDateFilterChange: (d: string) => void;
}

export function NoToLogsPage({ activeTab, onTabChange, vehicleFilter, onVehicleFilterChange, dateFilter, onDateFilterChange }: NoToLogsPageProps) {
  const { toast } = useNotification();
  const [result, setResult] = useState<NoToGpsLogsResult | null>(null);
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [linkLog, setLinkLog] = useState<NoToGpsLog | null>(null);
  const [options, setOptions] = useState<NoToLinkOption[]>([]);
  const [selectedToId, setSelectedToId] = useState('');
  const [linking, setLinking] = useState(false);

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchNoToGpsLogs({ page, pageSize, vehicleId: vehicleFilter || undefined, tripDate: dateFilter || undefined });
      setResult(data);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to load No TO logs', 'error');
    } finally {
      setLoading(false);
    }
  }, [dateFilter, page, toast, vehicleFilter]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  useEffect(() => {
    fetchTrackedVehicles().then(setVehicles).catch(() => toast('Failed to load vehicles', 'error'));
  }, [toast]);

  const openLinkModal = async (log: NoToGpsLog) => {
    setLinkLog(log);
    setSelectedToId('');
    try {
      const data = await fetchNoToLinkOptions(log.vehicleId);
      setOptions(data.data);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to load Travel Orders', 'error');
    }
  };

  const handleLink = async () => {
    if (!linkLog || !selectedToId) return;
    try {
      setLinking(true);
      const result = await linkNoToGpsLog(linkLog.id, selectedToId);
      toast(`Linked to ${result.data.linkedToNumber}. ${result.data.telemetryBackfilled} telemetry points updated.`, 'success');
      setLinkLog(null);
      await loadLogs();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to link Travel Order', 'error');
    } finally {
      setLinking(false);
    }
  };

  const handleSync = async () => {
    try {
      setSyncing(true);
      const result = await syncNoToLogs();
      toast(`Synced: ${result.data.created} created, ${result.data.updated} updated, ${result.data.skipped} skipped`, 'success');
      await loadLogs();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to sync No TO logs', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const today = new Date().toISOString().split('T')[0];
  const filters = (
    <>
      <div className="relative w-full sm:w-auto">
        <Car className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-brand-teal" />
        <select value={vehicleFilter} onChange={(e) => { onVehicleFilterChange(e.target.value); setPage(1); }} className="h-11 w-full appearance-none rounded-lg border-0 bg-white pl-8 pr-7 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage sm:h-10 sm:w-[170px]">
          <option value="">All Vehicles</option>
          {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plateNumber}</option>)}
        </select>
        {vehicleFilter && (
          <button onClick={() => { onVehicleFilterChange(''); setPage(1); }} className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600" title="Clear">
            <X className="size-3" />
          </button>
        )}
      </div>
      <div className="relative w-full sm:w-auto">
        <Calendar className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-brand-teal" />
        <input type="date" value={dateFilter} max={today} onChange={(e) => { onDateFilterChange(e.target.value); setPage(1); }} className="gps-log-date-filter h-11 w-full rounded-lg border-0 bg-white pl-8 pr-7 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage sm:h-10 sm:w-[168px]" />
        {dateFilter && (
          <button onClick={() => { onDateFilterChange(''); setPage(1); }} className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600" title="Clear">
            <X className="size-3" />
          </button>
        )}
      </div>
      <button onClick={loadLogs} className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-brand-teal/30 px-3 text-sm font-medium text-brand-teal hover:bg-brand-teal/5 sm:h-10 sm:flex-none">
        <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
        Refresh
      </button>
      <button onClick={handleSync} disabled={syncing} className="inline-flex h-11 flex-[2] items-center justify-center gap-1.5 rounded-lg bg-brand-teal px-4 text-sm font-medium text-white hover:bg-brand-teal/90 disabled:bg-brand-teal/50 sm:h-10 sm:flex-none">
        {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        {syncing ? 'Syncing...' : 'Sync No TO Logs'}
      </button>
    </>
  );

  return (
    <div className="space-y-4">
      <TripDetailsModal isOpen={Boolean(detailId)} onClose={() => setDetailId(null)} logId={detailId} source="no-to" />
      <div className="sticky top-0 z-20">
        <GpsLogsToolbar activeTab={activeTab} onTabChange={onTabChange} actions={filters} variant="card" />
      </div>

      {loading && <div className="flex min-h-[360px] items-center justify-center rounded-xl bg-white"><Loader2 className="size-8 animate-spin text-brand-teal" /></div>}

      {!loading && result && result.data.length === 0 && (
        <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-zinc-100 bg-white text-center">
          <AlertTriangle className="mb-3 size-10 text-zinc-300" />
          <p className="font-semibold text-zinc-700">No No TO logs found</p>
        </div>
      )}

      {!loading && result && result.data.length > 0 && (
        <>
        <div className={cn(tableContainerClass, 'hidden md:block')}>
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead>
                <tr className={tableHeaderClass}>
                    <th className={tableHeaderCellClass}>Date</th>
                    <th className={tableHeaderCellClass}>GPS Number</th>
                    <th className={tableHeaderCellClass}>Vehicle</th>
                    <th className={tableHeaderCellClass}>Status</th>
                    <th className={tableHeaderCellClass}>Anomaly</th>
                    <th className={cn(tableHeaderCellClass, 'text-right')}>Action</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((log) => (
                  <tr key={log.id} className={tableRowClass}>
                    <td className={tableCellClass}>{formatDateManila(log.tripDate)}</td>
                    <td className={tableCellClass}><span className="font-mono text-xs font-medium text-brand-teal">{log.noToRecordNo}</span></td>
                    <td className={tableCellClass}>{log.vehiclePlateNo}</td>
                    <td className={tableCellClass}>
                      {log.statusDisplay === 'Completed' ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">{log.statusDisplay}</span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700">{log.statusDisplay}</span>
                      )}
                    </td>
                    <td className={tableCellClass}>
                      {log.anomalyReason ? (
                        <span className={cn(
                          'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold',
                          log.anomalyReason.toLowerCase().includes('unauthorized')
                            ? 'bg-red-100 text-red-700'
                            : 'bg-orange-100 text-orange-700',
                        )}>{log.anomalyReason}</span>
                      ) : (
                        <span className="text-[11px] text-zinc-400">—</span>
                      )}
                    </td>
                    <td className={cn(tableCellClass, 'text-right')}>
                      <button onClick={() => setDetailId(log.id)} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-brand-teal hover:bg-brand-teal/5"><Eye className="size-3.5" />View</button>
                      <button onClick={() => openLinkModal(log)} disabled={log.status === 'linked'} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-brand-teal hover:bg-brand-teal/5 disabled:text-zinc-300"><Link2 className="size-3.5" />Link</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination currentPage={page} totalPages={Math.ceil(result.total / pageSize)} totalItems={result.total} pageSize={pageSize} onPageChange={setPage} />
        </div>
        <div className="space-y-3 md:hidden">
          {result.data.map((log) => (
            <article key={log.id} className="overflow-hidden rounded-xl border border-zinc-100 bg-white shadow-brand">
              <div className="flex items-start justify-between gap-3 bg-brand-cream/60 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-semibold text-brand-teal">{log.noToRecordNo}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">{formatDateManila(log.tripDate)}</p>
                </div>
                <span className={cn(
                  'shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                  log.statusDisplay === 'Completed'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-blue-200 bg-blue-50 text-blue-700',
                )}>
                  {log.statusDisplay}
                </span>
              </div>
              <div className="space-y-3 px-4 py-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Vehicle</p>
                  <p className="text-sm font-medium text-zinc-800">{log.vehiclePlateNo}</p>
                </div>
                {log.anomalyReason && (
                  <p className={cn(
                    'rounded-lg px-3 py-2 text-xs font-semibold',
                    log.anomalyReason.toLowerCase().includes('unauthorized')
                      ? 'bg-red-50 text-red-700'
                      : 'bg-orange-50 text-orange-700',
                  )}>
                    {log.anomalyReason}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-zinc-100 p-3">
                <button onClick={() => setDetailId(log.id)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm font-medium text-brand-teal hover:bg-brand-teal/5">
                  <Eye className="size-4" /> View
                </button>
                <button onClick={() => openLinkModal(log)} disabled={log.status === 'linked'} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm font-medium text-brand-teal hover:bg-brand-teal/5 disabled:text-zinc-300">
                  <Link2 className="size-4" /> Link
                </button>
              </div>
            </article>
          ))}
          <Pagination currentPage={page} totalPages={Math.ceil(result.total / pageSize)} totalItems={result.total} pageSize={pageSize} onPageChange={setPage} />
        </div>
        </>
      )}

      {linkLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-brand-xl">
            <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
              <h2 className="font-semibold text-zinc-800">Link to Travel Order</h2>
              <button onClick={() => setLinkLog(null)} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100" aria-label="Close"><X className="size-5" /></button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <p className="text-sm text-zinc-500">{linkLog.noToRecordNo} · {linkLog.vehiclePlateNo}</p>
              <select value={selectedToId} onChange={(e) => setSelectedToId(e.target.value)} className="h-11 w-full rounded-lg border-0 bg-white px-3 text-sm ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-brand-teal/30">
                <option value="">Select approved Travel Order</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>{option.toNumber} · {option.destination || 'No destination'} · {formatDateManila(option.scheduledDeparture)}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-100 px-5 py-4">
              <button onClick={() => setLinkLog(null)} className="min-h-11 flex-1 rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 sm:flex-none">Cancel</button>
              <button onClick={handleLink} disabled={!selectedToId || linking} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-brand-teal px-4 py-2 text-sm font-medium text-white disabled:bg-brand-teal/50 sm:flex-none">
                {linking && <Loader2 className="size-4 animate-spin" />}
                Link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { Loader2, AlertTriangle, CheckCircle2, Pencil, Save, X, SatelliteDish, MapPinOff, Search, RotateCcw } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useNotification } from '@/shared/context/NotificationContext';
import { formatDateTimeManila, formatDateManilaFull } from '@/shared/lib/date-utils';
import {
  tableContainerClass,
  tableClass,
  tableHeaderClass,
  tableHeaderCellClass,
  tableRowClass,
  tableCellClass,
} from '@/shared/styles/table-constants';
import { fetchReconciliation } from '../api/reports-api';
import type { ReconciliationRecord } from '../types';

interface ReconciliationPageProps {
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
}

function MatchStatusBadge({ status }: { status: ReconciliationRecord['status'] }) {
  switch (status) {
    case 'Matched':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-sage/20 px-2.5 py-0.5 text-xs font-medium text-brand-sage">
          <CheckCircle2 className="size-3" />
          Matched
        </span>
      );
    case 'Flagged':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-600">
          <AlertTriangle className="size-3" />
          Flagged
        </span>
      );
    case 'NO GPS RECORD':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
          <SatelliteDish className="size-3" />
          No GPS Record
        </span>
      );
    case 'MISSING TO DISTANCE':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-700">
          <MapPinOff className="size-3" />
          Missing TO Dist.
        </span>
      );
  }
}

function AddressCell({ value }: { value: string }) {
  return (
    <td className={cn(tableCellClass, 'max-w-48 truncate')} title={value === '—' ? '' : value}>
      {value}
    </td>
  );
}

export function ReconciliationPage({ statusFilter }: ReconciliationPageProps) {
  const { toast } = useNotification();
  const [records, setRecords] = useState<ReconciliationRecord[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [editRemarks, setEditRemarks] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchReconciliation({ status: statusFilter as ReconciliationRecord['status'] || undefined })
      .then((data) => {
        if (!cancelled) setRecords(data);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message || 'Failed to load reconciliation data');
          toast('Failed to load reconciliation data', 'error');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [toast, statusFilter]);

  const handleEdit = (rec: ReconciliationRecord) => {
    setEditId(rec.id);
    setEditRemarks(rec.explanationRemarks);
  };

  const handleSave = () => {
    if (!editId) return;
    setRecords((prev) =>
      prev.map((r) => (r.id === editId ? { ...r, explanationRemarks: editRemarks } : r))
    );
    setEditId(null);
    setEditRemarks('');
  };

  const handleCancel = () => {
    setEditId(null);
    setEditRemarks('');
  };

  const handleRefresh = () => {
    setLoading(true);
    setError(null);
    fetchReconciliation({ status: statusFilter as ReconciliationRecord['status'] || undefined })
      .then((data) => setRecords(data))
      .catch((err: Error) => {
        setError(err.message || 'Failed to load reconciliation data');
        toast('Failed to load reconciliation data', 'error');
      })
      .finally(() => setLoading(false));
  };

  return (
    <div className="space-y-3">
      {/* ── Loading state ── */}
      {loading && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 min-h-[240px] text-center shadow-brand border border-zinc-100">
          <Loader2 className="mb-2 size-7 animate-spin text-brand-teal" />
          <p className="text-sm font-medium text-zinc-500">Loading reconciliation data…</p>
        </div>
      )}

      {/* ── Error state ── */}
      {!loading && error && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 min-h-[240px] text-center shadow-brand border border-zinc-100">
          <AlertTriangle className="mb-2 size-8 text-red-400" />
          <p className="text-sm font-medium text-red-600">Failed to load data</p>
          <p className="mt-1 text-xs text-zinc-500">{error}</p>
          <button
            onClick={handleRefresh}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-3.5 py-1.5 text-xs font-medium text-white hover:bg-brand-teal/90"
          >
            <RotateCcw className="size-3.5" />
            Retry
          </button>
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && !error && records.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 min-h-[240px] text-center shadow-brand border border-zinc-100">
          <Search className="mb-2 size-6 text-zinc-300" />
          <p className="text-sm font-medium text-zinc-600">No reconciliation records found</p>
          <p className="mt-1 text-xs text-zinc-400 max-w-sm">
            {statusFilter
              ? `No travel orders with status "${statusFilter}" match the current criteria.`
              : 'There are no APPROVED, ACTIVE, or COMPLETED travel orders to reconcile.'}
          </p>
        </div>
      )}

      {/* ── Desktop data table ── */}
      {!loading && !error && records.length > 0 && (
        <div className={tableContainerClass}>
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead>
                <tr className={tableHeaderClass}>
                  <th className={tableHeaderCellClass}>TO No.</th>
                  <th className={tableHeaderCellClass}>GPS Record No.</th>
                  <th className={tableHeaderCellClass}>Vehicle Plate</th>
                  <th className={tableHeaderCellClass}>Trip Date</th>
                  <th className={tableHeaderCellClass}>Origin</th>
                  <th className={tableHeaderCellClass}>Destination</th>
                  <th className={tableHeaderCellClass}>Arrival Time</th>
                  <th className={cn(tableHeaderCellClass, 'text-right')}>TO Est. (km)</th>
                  <th className={cn(tableHeaderCellClass, 'text-right')}>GPS Actual (km)</th>
                  <th className={cn(tableHeaderCellClass, 'text-right')}>Variance (km)</th>
                  <th className={cn(tableHeaderCellClass, 'text-right')}>Variance %</th>
                  <th className={tableHeaderCellClass}>TO Status</th>
                  <th className={tableHeaderCellClass}>Match Status</th>
                  <th className={tableHeaderCellClass}>Explanation / Remarks</th>
                  <th className={cn(tableHeaderCellClass, 'text-center')}>Action</th>
                </tr>
              </thead>
              <tbody>
                {records.map((rec, _idx) => {
                  const isEditing = editId === rec.id;
                  return (
                    <tr key={rec.id} className={tableRowClass}>
                      <td className={tableCellClass}>{rec.toNo}</td>
                      <td className={tableCellClass}>{rec.gpsRecordNo}</td>
                      <td className={tableCellClass}>{rec.vehiclePlate}</td>
                      <td className={tableCellClass}>{formatDateManilaFull(rec.tripDate)}</td>
                      <AddressCell value={rec.origin} />
                      <AddressCell value={rec.destination} />
                      <td className={tableCellClass}>{formatDateTimeManila(rec.arrivalTime)}</td>
                      <td className={cn(tableCellClass, 'text-right font-mono')}>{rec.toEstMileageKm.toFixed(1)}</td>
                      <td className={cn(tableCellClass, 'text-right font-mono')}>{rec.gpsActualMileageKm.toFixed(1)}</td>
                      <td className={cn(tableCellClass, 'text-right font-mono font-medium')}>
                        {rec.status === 'NO GPS RECORD' || rec.status === 'MISSING TO DISTANCE'
                          ? '—'
                          : `${rec.varianceKm >= 0 ? '+' : ''}${rec.varianceKm.toFixed(1)}`}
                      </td>
                      <td className={cn(tableCellClass, 'text-right font-mono font-medium')}>
                        {rec.status === 'NO GPS RECORD' || rec.status === 'MISSING TO DISTANCE'
                          ? '—'
                          : `${rec.variancePct.toFixed(1)}%`}
                      </td>
                      <td className={tableCellClass}>
                        <span className={cn(
                          'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                          rec.toStatus === 'APPROVED' && 'bg-blue-100 text-blue-700',
                          rec.toStatus === 'ACTIVE' && 'bg-green-100 text-green-700',
                          rec.toStatus === 'COMPLETED' && 'bg-gray-100 text-gray-700',
                          !rec.toStatus && 'bg-zinc-100 text-zinc-700'
                        )}>
                          {rec.toStatus || 'Unknown'}
                        </span>
                      </td>
                      <td className={tableCellClass}>
                        <MatchStatusBadge status={rec.status} />
                      </td>
                      <td className={cn(tableCellClass, 'max-w-50')}>
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={editRemarks}
                              onChange={(e) => setEditRemarks(e.target.value)}
                              className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 placeholder-zinc-300 outline-none focus:border-brand-teal focus:ring-1 focus:ring-brand-teal/30"
                              placeholder="Add remarks..."
                            />
                            <button
                              onClick={handleSave}
                              className="rounded-md p-1 text-brand-teal hover:bg-brand-moss/30"
                            >
                              <Save className="size-4" />
                            </button>
                            <button
                              onClick={handleCancel}
                              className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100"
                            >
                              <X className="size-4" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-zinc-400 text-xs">
                            {rec.explanationRemarks || '—'}
                          </span>
                        )}
                      </td>
                      <td className={cn(tableCellClass, 'text-center')}>
                        <button
                          onClick={() => handleEdit(rec)}
                          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-teal transition-colors hover:bg-brand-moss/30"
                        >
                          <Pencil className="size-3.5" />
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Mobile cards ── */}
      {!loading && !error && records.length > 0 && (
        <div className="space-y-3 md:hidden">
          {records.map((rec) => (
            <div key={rec.id} className="rounded-xl bg-white p-4 shadow-brand border border-zinc-100">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-zinc-900">{rec.toNo}</p>
                  <p className="text-xs text-zinc-400">{rec.vehiclePlate} - {formatDateManilaFull(rec.tripDate)}</p>
                </div>
                <div className="flex gap-2">
                  <span className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                    rec.toStatus === 'APPROVED' && 'bg-blue-100 text-blue-700',
                    rec.toStatus === 'ACTIVE' && 'bg-green-100 text-green-700',
                    rec.toStatus === 'COMPLETED' && 'bg-gray-100 text-gray-700',
                    !rec.toStatus && 'bg-zinc-100 text-zinc-700'
                  )}>
                    {rec.toStatus || 'Unknown'}
                  </span>
                  <MatchStatusBadge status={rec.status} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-zinc-400">GPS Record</p>
                  <p className="font-medium text-zinc-700">{rec.gpsRecordNo}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-400">Route</p>
                    <p className="truncate text-zinc-700" title={`${rec.origin} to ${rec.destination}`}>
                      {rec.origin} to {rec.destination}
                    </p>
                </div>
                <div>
                  <p className="text-xs text-zinc-400">Arrival Time</p>
                  <p className="text-zinc-500">{formatDateTimeManila(rec.arrivalTime)}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-400">TO Est.</p>
                  <p className="font-mono font-medium text-zinc-900">{rec.toEstMileageKm.toFixed(1)} km</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-400">GPS Actual</p>
                  <p className="font-mono font-medium text-zinc-900">{rec.gpsActualMileageKm.toFixed(1)} km</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-400">Variance</p>
                  {rec.status === 'NO GPS RECORD' || rec.status === 'MISSING TO DISTANCE' ? (
                    <p className="font-mono text-zinc-400">—</p>
                  ) : (
                    <p className={cn(
                      'font-mono font-medium',
                      rec.status === 'Flagged' ? 'text-red-600' : 'text-zinc-900'
                    )}>
                      {`${rec.varianceKm >= 0 ? '+' : ''}${rec.varianceKm.toFixed(1)} km (${rec.variancePct.toFixed(1)}%)`}
                    </p>
                  )}
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-zinc-400">Remarks</p>
                  <p className="text-zinc-500">{rec.explanationRemarks || '—'}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

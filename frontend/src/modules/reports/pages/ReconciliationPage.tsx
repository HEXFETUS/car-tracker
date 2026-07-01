import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useNotification } from '@/shared/context/NotificationContext';
import { fetchReconciliation } from '../api/reports-api';
import type { ReconciliationRecord } from '../types';
import {
  AlertTriangle,
  CheckCircle2,
  Pencil,
  Save,
  X,
  Filter,
  Frown,
  SatelliteDish,
  MapPinOff,
} from 'lucide-react';

type StatusFilterValue = ReconciliationRecord['status'] | '';

const STATUS_OPTIONS: { value: StatusFilterValue; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'Matched', label: 'Matched' },
  { value: 'Flagged', label: 'Flagged' },
  { value: 'NO GPS RECORD', label: 'No GPS Record' },
  { value: 'MISSING TO DISTANCE', label: 'Missing TO Distance' },
];

function MatchStatusBadge({ status }: { status: ReconciliationRecord['status'] }) {
  switch (status) {
    case 'Matched':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-sage/20 px-3 py-0.5 text-xs font-medium text-brand-sage">
          <CheckCircle2 className="size-3.5" />
          Matched
        </span>
      );
    case 'Flagged':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-3 py-0.5 text-xs font-medium text-red-600">
          <AlertTriangle className="size-3.5" />
          Flagged
        </span>
      );
    case 'NO GPS RECORD':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-0.5 text-xs font-medium text-amber-700">
          <SatelliteDish className="size-3.5" />
          No GPS Record
        </span>
      );
    case 'MISSING TO DISTANCE':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-3 py-0.5 text-xs font-medium text-purple-700">
          <MapPinOff className="size-3.5" />
          Missing TO Dist.
        </span>
      );
  }
}

export function ReconciliationPage() {
  const { toast } = useNotification();
  const [records, setRecords] = useState<ReconciliationRecord[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [editRemarks, setEditRemarks] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchReconciliation({ status: statusFilter || undefined })
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

  return (
    <div className="space-y-8">
      {/* Instruction header */}
      <div className="flex items-start gap-3 rounded-xl bg-brand-moss/30 p-4 shadow-brand">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-brand-teal" />
        <p className="text-sm leading-relaxed text-zinc-700">
          Reconciliation compares GPS actual mileage against Travel Order estimated distance. Variance {'>'} 20% is automatically flagged. Only APPROVED, ACTIVE, and COMPLETED travel orders are shown.
        </p>
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-3">
        <Filter className="size-4 text-zinc-500" />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilterValue)}
          className="rounded-lg border border-brand-sage/40 bg-white px-3 py-1.5 text-sm text-zinc-700 outline-none focus:border-brand-teal focus:ring-1 focus:ring-brand-teal/30"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
          <Loader2 className="mb-3 size-8 animate-spin text-brand-teal" />
          <p className="text-base font-medium text-zinc-600">Loading reconciliation data…</p>
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
          <AlertTriangle className="mb-3 size-10 text-red-400" />
          <p className="text-base font-medium text-red-600">Failed to load data</p>
          <p className="mt-1 text-sm text-zinc-500">{error}</p>
          <button
            onClick={() => {
              setStatusFilter(''); // trigger re-fetch via effect
              // Force re-fetch by toggling a dummy state
              setLoading(true);
              setError(null);
              fetchReconciliation()
                .then((data) => setRecords(data))
                .catch((err: Error) => {
                  setError(err.message || 'Failed to load reconciliation data');
                  toast('Failed to load reconciliation data', 'error');
                })
                .finally(() => setLoading(false));
            }}
            className="mt-4 rounded-lg bg-brand-teal px-4 py-2 text-sm font-medium text-white hover:bg-brand-teal/90"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && records.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
          <Frown className="mb-3 size-10 text-zinc-300" />
          <p className="text-base font-medium text-zinc-600">No reconciliation records found</p>
          <p className="mt-1 text-sm text-zinc-400">
            {statusFilter
              ? `No travel orders with status "${statusFilter}" match the current criteria.`
              : 'There are no APPROVED, ACTIVE, or COMPLETED travel orders to reconcile.'}
          </p>
        </div>
      )}

      {/* Desktop data table */}
      {!loading && !error && records.length > 0 && (
        <div className="hidden overflow-hidden rounded-xl bg-white shadow-brand md:block">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand-cream text-left text-xs font-medium uppercase tracking-wider text-brand-teal">
                  <th className="whitespace-nowrap px-4 py-4">TO No.</th>
                  <th className="whitespace-nowrap px-4 py-4">GPS Record No.</th>
                  <th className="whitespace-nowrap px-4 py-4">Vehicle Plate</th>
                  <th className="whitespace-nowrap px-4 py-4">Trip Date</th>
                  <th className="whitespace-nowrap px-4 py-4">Origin</th>
                  <th className="whitespace-nowrap px-4 py-4">Destination</th>
                  <th className="whitespace-nowrap px-4 py-4">Arrival Time</th>
                  <th className="whitespace-nowrap px-4 py-4 text-right">TO Est. (km)</th>
                  <th className="whitespace-nowrap px-4 py-4 text-right">GPS Actual (km)</th>
                  <th className="whitespace-nowrap px-4 py-4 text-right">Variance (km)</th>
                  <th className="whitespace-nowrap px-4 py-4 text-right">Variance %</th>
                  <th className="whitespace-nowrap px-4 py-4">TO Status</th>
                  <th className="whitespace-nowrap px-4 py-4">Match Status</th>
                  <th className="whitespace-nowrap px-4 py-4">Explanation / Remarks</th>
                  <th className="whitespace-nowrap px-4 py-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {records.map((rec, idx) => {
                  const isEditing = editId === rec.id;
                  return (
                    <tr
                      key={rec.id}
                      className={cn(
                        'transition-colors',
                        idx % 2 === 0 ? 'bg-white' : 'bg-brand-cream/50',
                        'hover:bg-brand-moss/20'
                      )}
                    >
                      <td className="whitespace-nowrap px-4 py-4 font-medium text-zinc-900">
                        {rec.toNo}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-zinc-700">
                        {rec.gpsRecordNo}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 font-medium text-zinc-900">
                        {rec.vehiclePlate}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-zinc-500">
                        {rec.tripDate}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-zinc-700">
                        {rec.origin}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-zinc-700">
                        {rec.destination}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-zinc-500">
                        {rec.arrivalTime || '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-right font-mono text-zinc-900">
                        {rec.toEstMileageKm.toFixed(1)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-right font-mono text-zinc-900">
                        {rec.gpsActualMileageKm.toFixed(1)}
                      </td>
                      <td
                        className={cn(
                          'whitespace-nowrap px-4 py-4 text-right font-mono font-medium',
                          rec.status === 'Flagged' ? 'text-red-600' : 'text-zinc-900'
                        )}
                      >
                        {rec.status === 'NO GPS RECORD' || rec.status === 'MISSING TO DISTANCE'
                          ? '—'
                          : `${rec.varianceKm >= 0 ? '+' : ''}${rec.varianceKm.toFixed(1)}`}
                      </td>
                      <td
                        className={cn(
                          'whitespace-nowrap px-4 py-4 text-right font-mono font-medium',
                          rec.status === 'Flagged' ? 'text-red-600' : 'text-zinc-900'
                        )}
                      >
                        {rec.status === 'NO GPS RECORD' || rec.status === 'MISSING TO DISTANCE'
                          ? '—'
                          : `${rec.variancePct.toFixed(1)}%`}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
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
                      <td className="whitespace-nowrap px-4 py-4">
                        <MatchStatusBadge status={rec.status} />
                      </td>
                      <td className="max-w-50 px-4 py-4">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={editRemarks}
                              onChange={(e) => setEditRemarks(e.target.value)}
                              className="w-full rounded-lg border border-brand-sage/40 bg-white px-2 py-1 text-xs text-zinc-700 placeholder-zinc-300 outline-none focus:border-brand-teal focus:ring-1 focus:ring-brand-teal/30"
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
                          <span className="text-zinc-400">
                            {rec.explanationRemarks || '—'}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-center">
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

      {/* Mobile cards */}
      {!loading && !error && records.length > 0 && (
        <div className="space-y-4 md:hidden">
          {records.map((rec) => (
            <div key={rec.id} className="rounded-xl bg-white p-5 shadow-brand">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-zinc-900">{rec.toNo}</p>
                  <p className="text-xs text-zinc-400">
                    {rec.vehiclePlate} &middot; {rec.tripDate}
                  </p>
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
                  <p className="truncate text-zinc-700">{rec.origin} &rarr; {rec.destination}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-400">Arrival Time</p>
                  <p className="text-zinc-500">{rec.arrivalTime || '—'}</p>
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
                    <p className={cn('font-mono font-medium', rec.status === 'Flagged' ? 'text-red-600' : 'text-zinc-900')}>
                      {rec.varianceKm >= 0 ? '+' : ''}
                      {rec.varianceKm.toFixed(1)} km ({rec.variancePct.toFixed(1)}%)
                    </p>
                  )}
                </div>
                <div>
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
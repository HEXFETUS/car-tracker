import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { updateGpsLog, deleteGpsLog } from '../api/gps-logs-api';
import type { EnrichedGpsTripLog } from '../api/gps-logs-api';

interface EditGpsLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  log: EnrichedGpsTripLog | null;
  isSuperadmin?: boolean;
}

export function EditGpsLogModal({ isOpen, onClose, onSuccess, log, isSuperadmin = false }: EditGpsLogModalProps) {
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notes, setNotes] = useState(log?.notesRemarks ?? '');

  if (!isOpen || !log) return null;

  const handleSave = async () => {
    try {
      setSaving(true);
      await updateGpsLog(log.id, { notesRemarks: notes || null });
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Failed to update GPS log:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this GPS log?')) return;
    try {
      setDeleting(true);
      await deleteGpsLog(log.id);
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Failed to delete GPS log:', err);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 sm:p-4">
      <div className="max-h-dvh w-full max-w-lg overflow-y-auto bg-white shadow-brand-xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-xl">
        {/* Header */}
        <div className="flex items-center justify-between rounded-t-xl bg-brand-cream px-5 py-4">
          <div>
            <p className="text-sm font-bold text-brand-teal">{log.gpsRecordNo}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{log.vehiclePlateNo} — {log.driverName}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Notes / Remarks
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="rounded-lg border-0 bg-white px-3 py-2.5 text-sm text-zinc-700 ring-1 ring-brand-sage focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm resize-none"
              placeholder="Add notes or remarks..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-zinc-400 text-xs">Origin</span>
              <p className="font-medium text-zinc-700 truncate">{log.originGpsStartPoint || '—'}</p>
            </div>
            <div>
              <span className="text-zinc-400 text-xs">Destination</span>
              <p className="font-medium text-zinc-700 truncate">{log.destinationGpsEndPoint || '—'}</p>
            </div>
            <div>
              <span className="text-zinc-400 text-xs">Route Taken</span>
              <p className="font-medium text-zinc-700 truncate">{log.actualRouteRoadTaken || '—'}</p>
            </div>
            <div>
              <span className="text-zinc-400 text-xs">Trip Status</span>
              <p className="font-medium text-zinc-700 capitalize">{log.tripStatusGps.replace('-', ' ')}</p>
            </div>
            <div>
              <span className="text-zinc-400 text-xs">Distance (km)</span>
              <p className="font-medium text-zinc-700">{log.gpsDistanceKm ?? '—'}</p>
            </div>
            <div>
              <span className="text-zinc-400 text-xs">Max Speed (kph)</span>
              <p className="font-medium text-zinc-700">{log.maxSpeedKph ?? '—'}</p>
            </div>
            {log.toNumber && (
              <div className="col-span-2">
                <span className="text-zinc-400 text-xs">Linked TO No.</span>
                <p className="font-medium text-brand-teal">{typeof log.toNumber === 'number' ? `TO-${String(log.toNumber).padStart(4, '0')}` : log.toNumber}</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-100 px-5 py-3">
          <div>
            {isSuperadmin && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
              >
                {deleting ? <Loader2 className="size-3 animate-spin" /> : null}
                Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium text-white shadow-sm transition-all active:scale-[0.97]',
                saving ? 'bg-brand-teal/50 cursor-not-allowed' : 'bg-brand-teal hover:bg-brand-teal/80',
              )}
            >
              {saving ? (
                <><Loader2 className="size-4 animate-spin" /> Saving…</>
              ) : (
                'Save Notes'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

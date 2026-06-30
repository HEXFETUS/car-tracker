import { useState } from 'react';
import { X, Loader2, StickyNote } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { updateGpsLogNotes } from '../api/gps-logs-api';

interface EditNotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  logId: string | null;
  currentNotes: string | null;
  vehicleInfo: string;
}

export function EditNotesModal({ isOpen, onClose, onSuccess, logId, currentNotes, vehicleInfo }: EditNotesModalProps) {
  const [notes, setNotes] = useState(currentNotes ?? '');
  const [saving, setSaving] = useState(false);

  if (!isOpen || !logId) return null;

  const handleSave = async () => {
    try {
      setSaving(true);
      await updateGpsLogNotes(logId, notes || null);
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Failed to update notes:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-brand-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between rounded-t-xl bg-brand-cream px-5 py-4">
          <div className="flex items-center gap-2">
            <StickyNote className="size-4 text-brand-teal" />
            <div>
              <p className="text-sm font-bold text-brand-teal">Edit Notes</p>
              <p className="text-xs text-zinc-500 mt-0.5">{vehicleInfo}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1.5 block">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            className="w-full rounded-lg border-0 bg-white px-3 py-2.5 text-sm text-zinc-700 ring-1 ring-brand-sage focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm resize-none"
            placeholder="Add notes or remarks about this trip..."
          />
          <p className="text-[10px] text-zinc-400 mt-1.5">Only the Notes field will be updated. All other trip data is read-only.</p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
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
              'Save'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
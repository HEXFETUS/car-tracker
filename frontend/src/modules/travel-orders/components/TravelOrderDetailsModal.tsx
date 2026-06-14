import { useState, useEffect } from 'react';
import { X, Pencil, Trash2, Loader2 } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { updateTravelOrder, deleteTravelOrder, type TravelOrderData } from '../api/travel-orders-api';

interface TravelOrderDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: TravelOrderData | null;
  onSuccess: () => void;
}

export function TravelOrderDetailsModal({ isOpen, onClose, order, onSuccess }: TravelOrderDetailsModalProps) {
  const { toast, confirm } = useNotification();
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Form state
  const [department, setDepartment] = useState('');
  const [travelerName, setTravelerName] = useState('');
  const [originLocation, setOriginLocation] = useState('');
  const [destinationLocation, setDestinationLocation] = useState('');
  const [scheduledDepartureAt, setScheduledDepartureAt] = useState('');
  const [scheduledArrivalAt, setScheduledArrivalAt] = useState('');
  const [purpose, setPurpose] = useState('');
  const [notes, setNotes] = useState('');

  // Reset form when order changes
  useEffect(() => {
    if (order && isOpen) {
      setDepartment(order.department || '');
      setTravelerName(order.travelerName || '');
      setOriginLocation(order.originLocation || '');
      setDestinationLocation(order.destinationLocation || '');
      setScheduledDepartureAt(order.scheduledDepartureAt ? toLocalDatetime(order.scheduledDepartureAt) : '');
      setScheduledArrivalAt(order.scheduledArrivalAt ? toLocalDatetime(order.scheduledArrivalAt) : '');
      setPurpose(order.purpose || '');
      setNotes(order.notes || '');
      setIsEditing(false);
    }
  }, [order, isOpen]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    if (isOpen) document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  function toLocalDatetime(iso: string): string {
    try {
      const d = new Date(iso);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return '';
    }
  }

  function formatDateTime(dateStr: string | null) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function handleClose() {
    setIsEditing(false);
    onClose();
  }

  async function handleSave() {
    if (!order) return;
    setSaving(true);
    try {
      await updateTravelOrder(order.id, {
        department: department.trim(),
        travelerName: travelerName.trim(),
        originLocation: originLocation.trim(),
        destinationLocation: destinationLocation.trim(),
        scheduledDepartureAt: scheduledDepartureAt || undefined,
        scheduledArrivalAt: scheduledArrivalAt || undefined,
        purpose: purpose.trim(),
        notes: notes.trim(),
      });
      toast('Travel order updated!', 'success');
      setIsEditing(false);
      onSuccess();
    } catch (err: any) {
      toast(err.message || 'Failed to update travel order', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!order) return;
    const confirmed = await confirm({
      title: 'Delete Travel Order?',
      message: `Are you sure you want to delete TO-${order.toNumber}? This action cannot be undone.`,
      type: 'danger',
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      await deleteTravelOrder(order.id);
      toast('Travel order deleted!', 'success');
      onClose();
      onSuccess();
    } catch (err: any) {
      toast(err.message || 'Failed to delete travel order', 'error');
    } finally {
      setDeleting(false);
    }
  }

  async function handleApprove() {
    if (!order) return;
    const confirmed = await confirm({
      title: 'Approve Travel Order?',
      message: `Approve TO-${formatToNumber(order.toNumber)} for ${order.travelerName}?`,
      type: 'info',
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await updateTravelOrder(order.id, { status: 'APPROVED' });
      toast('Travel order approved!', 'success');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast(err.message || 'Failed to approve travel order', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeny() {
    if (!order) return;
    const confirmed = await confirm({
      title: 'Deny Travel Order?',
      message: `Deny TO-${formatToNumber(order.toNumber)} for ${order.travelerName}?`,
      type: 'warning',
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await updateTravelOrder(order.id, { status: 'CANCELLED' });
      toast('Travel order denied', 'success');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast(err.message || 'Failed to deny travel order', 'error');
    } finally {
      setSaving(false);
    }
  }

  function formatToNumber(toNumber: number) {
    const year = new Date().getFullYear();
    return `TO-${year}-${String(toNumber).padStart(4, '0')}`;
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      PENDING: 'bg-yellow-100 text-yellow-800',
      APPROVED: 'bg-blue-100 text-blue-800',
      ACTIVE: 'bg-green-100 text-green-800',
      COMPLETED: 'bg-zinc-100 text-zinc-600',
      CANCELLED: 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-zinc-100 text-zinc-600';
  };

  if (!isOpen || !order) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 py-10 backdrop-blur-sm transition-opacity"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="relative w-full max-w-2xl animate-in fade-in zoom-in-95 rounded-2xl bg-white shadow-brand-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-lg font-bold text-zinc-900">
                {formatToNumber(order.toNumber)}
              </h2>
              <p className="text-sm text-zinc-400">
                Created {formatDateTime(order.createdAt)}
              </p>
            </div>
            <span className={`rounded-full px-3 py-0.5 text-xs font-medium ${statusBadge(order.status)}`}>
              {order.status}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!isEditing && order.status === 'PENDING' && (
              <>
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-brand-teal transition-colors"
                  title="Edit"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-red-500 transition-colors disabled:opacity-40"
                  title="Delete"
                >
                  {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Traveler & Department */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-zinc-500 mb-1">Traveler / Personnel</label>
              {isEditing ? (
                <input
                  type="text"
                  value={travelerName}
                  onChange={(e) => setTravelerName(e.target.value)}
                  className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                />
              ) : (
                <p className="text-sm font-medium text-zinc-900">{order.travelerName || '—'}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-500 mb-1">Department</label>
              {isEditing ? (
                <input
                  type="text"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                />
              ) : (
                <p className="text-sm font-medium text-zinc-900">{order.department || '—'}</p>
              )}
            </div>
          </div>

          {/* Route */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-zinc-500 mb-1">Origin</label>
              {isEditing ? (
                <input
                  type="text"
                  value={originLocation}
                  onChange={(e) => setOriginLocation(e.target.value)}
                  className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                />
              ) : (
                <p className="text-sm font-medium text-zinc-900">{order.originLocation || '—'}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-500 mb-1">Destination</label>
              {isEditing ? (
                <input
                  type="text"
                  value={destinationLocation}
                  onChange={(e) => setDestinationLocation(e.target.value)}
                  className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                />
              ) : (
                <p className="text-sm font-medium text-zinc-900">{order.destinationLocation || '—'}</p>
              )}
            </div>
          </div>

          {/* Schedule */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-zinc-500 mb-1">Departure</label>
              {isEditing ? (
                <input
                  type="datetime-local"
                  value={scheduledDepartureAt}
                  onChange={(e) => setScheduledDepartureAt(e.target.value)}
                  className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                />
              ) : (
                <p className="text-sm font-medium text-zinc-900">{formatDateTime(order.scheduledDepartureAt)}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-500 mb-1">Return</label>
              {isEditing ? (
                <input
                  type="datetime-local"
                  value={scheduledArrivalAt}
                  onChange={(e) => setScheduledArrivalAt(e.target.value)}
                  className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                />
              ) : (
                <p className="text-sm font-medium text-zinc-900">{formatDateTime(order.scheduledArrivalAt)}</p>
              )}
            </div>
          </div>

          {/* Purpose */}
          <div>
            <label className="block text-sm font-medium text-zinc-500 mb-1">Purpose of Travel</label>
            {isEditing ? (
              <textarea
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                rows={3}
                className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow resize-none hover:ring-brand-teal"
              />
            ) : (
              <p className="text-sm font-medium text-zinc-900">{order.purpose || '—'}</p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-zinc-500 mb-1">Notes / Remarks</label>
            {isEditing ? (
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow resize-none hover:ring-brand-teal"
              />
            ) : (
              <p className="text-sm font-medium text-zinc-900">{order.notes || '—'}</p>
            )}
          </div>

          {/* Vehicle & Driver Info */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-zinc-500 mb-1">Vehicle</label>
              <p className="text-sm font-medium text-zinc-900">
                {order.plateNumber ? (
                  <>
                    {order.plateNumber}
                    {order.requestVehicle && <span className="ml-2 text-xs text-brand-teal">(Requested)</span>}
                  </>
                ) : order.requestVehicle ? (
                  <span className="text-zinc-400">Requested (not yet assigned)</span>
                ) : (
                  '—'
                )}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-500 mb-1">Driver</label>
              <p className="text-sm font-medium text-zinc-900">
                {order.driverName ? (
                  <>
                    {order.driverName}
                    {order.requestDriver && <span className="ml-2 text-xs text-brand-teal">(Requested)</span>}
                  </>
                ) : order.requestDriver ? (
                  <span className="text-zinc-400">Requested (not yet assigned)</span>
                ) : (
                  '—'
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-100 bg-zinc-50/50 rounded-b-2xl">
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  disabled={saving}
                  className="rounded-lg ring-1 ring-brand-sage px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-white transition-colors disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors disabled:opacity-60 inline-flex items-center gap-2"
                >
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </>
            ) : order.status === 'PENDING' ? (
              <>
                <button
                  type="button"
                  onClick={handleDeny}
                  disabled={saving}
                  className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 transition-colors disabled:opacity-60"
                >
                  Deny
                </button>
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={saving}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors disabled:opacity-60 inline-flex items-center gap-2"
                >
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  {saving ? 'Processing...' : 'Approve'}
                </button>
              </>
            ) : (
              <span className="text-sm text-zinc-400 italic">
                {order.status === 'APPROVED' && 'This order has been approved'}
                {order.status === 'CANCELLED' && 'This order has been cancelled'}
                {order.status === 'ACTIVE' && 'This order is currently active'}
                {order.status === 'COMPLETED' && 'This order has been completed'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
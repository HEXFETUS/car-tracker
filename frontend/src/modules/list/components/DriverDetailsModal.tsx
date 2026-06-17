import { useState } from 'react';
import { X, Loader2, Phone, Mail, Calendar, Trash2, Edit3 } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { updateDriver, deleteDriver } from '../api/drivers-api';
import type { Driver } from '@car-tracker/shared';

interface DriverDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  driver: Driver | null;
}

function formatExpiryDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function isExpired(dateStr: string): boolean {
  return new Date(dateStr) < new Date();
}

const STATUS_OPTIONS = ['active', 'inactive', 'on-leave', 'suspended'];

export function DriverDetailsModal({ isOpen, onClose, onSuccess, driver }: DriverDetailsModalProps) {
  const { toast, confirm } = useNotification();
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  // Edit form state
  const [editFullName, setEditFullName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editLicenseNumber, setEditLicenseNumber] = useState('');
  const [editExpiryDate, setEditExpiryDate] = useState('');

  // Status dropdown
  const [selectedStatus, setSelectedStatus] = useState('');

  if (!isOpen || !driver) return null;

  const expired = isExpired(driver.expiryDate);

  function cancelEditing() {
    setEditing(false);
  }

  async function handleSaveEdit() {
    if (!driver) return;
    try {
      setSaving(true);
      await updateDriver(driver.id, {
        fullName: editFullName.trim(),
        phone: editPhone.trim(),
        email: editEmail.trim(),
        address: editAddress.trim() || undefined,
        licenseNumber: editLicenseNumber.trim(),
        expiryDate: editExpiryDate,
        status: selectedStatus || driver.status,
      });
      toast('Driver updated successfully!', 'success');
      setSaving(false);
      onSuccess();
      onClose();
    } catch (err: any) {
      toast(err.message || 'Failed to update driver', 'error');
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!driver) return;
    const confirmed = await confirm({
      title: 'Delete Driver?',
      message: `Are you sure you want to delete "${driver.fullName}"? This action cannot be undone.`,
      type: 'danger',
    });
    if (!confirmed) return;

    try {
      setDeleting(true);
      await deleteDriver(driver.id);
      toast('Driver deleted successfully!', 'success');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast(err.message || 'Failed to delete driver', 'error');
      setDeleting(false);
    }
  }

  async function handleStatusChange(newStatus: string) {
    if (!driver) return;
    try {
      setSaving(true);
      await updateDriver(driver.id, { status: newStatus });
      toast(`Driver status updated to "${newStatus}"`, 'success');
      setSaving(false);
      onSuccess();
      onClose();
    } catch (err: any) {
      toast(err.message || 'Failed to update driver status', 'error');
      setSaving(false);
    }
  }

  const handleStartEditing = () => {
    if (!driver) return;
    setEditFullName(driver.fullName);
    setEditPhone(driver.phone);
    setEditEmail(driver.email);
    setEditAddress(driver.address ?? '');
    setEditLicenseNumber(driver.licenseNumber);
    setEditExpiryDate(driver.expiryDate);
    setSelectedStatus(driver.status ?? 'active');
    setEditing(true);
  };

  // ── Edit Mode ──────────────────────────────────────────────────
  if (editing) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 py-10 backdrop-blur-sm"
        onClick={(e) => { if (e.target === e.currentTarget) cancelEditing(); }}
      >
        <div className="relative w-full max-w-2xl animate-in fade-in zoom-in-95 rounded-2xl bg-white shadow-brand-xl">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5">
            <div>
              <h2 className="text-lg font-bold text-zinc-900">Edit Driver</h2>
              <p className="text-sm text-zinc-400">
                Update the details for this driver.
              </p>
            </div>
            <button
              type="button"
              onClick={cancelEditing}
              className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Form */}
          <div className="px-6 py-5 space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Phone</label>
                <input
                  type="text"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Email</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">License Number</label>
                <input
                  type="text"
                  value={editLicenseNumber}
                  onChange={(e) => setEditLicenseNumber(e.target.value)}
                  className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Expiry Date</label>
                <input
                  type="date"
                  value={editExpiryDate}
                  onChange={(e) => setEditExpiryDate(e.target.value)}
                  className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Status</label>
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Address</label>
              <textarea
                value={editAddress}
                onChange={(e) => setEditAddress(e.target.value)}
                rows={2}
                className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow resize-none"
                placeholder="Optional address..."
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-5">
              <button
                type="button"
                onClick={cancelEditing}
                className="rounded-lg ring-1 ring-brand-sage px-5 py-2.5 text-sm font-medium text-zinc-600 hover:bg-brand-cream transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Details View ───────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 py-10 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-lg animate-in fade-in zoom-in-95 rounded-2xl bg-white shadow-brand-xl">
        {/* Header */}
        <div className="flex items-center justify-between rounded-t-2xl bg-brand-cream px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-brand-moss/50 text-lg font-bold text-brand-teal shrink-0">
              {driver.fullName.charAt(0)}
            </div>
            <div>
              <p className="text-lg font-bold text-zinc-900">{driver.fullName}</p>
              <p className="text-xs text-zinc-400">{driver.licenseNumber}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-zinc-400 hover:bg-white/60 hover:text-zinc-700 transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Body - Driver Details */}
        <div className="px-6 py-5 space-y-5">
          {/* Status */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-700">Status</span>
            <select
              value={driver.status ?? 'active'}
              onChange={(e) => handleStatusChange(e.target.value)}
              disabled={saving}
              className={`rounded-lg border-0 ring-1 px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-teal/20 ${
                driver.status === 'active'
                  ? 'ring-green-200 bg-green-50 text-green-700'
                  : driver.status === 'inactive'
                  ? 'ring-zinc-200 bg-zinc-50 text-zinc-600'
                  : driver.status === 'on-leave'
                  ? 'ring-amber-200 bg-amber-50 text-amber-700'
                  : driver.status === 'suspended'
                  ? 'ring-red-200 bg-red-50 text-red-700'
                  : 'ring-brand-sage text-zinc-600'
              }`}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="on-leave">On Leave</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>

          <div className="h-px bg-zinc-100" />

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="block text-xs font-medium uppercase tracking-wider text-zinc-400">Phone</span>
              <span className="mt-1 block font-medium text-zinc-900">
                <Phone className="size-3.5 inline mr-1 text-zinc-400" />
                {driver.phone}
              </span>
            </div>
            <div>
              <span className="block text-xs font-medium uppercase tracking-wider text-zinc-400">Email</span>
              <span className="mt-1 block font-medium text-zinc-900">
                <Mail className="size-3.5 inline mr-1 text-zinc-400" />
                {driver.email}
              </span>
            </div>
            <div>
              <span className="block text-xs font-medium uppercase tracking-wider text-zinc-400">License #</span>
              <span className="mt-1 inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 font-mono">
                {driver.licenseNumber}
              </span>
            </div>
            <div>
              <span className="block text-xs font-medium uppercase tracking-wider text-zinc-400">Expiry</span>
              <span className="mt-1 block font-medium text-zinc-900">
                <Calendar className="size-3.5 inline mr-1 text-zinc-400" />
                <span className={expired ? 'text-red-600 font-medium' : ''}>
                  {formatExpiryDate(driver.expiryDate)}
                  {expired && (
                    <span className="ml-1.5 rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-600">
                      Expired
                    </span>
                  )}
                </span>
              </span>
            </div>
            {driver.address && (
              <div className="col-span-2">
                <span className="block text-xs font-medium uppercase tracking-wider text-zinc-400">Address</span>
                <span className="mt-1 block font-medium text-zinc-900">{driver.address}</span>
              </div>
            )}
          </div>

          <div className="h-px bg-zinc-100" />

          {/* Timestamps */}
          <div className="grid grid-cols-2 gap-4 text-xs text-zinc-400">
            <div>
              <span className="block">Created</span>
              <span className="font-medium text-zinc-500">
                {new Date(driver.createdAt).toLocaleDateString('en-US', {
                  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </div>
            <div>
              <span className="block">Last Updated</span>
              <span className="font-medium text-zinc-500">
                {new Date(driver.updatedAt).toLocaleDateString('en-US', {
                  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </div>
          </div>
        </div>

        {/* Footer - Actions */}
        <div className="flex items-center justify-between border-t border-zinc-100 px-6 py-4">
          <div className="flex items-center gap-2">
            {/* Delete Button */}
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              Delete
            </button>
          </div>
          <div className="flex items-center gap-2">
            {/* Edit Button */}
            <button
              onClick={handleStartEditing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-4 py-2 text-xs font-medium text-white shadow-sm transition-all hover:bg-brand-teal/80 active:scale-[0.97]"
            >
              <Edit3 className="size-3.5" />
              Edit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
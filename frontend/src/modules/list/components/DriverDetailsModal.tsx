import { useState } from 'react';
import { X, Loader2, Phone, Mail, Calendar, Trash2, Edit3, User, FileText, Info } from 'lucide-react';
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
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isExpired(dateStr: string): boolean {
  return new Date(dateStr) < new Date();
}

const STATUS_OPTIONS = ['active', 'inactive', 'on-leave', 'suspended'];

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-brand-teal shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{label}</p>
        <p className="mt-0.5 text-sm font-medium text-zinc-900">{value || '—'}</p>
      </div>
    </div>
  );
}

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-100 bg-white p-5 shadow-brand">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-zinc-100">
        <span className="text-brand-teal">{icon}</span>
        <h3 className="text-sm font-bold text-zinc-800">{title}</h3>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function inputClass() {
  return 'w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal';
}

export function DriverDetailsModal({ isOpen, onClose, onSuccess, driver }: DriverDetailsModalProps) {
  const { toast, confirm } = useNotification();
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const [editFullName, setEditFullName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editLicenseNumber, setEditLicenseNumber] = useState('');
  const [editExpiryDate, setEditExpiryDate] = useState('');
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

  // ── Edit Mode ──
  if (editing) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 py-10 backdrop-blur-sm"
        onClick={(e) => { if (e.target === e.currentTarget) cancelEditing(); }}
      >
        <div className="relative w-full max-w-2xl animate-in fade-in zoom-in-95 rounded-2xl bg-white shadow-brand-xl">
          <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-100">
            <div>
              <h2 className="text-lg font-bold text-zinc-900">Edit Driver</h2>
              <p className="text-sm text-zinc-400">Update the details for this driver.</p>
            </div>
            <button type="button" onClick={cancelEditing} className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors">
              <X className="size-5" />
            </button>
          </div>
          <div className="px-6 py-5 space-y-4">
            <SectionCard title="Personal Information" icon={<User className="size-4" />}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">Full Name</label>
                  <input type="text" value={editFullName} onChange={(e) => setEditFullName(e.target.value)} className={inputClass()} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">Phone</label>
                  <input type="text" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className={inputClass()} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mt-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">Email</label>
                  <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className={inputClass()} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">Address</label>
                  <textarea value={editAddress} onChange={(e) => setEditAddress(e.target.value)} rows={2} className={inputClass() + ' resize-none'} />
                </div>
              </div>
            </SectionCard>
            <SectionCard title="License Information" icon={<FileText className="size-4" />}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">License Number</label>
                  <input type="text" value={editLicenseNumber} onChange={(e) => setEditLicenseNumber(e.target.value)} className={inputClass()} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">Expiry Date</label>
                  <input type="date" value={editExpiryDate} onChange={(e) => setEditExpiryDate(e.target.value)} className={inputClass()} />
                </div>
              </div>
              <div className="mt-4">
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">Status</label>
                <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)} className={inputClass()}>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
              </div>
            </SectionCard>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button type="button" onClick={cancelEditing} className="rounded-lg ring-1 ring-brand-sage px-5 py-2.5 text-sm font-medium text-zinc-600 hover:bg-brand-cream transition-colors">Cancel</button>
              <button type="button" onClick={handleSaveEdit} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors">
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Details View ──
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 py-10 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-2xl animate-in fade-in zoom-in-95 rounded-2xl bg-white shadow-brand-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-100">
          <div className="flex flex-col gap-1">
            <div className="inline-flex items-center gap-3 flex-wrap">
              <div className="flex size-8 items-center justify-center rounded-full bg-brand-moss/50 text-sm font-bold text-brand-teal">
                {driver.fullName.charAt(0)}
              </div>
              <span className="text-lg font-bold text-zinc-900">{driver.fullName}</span>
            </div>
            <p className="text-sm text-zinc-400">{driver.licenseNumber} &bull; {driver.email}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={handleStartEditing} className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-brand-teal transition-colors" title="Edit">
              <Edit3 className="size-4" />
            </button>
            <button type="button" onClick={handleDelete} disabled={deleting} className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-red-500 transition-colors disabled:opacity-40" title="Delete">
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            </button>
            <button type="button" onClick={onClose} className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors">
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Status */}
          <div className="flex items-center justify-between rounded-lg bg-zinc-50 px-4 py-3">
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

          <SectionCard title="Personal Information" icon={<User className="size-4" />}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DetailRow icon={<Phone className="size-4" />} label="Phone" value={driver.phone} />
              <DetailRow icon={<Mail className="size-4" />} label="Email" value={driver.email} />
              {driver.address && <DetailRow icon={<Info className="size-4" />} label="Address" value={driver.address} />}
            </div>
          </SectionCard>

          <SectionCard title="License Information" icon={<FileText className="size-4" />}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DetailRow
                icon={<FileText className="size-4" />}
                label="License #"
                value={<span className="inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 font-mono">{driver.licenseNumber}</span>}
              />
              <DetailRow
                icon={<Calendar className="size-4" />}
                label="Expiry"
                value={
                  <span className={expired ? 'text-red-600 font-medium' : ''}>
                    {formatExpiryDate(driver.expiryDate)}
                    {expired && <span className="ml-1.5 rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-600">Expired</span>}
                  </span>
                }
              />
            </div>
          </SectionCard>

          <SectionCard title="Audit Information" icon={<Calendar className="size-4" />}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DetailRow
                icon={<Calendar className="size-4" />}
                label="Created"
                value={new Date(driver.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              />
              <DetailRow
                icon={<Calendar className="size-4" />}
                label="Last Updated"
                value={new Date(driver.updatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              />
            </div>
          </SectionCard>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-zinc-100">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg ring-1 ring-brand-sage px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
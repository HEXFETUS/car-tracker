import { useState, useEffect } from 'react';
import { X, Loader2, Check, MapPin, Calendar, Clock, Truck, UserCircle, FileText, ClipboardCheck } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { formatDateTimeManila } from '@/shared/lib/date-utils';
import {
  fetchVehicles,
  fetchDrivers,
  assignTravelOrder,
  type PendingTravelOrder,
  type VehicleOption,
  type DriverOption,
} from '../api/requests-api';

interface AssignModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: PendingTravelOrder | null;
  onSuccess: () => void;
}

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
    <div className="rounded-xl border border-zinc-100 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-zinc-100">
        <span className="text-brand-teal">{icon}</span>
        <h3 className="text-sm font-bold text-zinc-800">{title}</h3>
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </div>
  );
}

export function AssignModal({ isOpen, onClose, order, onSuccess }: AssignModalProps) {
  const { toast, confirm } = useNotification();
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [saving, setSaving] = useState(false);

  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [selectedDriverId, setSelectedDriverId] = useState('');

  // Load vehicles and drivers when modal opens
  useEffect(() => {
    if (isOpen) {
      setLoadingOptions(true);
      Promise.all([fetchVehicles(), fetchDrivers()])
        .then(([v, d]) => {
          setVehicles(v);
          setDrivers(d);
        })
        .catch(() => {
          toast('Failed to load vehicles or drivers', 'error');
        })
        .finally(() => setLoadingOptions(false));
    }
  }, [isOpen, toast]);

  // Pre-fill selections when order changes
  useEffect(() => {
    if (order && isOpen) {
      setSelectedVehicleId(order.vehicleId || '');
      setSelectedDriverId(order.driverId || '');
    }
  }, [order, isOpen]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    if (isOpen) document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  function handleClose() {
    setSelectedVehicleId('');
    setSelectedDriverId('');
    onClose();
  }

  function formatDateTime(dateStr: string | null) {
    if (!dateStr) return '—';
    return formatDateTimeManila(dateStr);
  }

  async function handleAssign() {
    if (!order) return;
    if (!selectedVehicleId || !selectedDriverId) {
      toast('Please select both a vehicle and a driver', 'error');
      return;
    }

    const confirmed = await confirm({
      title: 'Confirm Assignment',
      message: `Assign vehicle and driver to ${order.toNumber}? The order will remain PENDING.`,
      type: 'info',
    });
    if (!confirmed) return;

    setSaving(true);
    try {
      await assignTravelOrder(order.id, {
        vehicle_id: selectedVehicleId,
        driver_id: selectedDriverId,
      });
      toast('Vehicle and driver assigned successfully!', 'success');
      handleClose();
      onSuccess();
    } catch (err: any) {
      toast(err.message || 'Failed to assign resources', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen || !order) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 py-0 sm:py-10 backdrop-blur-sm transition-opacity"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="relative w-full max-w-2xl min-h-screen sm:min-h-0 animate-in fade-in zoom-in-95 rounded-none sm:rounded-2xl bg-white shadow-brand-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-100 shrink-0">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center rounded-full bg-brand-teal/10 px-3 py-1 text-sm font-bold text-brand-teal">
              {order.toNumber}
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-4">
            {/* Request Information */}
            <SectionCard title="Request Information" icon={<ClipboardCheck className="size-4" />}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <DetailRow icon={<UserCircle className="size-4" />} label="Traveler" value={order.travelerName || '—'} />
                <DetailRow icon={<FileText className="size-4" />} label="Department" value={order.department || '—'} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <DetailRow icon={<MapPin className="size-4" />} label="Origin" value={order.originLocation || '—'} />
                <DetailRow icon={<MapPin className="size-4" />} label="Destination" value={order.destinationLocation || '—'} />
              </div>
              <DetailRow icon={<FileText className="size-4" />} label="Purpose" value={order.purpose || '—'} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <DetailRow
                  icon={<Calendar className="size-4" />}
                  label="Departure"
                  value={formatDateTime(order.scheduledDepartureAt)}
                />
                <DetailRow
                  icon={<Clock className="size-4" />}
                  label="Return"
                  value={formatDateTime(order.scheduledArrivalAt)}
                />
              </div>
            </SectionCard>

            {/* Resource Assignment */}
            <SectionCard title="Resource Assignment" icon={<Truck className="size-4" />}>
              {/* Current Assignment Display */}
              {(order.plateNumber || order.driverName) && (
                <div className="rounded-lg bg-brand-cream border border-brand-sage/30 p-3 mb-4">
                  <p className="text-xs font-medium text-brand-teal mb-1">Current Assignment</p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-700">
                    {order.plateNumber && <span>Vehicle: <strong>{order.plateNumber}</strong></span>}
                    {order.plateNumber && order.driverName && <span className="text-zinc-300">|</span>}
                    {order.driverName && <span>Driver: <strong>{order.driverName}</strong></span>}
                  </div>
                </div>
              )}

              {loadingOptions ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="size-5 text-brand-teal animate-spin" />
                  <span className="ml-2 text-sm text-zinc-500">Loading options…</span>
                </div>
              ) : (
                <>
                  {/* Vehicle Selection */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-500 mb-1.5">
                      Vehicle (Plate Number)
                    </label>
                    <select
                      value={selectedVehicleId}
                      onChange={(e) => setSelectedVehicleId(e.target.value)}
                      className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                    >
                      <option value="">— Select a vehicle —</option>
                      {vehicles
                        .filter((v) => !v.underRepair)
                        .map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.plateNumber} — {v.make} {v.model} ({v.year})
                          </option>
                        ))}
                    </select>
                    <p className="mt-1 text-xs text-zinc-400">
                      Valid tracking plates: KAR6444, KAR6412, KAR6558
                    </p>
                  </div>

                  {/* Driver Selection */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-500 mb-1.5">
                      Driver
                    </label>
                    <select
                      value={selectedDriverId}
                      onChange={(e) => setSelectedDriverId(e.target.value)}
                      className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow hover:ring-brand-teal"
                    >
                      <option value="">— Select a driver —</option>
                      {drivers
                        .filter((d) => d.status === 'active')
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.fullName}
                          </option>
                        ))}
                    </select>
                  </div>
                </>
              )}
            </SectionCard>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-100 bg-white rounded-b-2xl shrink-0">
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="rounded-lg ring-1 ring-brand-sage px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAssign}
            disabled={saving || loadingOptions || !selectedVehicleId || !selectedDriverId}
            className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors disabled:opacity-60 inline-flex items-center gap-2"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            {saving ? 'Assigning...' : 'Assign Resources'}
          </button>
        </div>
      </div>
    </div>
  );
}
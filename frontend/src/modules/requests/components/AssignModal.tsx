import { useState, useEffect } from 'react';
import { X, Loader2, Check } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
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
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 py-10 backdrop-blur-sm transition-opacity">
      <div className="relative w-full max-w-2xl animate-in fade-in zoom-in-95 rounded-2xl bg-white shadow-brand-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-100">
          <div>
            <h2 className="text-lg font-bold text-zinc-900">
              {order.toNumber}
            </h2>
            <p className="text-sm text-zinc-400">
              Assign Vehicle & Driver
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Body — Order Details (read-only) */}
        <div className="px-6 py-5 space-y-4 border-b border-zinc-100">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DetailRow label="Traveler" value={order.travelerName || '—'} />
            <DetailRow label="Department" value={order.department || '—'} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DetailRow label="Route" value={`${order.originLocation || '—'} → ${order.destinationLocation}`} />
            <DetailRow label="Purpose" value={order.purpose || '—'} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DetailRow label="Departure" value={formatDateTime(order.scheduledDepartureAt)} />
            <DetailRow label="Return" value={formatDateTime(order.scheduledArrivalAt)} />
          </div>
        </div>

        {/* Body — Assignment Form */}
        <div className="px-6 py-5 space-y-5">
          <h3 className="text-sm font-semibold text-zinc-700 uppercase tracking-wide">
            Resource Assignment
          </h3>

          {loadingOptions ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-6 text-brand-teal animate-spin" />
              <span className="ml-2 text-sm text-zinc-500">Loading options…</span>
            </div>
          ) : (
            <>
              {/* Current Assignment Display */}
              {(order.plateNumber || order.driverName) && (
                <div className="rounded-lg bg-brand-cream border border-brand-sage/30 p-3">
                  <p className="text-xs font-medium text-brand-teal mb-1">Current Assignment</p>
                  <p className="text-sm text-zinc-700">
                    {order.plateNumber && <>Vehicle: <strong>{order.plateNumber}</strong></>}
                    {order.plateNumber && order.driverName && <> &middot; </>}
                    {order.driverName && <>Driver: <strong>{order.driverName}</strong></>}
                  </p>
                </div>
              )}

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
                  {vehicles.map((v) => (
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
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.fullName}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-100 bg-zinc-50/50 rounded-b-2xl">
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="rounded-lg ring-1 ring-brand-sage px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-white transition-colors disabled:opacity-40"
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-zinc-400">{label}</span>
      <span className="font-medium text-zinc-900 truncate ml-2 max-w-[60%]" title={value}>
        {value || '—'}
      </span>
    </div>
  );
}
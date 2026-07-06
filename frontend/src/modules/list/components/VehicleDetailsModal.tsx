import { useState } from 'react';
import { X, Loader2, Fuel, Wrench, Trash2, Edit3, AlertTriangle, ClipboardList, CheckCircle, Car, Calendar, Info } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { formatDateTimeManila } from '@/shared/lib/date-utils';
import { updateVehicle, toggleVehicleRepair, deleteVehicle } from '../api/vehicles-api';
import type { Vehicle } from '@car-tracker/shared';

interface VehicleDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  vehicle: Vehicle | null;
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

export function VehicleDetailsModal({ isOpen, onClose, onSuccess, vehicle }: VehicleDetailsModalProps) {
  const { toast, confirm } = useNotification();
  const [deleting, setDeleting] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showRepairNote, setShowRepairNote] = useState(false);
  const [repairNote, setRepairNote] = useState('');

  const [editPlateNumber, setEditPlateNumber] = useState('');
  const [editMake, setEditMake] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editYear, setEditYear] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editVehicleType, setEditVehicleType] = useState('');
  const [editFuelType, setEditFuelType] = useState('');

  if (!isOpen || !vehicle) return null;

  const isUnderRepair = vehicle.underRepair === true;

  function cancelEditing() {
    setEditing(false);
  }

  async function handleSaveEdit() {
    if (!vehicle) return;
    try {
      setRepairing(true);
      await updateVehicle(vehicle.id, {
        plateNumber: editPlateNumber.trim(),
        make: editMake.trim(),
        model: editModel.trim(),
        year: Number(editYear),
        color: editColor.trim() || undefined,
        vehicleType: editVehicleType.trim() || undefined,
        fuelType: editFuelType.trim() || undefined,
      });
      toast('Vehicle updated successfully!', 'success');
      setEditing(false);
      setRepairing(false);
      onSuccess();
      onClose();
    } catch (err: any) {
      toast(err.message || 'Failed to update vehicle', 'error');
      setRepairing(false);
    }
  }

  async function handleDelete() {
    if (!vehicle) return;
    const confirmed = await confirm({
      title: 'Delete Vehicle?',
      message: `Are you sure you want to delete "${vehicle.year} ${vehicle.make} ${vehicle.model}" (${vehicle.plateNumber})? This action cannot be undone.`,
      type: 'danger',
    });
    if (!confirmed) return;

    try {
      setDeleting(true);
      await deleteVehicle(vehicle.id);
      toast('Vehicle deleted successfully!', 'success');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast(err.message || 'Failed to delete vehicle', 'error');
      setDeleting(false);
    }
  }

  function openRepairNoteModal() {
    setRepairNote('');
    setShowRepairNote(true);
  }

  async function handleSubmitRepairNote() {
    if (!vehicle || !repairNote.trim()) {
      toast('Please enter a reason for the repair.', 'info');
      return;
    }
    try {
      setRepairing(true);
      await toggleVehicleRepair(vehicle.id, true, repairNote.trim());
      toast('Vehicle marked under repair!', 'success');
      setShowRepairNote(false);
      onSuccess();
      onClose();
    } catch (err: any) {
      toast(err.message || 'Failed to update vehicle repair status', 'error');
      setRepairing(false);
    }
  }

  async function handleDoneRepair() {
    if (!vehicle) return;
    const confirmed = await confirm({
      title: 'Done Repair?',
      message: `Mark "${vehicle.plateNumber}" as active and clear the repair notes?`,
      type: 'info',
    });
    if (!confirmed) return;

    try {
      setRepairing(true);
      await toggleVehicleRepair(vehicle.id, false, '');
      toast('Repair completed, vehicle is now active!', 'success');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast(err.message || 'Failed to update vehicle repair status', 'error');
      setRepairing(false);
    }
  }

  const handleStartEditing = () => {
    if (!vehicle) return;
    setEditPlateNumber(vehicle.plateNumber);
    setEditMake(vehicle.make);
    setEditModel(vehicle.model);
    setEditYear(String(vehicle.year));
    setEditColor(vehicle.color ?? '');
    setEditVehicleType(vehicle.vehicleType ?? '');
    setEditFuelType(vehicle.fuelType ?? '');
    setEditing(true);
  };

  // ── Repair Note Modal ──
  if (showRepairNote) {
    return (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/40 py-10 backdrop-blur-sm"
        onClick={(e) => { if (e.target === e.currentTarget) setShowRepairNote(false); }}
      >
        <div className="relative w-full max-w-lg animate-in fade-in zoom-in-95 rounded-2xl bg-white shadow-brand-xl">
          <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-100">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-amber-100">
                <ClipboardList className="size-5 text-amber-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-900">Mark Under Repair</h2>
                <p className="text-sm text-zinc-400">{vehicle.plateNumber} — {vehicle.make} {vehicle.model}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowRepairNote(false)}
              className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="px-6 py-5">
            <label className="block text-sm font-medium text-zinc-700 mb-1.5">
              Reason for Repair <span className="text-red-500">*</span>
            </label>
            <textarea
              value={repairNote}
              onChange={(e) => setRepairNote(e.target.value)}
              rows={4}
              className="w-full rounded-lg border-0 ring-1 ring-brand-sage px-3.5 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/20 transition-shadow resize-none"
              placeholder="Describe why this vehicle needs repair..."
              autoFocus
            />
            <p className="mt-1.5 text-xs text-zinc-400">This note will be saved and visible in the vehicle details.</p>
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-zinc-100 px-6 py-4">
            <button
              type="button"
              onClick={() => setShowRepairNote(false)}
              className="rounded-lg ring-1 ring-brand-sage px-5 py-2.5 text-sm font-medium text-zinc-600 hover:bg-brand-cream transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmitRepairNote}
              disabled={repairing || !repairNote.trim()}
              className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all active:scale-[0.97] ${
                repairing || !repairNote.trim()
                  ? 'bg-amber-400/50 cursor-not-allowed'
                  : 'bg-amber-500 hover:bg-amber-600'
              }`}
            >
              {repairing ? (
                <><Loader2 className="size-4 animate-spin" /> Saving…</>
              ) : (
                <><Wrench className="size-4" /> Mark Under Repair</>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

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
              <h2 className="text-lg font-bold text-zinc-900">Edit Vehicle</h2>
              <p className="text-sm text-zinc-400">Update the details for this vehicle.</p>
            </div>
            <button type="button" onClick={cancelEditing} className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors">
              <X className="size-5" />
            </button>
          </div>
          <div className="px-6 py-5 space-y-4">
            <SectionCard title="Basic Information" icon={<Car className="size-4" />}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">Plate Number</label>
                  <input type="text" value={editPlateNumber} onChange={(e) => setEditPlateNumber(e.target.value)} className={inputClass()} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">Year</label>
                  <input type="number" value={editYear} onChange={(e) => setEditYear(e.target.value)} className={inputClass()} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mt-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">Make</label>
                  <input type="text" value={editMake} onChange={(e) => setEditMake(e.target.value)} className={inputClass()} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">Model</label>
                  <input type="text" value={editModel} onChange={(e) => setEditModel(e.target.value)} className={inputClass()} />
                </div>
              </div>
            </SectionCard>
            <SectionCard title="Classification" icon={<Fuel className="size-4" />}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">Color</label>
                  <input type="text" value={editColor} onChange={(e) => setEditColor(e.target.value)} className={inputClass()} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">Vehicle Type</label>
                  <select value={editVehicleType} onChange={(e) => setEditVehicleType(e.target.value)} className={inputClass()}>
                    <option value="">Select type...</option>
                    <option value="Sedan">Sedan</option>
                    <option value="SUV">SUV</option>
                    <option value="Truck">Truck</option>
                    <option value="Van">Van</option>
                    <option value="Motorcycle">Motorcycle</option>
                    <option value="Bus">Bus</option>
                  </select>
                </div>
              </div>
              <div className="mt-4">
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">Fuel Type</label>
                <select value={editFuelType} onChange={(e) => setEditFuelType(e.target.value)} className={inputClass()}>
                  <option value="">Select fuel type...</option>
                  <option value="gasoline">Gasoline</option>
                  <option value="diesel">Diesel</option>
                  <option value="electric">Electric</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </div>
            </SectionCard>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button type="button" onClick={cancelEditing} className="rounded-lg ring-1 ring-brand-sage px-5 py-2.5 text-sm font-medium text-zinc-600 hover:bg-brand-cream transition-colors">Cancel</button>
              <button type="button" onClick={handleSaveEdit} disabled={repairing} className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-teal/80 transition-colors">
                {repairing ? <Loader2 className="size-4 animate-spin" /> : null}
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
              <span className="inline-flex items-center rounded-full bg-brand-teal/10 px-3 py-1 text-sm font-bold text-brand-teal">
                {vehicle.plateNumber}
              </span>
              {isUnderRepair ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-0.5 text-xs font-semibold text-amber-600">
                  <Wrench className="size-3" />
                  Under Repair
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-0.5 text-xs font-semibold text-green-600">
                  <span className="size-1.5 rounded-full bg-green-500" />
                  Active
                </span>
              )}
            </div>
            <p className="text-sm text-zinc-400">
              {vehicle.make} {vehicle.model} &bull; {vehicle.year}
            </p>
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
          {/* Repair note banner */}
          {vehicle.notes && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <ClipboardList className="size-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Repair Notes</p>
                  <p className="mt-0.5 text-sm text-amber-800">{vehicle.notes}</p>
                </div>
              </div>
            </div>
          )}

          <SectionCard title="Vehicle Information" icon={<Car className="size-4" />}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DetailRow icon={<Car className="size-4" />} label="Make" value={vehicle.make} />
              <DetailRow icon={<Car className="size-4" />} label="Model" value={vehicle.model} />
              <DetailRow icon={<Calendar className="size-4" />} label="Year" value={vehicle.year} />
              <DetailRow icon={<Car className="size-4" />} label="Plate Number" value={vehicle.plateNumber} />
            </div>
          </SectionCard>

          <SectionCard title="Classification" icon={<Fuel className="size-4" />}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {vehicle.color && <DetailRow icon={<Info className="size-4" />} label="Color" value={vehicle.color} />}
              {vehicle.vehicleType && <DetailRow icon={<Car className="size-4" />} label="Type" value={vehicle.vehicleType} />}
              {vehicle.fuelType && <DetailRow icon={<Fuel className="size-4" />} label="Fuel" value={<span className="capitalize">{vehicle.fuelType}</span>} />}
            </div>
          </SectionCard>

          <SectionCard title="Audit Information" icon={<Calendar className="size-4" />}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DetailRow
                icon={<Calendar className="size-4" />}
                label="Created"
                value={formatDateTimeManila(vehicle.createdAt)}
              />
              <DetailRow
                icon={<Calendar className="size-4" />}
                label="Last Updated"
                value={formatDateTimeManila(vehicle.updatedAt)}
              />
            </div>
          </SectionCard>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-100">
          <div>
            {isUnderRepair ? (
              <button
                onClick={handleDoneRepair}
                disabled={repairing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-xs font-medium text-white shadow-sm transition-all hover:bg-green-700 active:scale-[0.97]"
              >
                {repairing ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle className="size-3.5" />}
                Done Repair
              </button>
            ) : (
              <button
                onClick={openRepairNoteModal}
                disabled={repairing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-medium text-white shadow-sm transition-all hover:bg-amber-600 active:scale-[0.97]"
              >
                <AlertTriangle className="size-3.5" />
                Under Repair
              </button>
            )}
          </div>
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